import {
  LiveSessionPlanV1Schema,
  LiveSessionProfileV1Schema,
  LiveSessionProjectionSchema,
  type LiveSessionMode,
  type LiveSessionExecutionReceipt,
  type LiveSessionPlanV1,
  type LiveSessionPreflightCheck,
  type LiveSessionProfileV1,
  type LiveSessionProjection,
  type LiveSessionStep,
  type TwitchMetadata,
} from '@obscurpilot/contracts/live-session';
import type { ObsSnapshot } from '@obscurpilot/contracts/obs';
import { ReliabilityTracker } from './reliability-tracker.js';

const STEPS: readonly LiveSessionStep[] = [
  'preflight',
  'apply_twitch',
  'prepare_obs',
  'start_output',
  'verify_live',
];

export interface LiveSessionObsPort {
  snapshot(): ObsSnapshot | undefined;
  setProgramScene(sceneName: string, commandId: string, signal: AbortSignal): Promise<void>;
  setCountdownText(
    inputName: string,
    text: string,
    commandId: string,
    signal: AbortSignal,
  ): Promise<void>;
  startStream(commandId: string, signal: AbortSignal): Promise<void>;
  stopStream(commandId: string, signal?: AbortSignal): Promise<void>;
  startRecord(commandId: string, signal: AbortSignal): Promise<void>;
  stopRecord(commandId: string, signal?: AbortSignal): Promise<void>;
}

export interface LiveSessionTwitchPreflight {
  readonly metadata: TwitchMetadata;
  readonly scopes: readonly string[];
  readonly categoryValid: boolean;
  readonly live: boolean;
}

export interface LiveSessionTwitchPort {
  preflight(
    profile: LiveSessionProfileV1,
    mode: LiveSessionMode,
  ): Promise<LiveSessionTwitchPreflight>;
  updateMetadata(metadata: TwitchMetadata, commandId: string, signal: AbortSignal): Promise<void>;
  restoreMetadata(metadata: TwitchMetadata, commandId: string): Promise<void>;
  readMetadata(): Promise<TwitchMetadata>;
  isLive(): Promise<boolean>;
}

export interface LiveSessionDesktopPort {
  inspectObs(): Promise<{ readonly running: boolean; readonly windowVisible: boolean }>;
}

export interface LiveSessionCoordinatorOptions {
  readonly obs: LiveSessionObsPort;
  readonly twitch: LiveSessionTwitchPort;
  readonly desktop?: LiveSessionDesktopPort;
  readonly onProjection: (projection: LiveSessionProjection) => void;
  readonly now?: () => number;
  readonly id?: () => string;
  readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

export class LiveSessionError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'LiveSessionError';
  }
}

export class LiveSessionCoordinator {
  private readonly now: () => number;
  private readonly id: () => string;
  private readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  private projection: LiveSessionProjection;
  private profile: LiveSessionProfileV1 | undefined;
  private active: AbortController | undefined;
  private execution: Promise<void> | undefined;
  private readonly reliability = new ReliabilityTracker();
  private preflightChecks: LiveSessionPreflightCheck[] = [];
  private receipts: LiveSessionExecutionReceipt[] = [];

  public constructor(private readonly options: LiveSessionCoordinatorOptions) {
    this.now = options.now ?? Date.now;
    this.id = options.id ?? (() => crypto.randomUUID());
    this.sleep = options.sleep ?? abortableSleep;
    this.projection = this.parse({
      phase: 'draft',
      reasonCode: 'NO_PLAN',
      updatedAt: this.timestamp(),
      completedSteps: [],
      obsStreamActive: false,
      twitchLive: false,
      liveVerified: false,
    });
  }

  public snapshot(): LiveSessionProjection {
    return this.projection;
  }

  public async prepare(
    profileInput: LiveSessionProfileV1,
    mode: LiveSessionMode,
  ): Promise<LiveSessionProjection> {
    if (this.execution !== undefined || ['live', 'stopping'].includes(this.projection.phase)) {
      throw new LiveSessionError(
        'SESSION_ACTIVE',
        'Stop the active session before preparing another plan',
      );
    }
    const profile = LiveSessionProfileV1Schema.parse(profileInput);
    this.profile = profile;
    this.preflightChecks = [];
    this.receipts = [];
    this.publish({ phase: 'preflight', reasonCode: 'PREFLIGHT_IN_PROGRESS', completedSteps: [] });
    if (this.options.desktop !== undefined) {
      const desktop = await this.options.desktop.inspectObs().catch(() => ({
        running: false,
        windowVisible: false,
      }));
      this.addCheck(
        'desktop.obs_process',
        desktop.running ? 'passed' : 'failed',
        true,
        desktop.running
          ? desktop.windowVisible
            ? 'OBS_PROCESS_AND_WINDOW_READY'
            : 'OBS_PROCESS_READY_WINDOW_HIDDEN'
          : 'OBS_PROCESS_NOT_RUNNING',
      );
      if (!desktop.running) return this.fail('OBS_PROCESS_NOT_RUNNING');
    }
    const obs = this.options.obs.snapshot();
    this.addCheck(
      'obs.connection',
      obs === undefined ? 'failed' : 'passed',
      true,
      obs === undefined ? 'OBS_NOT_SYNCHRONIZED' : 'OBS_SNAPSHOT_AUTHORITATIVE',
    );
    if (obs === undefined) return this.fail('OBS_NOT_SYNCHRONIZED');
    this.addObsChecks(profile, obs);
    const resourceFailure = validateObsResources(profile, obs);
    if (resourceFailure !== undefined) return this.fail(resourceFailure);

    let twitch: LiveSessionTwitchPreflight;
    try {
      twitch = await this.options.twitch.preflight(profile, mode);
    } catch {
      this.addCheck('twitch.connection', 'failed', mode === 'live', 'TWITCH_NOT_READY');
      return this.fail(mode === 'dry_run' ? 'TWITCH_SIMULATOR_UNAVAILABLE' : 'TWITCH_NOT_READY');
    }
    this.addCheck('twitch.connection', 'passed', mode === 'live', 'TWITCH_PREFLIGHT_READY');
    this.addCheck(
      'twitch.category',
      twitch.categoryValid ? 'passed' : 'failed',
      mode === 'live',
      twitch.categoryValid ? 'TWITCH_CATEGORY_VERIFIED' : 'TWITCH_CATEGORY_MISMATCH',
    );
    if (!twitch.categoryValid) return this.fail('TWITCH_CATEGORY_MISMATCH');
    const requiredScopes = mode === 'live' ? ['channel:manage:broadcast'] : [];
    const scopesReady = requiredScopes.every((scope) => twitch.scopes.includes(scope));
    this.addCheck(
      'twitch.scopes',
      scopesReady ? 'passed' : 'failed',
      mode === 'live',
      scopesReady ? 'TWITCH_SCOPES_VERIFIED' : 'TWITCH_SCOPE_REQUIRED',
    );
    if (!scopesReady) {
      return this.fail('TWITCH_SCOPE_REQUIRED');
    }
    const createdAt = this.timestamp();
    const planSeed = {
      schemaVersion: 1,
      mode,
      profileId: profile.profileId,
      profileRevision: profile.revision,
      expectedObsSnapshotVersion: obs.snapshotVersion,
      expectedObsGeneration: obs.generation,
      previousTwitch: twitch.metadata,
      plannedTwitch: toMetadata(profile),
      preLiveSceneName: profile.obs.preLiveSceneName,
      liveSceneName: profile.obs.liveSceneName,
      countdownSeconds: profile.obs.countdownSeconds,
      recording: profile.obs.recording,
    };
    const plan = LiveSessionPlanV1Schema.parse({
      ...planSeed,
      planId: this.id(),
      planHash: await hashPlan(planSeed),
      profileName: profile.name,
      createdAt,
      expiresAt: new Date(this.now() + 30 * 60_000).toISOString(),
      requiredScopes,
      steps: [...STEPS],
    });
    this.recordInstantReceipt('preflight', 'local', 'PREFLIGHT_VERIFIED');
    this.publish({
      phase: 'awaiting_confirmation',
      reasonCode: 'GO_LIVE_CONFIRMATION_REQUIRED',
      plan,
      activeStep: 'preflight',
      completedSteps: ['preflight'],
      obsStreamActive: obs.streamActive,
      twitchLive: twitch.live,
      liveVerified: false,
    });
    return this.snapshot();
  }

  public decide(planId: string, decision: 'approve' | 'deny'): LiveSessionProjection {
    const plan = this.projection.plan;
    if (this.projection.phase !== 'awaiting_confirmation' || plan?.planId !== planId) {
      throw new LiveSessionError('PLAN_MISMATCH', 'The live-session plan is no longer current');
    }
    if (decision === 'deny') {
      this.publish({
        phase: 'stopped',
        reasonCode: 'CREATOR_DENIED',
        plan,
        completedSteps: ['preflight'],
      });
      return this.snapshot();
    }
    if (Date.parse(plan.expiresAt) <= this.now()) return this.fail('PLAN_EXPIRED');
    const obs = this.options.obs.snapshot();
    if (
      obs === undefined ||
      obs.generation !== plan.expectedObsGeneration ||
      obs.snapshotVersion !== plan.expectedObsSnapshotVersion ||
      this.profile?.revision !== plan.profileRevision
    )
      return this.fail('PLAN_STALE');
    const active = new AbortController();
    this.active = active;
    const run = this.execute(plan, this.profile, active.signal).finally(() => {
      if (this.active === active) this.active = undefined;
      if (this.execution === run) this.execution = undefined;
    });
    this.execution = run;
    void run;
    return this.snapshot();
  }

  public async stop(emergency = false): Promise<LiveSessionProjection> {
    const plan = this.projection.plan;
    const twitchWasLive = await this.options.twitch.isLive().catch(() => undefined);
    const mustVerifyTwitchOffline = plan?.mode === 'live' || twitchWasLive === true;
    this.active?.abort(new DOMException('Session stopped', 'AbortError'));
    this.publish({
      phase: 'stopping',
      reasonCode: emergency ? 'EMERGENCY_STOP' : 'STOP_REQUESTED',
      ...(plan === undefined ? {} : { plan }),
      completedSteps: this.projection.completedSteps,
    });
    const snapshot = this.options.obs.snapshot();
    const tasks: Promise<void>[] = [];
    if (snapshot?.streamActive)
      tasks.push(this.options.obs.stopStream(`${plan?.planId ?? this.id()}:stop-stream`));
    if (snapshot?.recordActive)
      tasks.push(this.options.obs.stopRecord(`${plan?.planId ?? this.id()}:stop-record`));
    await Promise.allSettled(tasks);
    try {
      await this.verifyStopped(mustVerifyTwitchOffline);
    } catch {
      return this.fail('STOP_VERIFICATION_TIMEOUT');
    }
    let preLiveSceneRestored = true;
    if (
      plan !== undefined &&
      this.options.obs.snapshot()?.currentProgramSceneName !== plan.preLiveSceneName
    ) {
      try {
        await this.options.obs.setProgramScene(
          plan.preLiveSceneName,
          `${plan.planId}:restore-pre-live`,
          new AbortController().signal,
        );
        preLiveSceneRestored =
          this.options.obs.snapshot()?.currentProgramSceneName === plan.preLiveSceneName;
      } catch {
        preLiveSceneRestored = false;
      }
    }
    this.publish({
      phase: 'stopped',
      reasonCode: preLiveSceneRestored
        ? emergency
          ? 'EMERGENCY_STOPPED'
          : 'STOPPED'
        : 'STOPPED_PRELIVE_SCENE_RESTORE_FAILED',
      ...(plan === undefined ? {} : { plan }),
      completedSteps: this.projection.completedSteps,
      obsStreamActive: false,
      twitchLive: false,
      liveVerified: false,
    });
    return this.snapshot();
  }

  public async dispose(): Promise<void> {
    this.active?.abort(new DOMException('Application shutdown', 'AbortError'));
    await this.execution?.catch(() => undefined);
  }

  private async execute(
    plan: LiveSessionPlanV1,
    profile: LiveSessionProfileV1 | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    if (profile === undefined) return void this.fail('PROFILE_MISSING');
    let metadataApplied = false;
    try {
      this.publish({
        phase: 'applying_twitch',
        reasonCode: plan.mode === 'live' ? 'APPLYING_TWITCH' : 'SIMULATING_TWITCH',
        plan,
        activeStep: 'apply_twitch',
        completedSteps: ['preflight'],
      });
      if (plan.mode === 'live') {
        const metadataReceipt = this.beginReceipt('apply_twitch', 'twitch');
        try {
          await this.options.twitch.updateMetadata(
            plan.plannedTwitch,
            `${plan.planId}:metadata`,
            signal,
          );
          metadataApplied = true;
          await this.verifyMetadata(plan.plannedTwitch, signal);
          this.completeReceipt(metadataReceipt, true, 'TWITCH_METADATA_VERIFIED');
        } catch (error) {
          this.completeReceipt(metadataReceipt, false, 'TWITCH_METADATA_VERIFICATION_FAILED');
          throw error;
        }
      } else {
        this.recordInstantReceipt('apply_twitch', 'local', 'TWITCH_DRY_RUN_VERIFIED');
      }
      this.publish({
        phase: 'preparing_obs',
        reasonCode: 'PREPARING_STARTING_SCENE',
        plan,
        activeStep: 'prepare_obs',
        completedSteps: ['preflight', 'apply_twitch'],
      });
      const initialSceneName =
        plan.countdownSeconds > 0 ? profile.obs.preLiveSceneName : profile.obs.liveSceneName;
      const prepareReceipt = this.beginReceipt('prepare_obs', 'obs');
      try {
        await this.options.obs.setProgramScene(
          initialSceneName,
          `${plan.planId}:${plan.countdownSeconds > 0 ? 'prelive' : 'live-ready'}`,
          signal,
        );
        await this.verifyObsScene(initialSceneName, profile.verification.obsReadyTimeoutMs, signal);
        if (plan.mode === 'dry_run' || profile.obs.recording === 'on') {
          await this.options.obs.startRecord(`${plan.planId}:record`, signal);
        }
        this.completeReceipt(prepareReceipt, true, 'OBS_PREPARATION_VERIFIED');
      } catch (error) {
        this.completeReceipt(prepareReceipt, false, 'OBS_PREPARATION_FAILED');
        throw error;
      }
      this.publish({
        phase: 'starting_output',
        reasonCode: plan.mode === 'live' ? 'STARTING_STREAM' : 'DRY_RUN_RECORDING',
        plan,
        activeStep: 'start_output',
        completedSteps: ['preflight', 'apply_twitch', 'prepare_obs'],
      });
      const startReceipt = this.beginReceipt('start_output', 'obs');
      try {
        if (plan.mode === 'live')
          await this.options.obs.startStream(`${plan.planId}:stream`, signal);
        this.completeReceipt(startReceipt, true, 'OUTPUT_START_ACCEPTED');
      } catch (error) {
        this.completeReceipt(startReceipt, false, 'OUTPUT_START_FAILED');
        throw error;
      }
      this.publish({
        phase: 'verifying_live',
        reasonCode: 'VERIFYING_AUTHORITATIVE_OUTPUTS',
        plan,
        activeStep: 'verify_live',
        completedSteps: ['preflight', 'apply_twitch', 'prepare_obs', 'start_output'],
      });
      const verificationReceipt = this.beginReceipt(
        'verify_live',
        plan.mode === 'live' ? 'obs_and_twitch' : 'obs',
      );
      try {
        await this.verifyOutput(plan, profile, signal);
        this.completeReceipt(verificationReceipt, true, 'OUTPUT_AUTHORITATIVELY_VERIFIED');
      } catch (error) {
        this.completeReceipt(verificationReceipt, false, 'OUTPUT_VERIFICATION_FAILED');
        throw error;
      }
      await this.countdown(plan, profile, signal);
      if (plan.countdownSeconds > 0) {
        await this.options.obs.setProgramScene(
          profile.obs.liveSceneName,
          `${plan.planId}:live-scene`,
          signal,
        );
        await this.verifyObsScene(
          profile.obs.liveSceneName,
          profile.verification.obsReadyTimeoutMs,
          signal,
        );
      }
      this.publish({
        phase: 'live',
        reasonCode: plan.mode === 'live' ? 'LIVE_VERIFIED' : 'DRY_RUN_VERIFIED',
        plan,
        completedSteps: [...STEPS],
        obsStreamActive: plan.mode === 'live',
        twitchLive: plan.mode === 'live',
        liveVerified: true,
      });
    } catch (error: unknown) {
      if (signal.aborted) return;
      if (metadataApplied) {
        this.publish({
          phase: 'rolling_back',
          reasonCode: 'RESTORING_TWITCH_METADATA',
          plan,
          completedSteps: this.projection.completedSteps,
        });
        await this.options.twitch
          .restoreMetadata(plan.previousTwitch, `${plan.planId}:rollback`)
          .catch(() => undefined);
      }
      this.fail(error instanceof LiveSessionError ? error.code : 'SESSION_EXECUTION_FAILED');
    }
  }

  private async verifyOutput(
    plan: LiveSessionPlanV1,
    profile: LiveSessionProfileV1,
    signal: AbortSignal,
  ): Promise<void> {
    const deadline =
      this.now() +
      (plan.mode === 'live'
        ? profile.verification.twitchLiveTimeoutMs
        : profile.verification.obsReadyTimeoutMs);
    while (this.now() < deadline) {
      const obs = this.options.obs.snapshot();
      const obsReady =
        plan.mode === 'live' ? obs?.streamActive === true : obs?.recordActive === true;
      const twitchReady =
        plan.mode === 'dry_run' || (await this.options.twitch.isLive().catch(() => false));
      if (obsReady && twitchReady) return;
      await this.sleep(1_000, signal);
    }
    throw new LiveSessionError(
      'LIVE_VERIFICATION_TIMEOUT',
      'Output did not become authoritative before the deadline',
    );
  }

  private async verifyMetadata(expected: TwitchMetadata, signal: AbortSignal): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const actual = await this.options.twitch.readMetadata().catch(() => undefined);
      if (actual !== undefined && metadataMatches(actual, expected)) return;
      if (attempt < 3) {
        this.reliability.recordRecovery();
        await this.sleep(250 * 2 ** attempt, signal);
      }
    }
    throw new LiveSessionError(
      'TWITCH_METADATA_VERIFICATION_FAILED',
      'Twitch did not return the requested metadata',
    );
  }

  private async verifyStopped(mustVerifyTwitchOffline: boolean): Promise<void> {
    const signal = new AbortController().signal;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const obs = this.options.obs.snapshot();
      const obsStopped = obs?.streamActive === false && obs.recordActive === false;
      const twitchStopped =
        !mustVerifyTwitchOffline || !(await this.options.twitch.isLive().catch(() => true));
      if (obsStopped && twitchStopped) return;
      this.reliability.recordRecovery();
      await this.sleep(250, signal);
    }
    throw new LiveSessionError(
      'STOP_VERIFICATION_TIMEOUT',
      'Output remained active after the stop request',
    );
  }

  private async verifyObsScene(
    expectedScene: string,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<void> {
    const deadline = this.now() + timeoutMs;
    while (this.now() < deadline) {
      if (this.options.obs.snapshot()?.currentProgramSceneName === expectedScene) return;
      this.reliability.recordRecovery();
      await this.sleep(250, signal);
    }
    throw new LiveSessionError('OBS_SCENE_VERIFICATION_FAILED', 'OBS scene did not reconcile');
  }

  private async countdown(
    plan: LiveSessionPlanV1,
    profile: LiveSessionProfileV1,
    signal: AbortSignal,
  ): Promise<void> {
    for (let remaining = plan.countdownSeconds; remaining > 0; remaining -= 1) {
      this.publish({
        phase: 'verifying_live',
        reasonCode: 'STARTING_SOON_COUNTDOWN',
        plan,
        activeStep: 'verify_live',
        completedSteps: ['preflight', 'apply_twitch', 'prepare_obs', 'start_output'],
        countdownRemainingSeconds: remaining,
        obsStreamActive: plan.mode === 'live',
        twitchLive: plan.mode === 'live',
      });
      if (profile.obs.countdownInputName !== undefined) {
        await this.options.obs.setCountdownText(
          profile.obs.countdownInputName,
          formatCountdown(remaining),
          `${plan.planId}:countdown:${remaining}`,
          signal,
        );
      }
      await this.sleep(1_000, signal);
    }
  }

  private fail(reasonCode: string): LiveSessionProjection {
    this.publish({
      phase: 'failed',
      reasonCode,
      completedSteps: this.projection.completedSteps,
      ...(this.projection.plan === undefined ? {} : { plan: this.projection.plan }),
    });
    return this.snapshot();
  }

  private addObsChecks(profile: LiveSessionProfileV1, snapshot: ObsSnapshot): void {
    const scenes = new Set(snapshot.scenes.map((scene) => scene.name));
    const inputs = new Set(snapshot.inputs.map((input) => input.name));
    this.addCheck(
      'obs.scene_collection',
      snapshot.sceneCollectionName === profile.obs.sceneCollectionName ? 'passed' : 'failed',
      true,
      snapshot.sceneCollectionName === profile.obs.sceneCollectionName
        ? 'OBS_SCENE_COLLECTION_VERIFIED'
        : 'OBS_SCENE_COLLECTION_MISMATCH',
    );
    this.addCheck(
      'obs.pre_live_scene',
      scenes.has(profile.obs.preLiveSceneName) ? 'passed' : 'failed',
      true,
      scenes.has(profile.obs.preLiveSceneName)
        ? 'OBS_PRELIVE_SCENE_VERIFIED'
        : 'OBS_PRELIVE_SCENE_MISSING',
    );
    this.addCheck(
      'obs.live_scene',
      scenes.has(profile.obs.liveSceneName) ? 'passed' : 'failed',
      true,
      scenes.has(profile.obs.liveSceneName) ? 'OBS_LIVE_SCENE_VERIFIED' : 'OBS_LIVE_SCENE_MISSING',
    );
    const inputsReady =
      profile.obs.requiredInputs.every((input) => inputs.has(input)) &&
      (profile.obs.countdownInputName === undefined || inputs.has(profile.obs.countdownInputName));
    this.addCheck(
      'obs.required_inputs',
      inputsReady ? 'passed' : 'failed',
      true,
      inputsReady ? 'OBS_INPUTS_VERIFIED' : 'OBS_REQUIRED_INPUT_MISSING',
    );
    this.addCheck(
      'obs.output_idle',
      snapshot.streamActive ? 'warning' : 'passed',
      false,
      snapshot.streamActive ? 'OBS_STREAM_ALREADY_ACTIVE' : 'OBS_OUTPUT_IDLE',
    );
  }

  private addCheck(
    id: LiveSessionPreflightCheck['id'],
    status: LiveSessionPreflightCheck['status'],
    critical: boolean,
    reasonCode: string,
  ): void {
    this.preflightChecks.push({
      id,
      status,
      critical,
      reasonCode,
      checkedAt: this.timestamp(),
    });
  }

  private beginReceipt(
    step: LiveSessionStep,
    verification: LiveSessionExecutionReceipt['verification'],
  ): LiveSessionExecutionReceipt {
    const receipt: LiveSessionExecutionReceipt = {
      receiptId: crypto.randomUUID(),
      step,
      status: 'running',
      verification,
      reasonCode: 'OPERATION_IN_PROGRESS',
      attempt: 1,
      startedAt: this.timestamp(),
    };
    this.receipts.push(receipt);
    return receipt;
  }

  private completeReceipt(
    receipt: LiveSessionExecutionReceipt,
    ok: boolean,
    reasonCode: string,
  ): void {
    const completedAt = this.timestamp();
    const durationMs = Math.max(0, this.now() - Date.parse(receipt.startedAt));
    const index = this.receipts.findIndex((candidate) => candidate.receiptId === receipt.receiptId);
    if (index >= 0) {
      this.receipts[index] = {
        ...receipt,
        status: ok ? 'verified' : 'failed',
        reasonCode,
        completedAt,
        durationMs,
      };
    }
    this.reliability.record(ok, durationMs);
  }

  private recordInstantReceipt(
    step: LiveSessionStep,
    verification: LiveSessionExecutionReceipt['verification'],
    reasonCode: string,
  ): void {
    const receipt = this.beginReceipt(step, verification);
    this.completeReceipt(receipt, true, reasonCode);
  }

  private publish(
    next: Omit<
      LiveSessionProjection,
      'updatedAt' | 'obsStreamActive' | 'twitchLive' | 'liveVerified'
    > &
      Partial<Pick<LiveSessionProjection, 'obsStreamActive' | 'twitchLive' | 'liveVerified'>>,
  ): void {
    this.projection = this.parse({
      obsStreamActive: false,
      twitchLive: false,
      liveVerified: false,
      preflightChecks: [...this.preflightChecks],
      executionReceipts: [...this.receipts],
      reliability: this.reliability.snapshot(),
      ...next,
      updatedAt: this.timestamp(),
    });
    this.options.onProjection(this.projection);
  }

  private parse(value: unknown): LiveSessionProjection {
    return LiveSessionProjectionSchema.parse(value);
  }
  private timestamp(): string {
    return new Date(this.now()).toISOString();
  }
}

function metadataMatches(actual: TwitchMetadata, expected: TwitchMetadata): boolean {
  return (
    actual.title === expected.title &&
    actual.categoryId === expected.categoryId &&
    actual.language === expected.language &&
    [...actual.tags].sort().join('\u0000') === [...expected.tags].sort().join('\u0000')
  );
}

function validateObsResources(
  profile: LiveSessionProfileV1,
  snapshot: ObsSnapshot,
): string | undefined {
  if (snapshot.sceneCollectionName !== profile.obs.sceneCollectionName)
    return 'OBS_SCENE_COLLECTION_MISMATCH';
  const scenes = new Set(snapshot.scenes.map((scene) => scene.name));
  if (!scenes.has(profile.obs.preLiveSceneName)) return 'OBS_PRELIVE_SCENE_MISSING';
  if (!scenes.has(profile.obs.liveSceneName)) return 'OBS_LIVE_SCENE_MISSING';
  const inputs = new Set(snapshot.inputs.map((input) => input.name));
  if (profile.obs.requiredInputs.some((input) => !inputs.has(input)))
    return 'OBS_REQUIRED_INPUT_MISSING';
  if (profile.obs.countdownInputName !== undefined && !inputs.has(profile.obs.countdownInputName))
    return 'OBS_COUNTDOWN_INPUT_MISSING';
  return undefined;
}

function toMetadata(profile: LiveSessionProfileV1): TwitchMetadata {
  return {
    title: profile.twitch.title,
    categoryId: profile.twitch.categoryId,
    categoryName: profile.twitch.categoryName,
    tags: [...profile.twitch.tags],
    language: profile.twitch.language,
  };
}

async function hashPlan(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  return `Starting in ${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
}
function abortableSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
  });
}
