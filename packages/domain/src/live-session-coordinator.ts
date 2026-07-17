import {
  LiveSessionPlanV1Schema,
  LiveSessionProfileV1Schema,
  LiveSessionProjectionSchema,
  type LiveSessionMode,
  type LiveSessionPlanV1,
  type LiveSessionProfileV1,
  type LiveSessionProjection,
  type LiveSessionStep,
  type TwitchMetadata,
} from '@obscurpilot/contracts/live-session';
import type { ObsSnapshot } from '@obscurpilot/contracts/obs';

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
  isLive(): Promise<boolean>;
}

export interface LiveSessionCoordinatorOptions {
  readonly obs: LiveSessionObsPort;
  readonly twitch: LiveSessionTwitchPort;
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
    this.publish({ phase: 'preflight', reasonCode: 'PREFLIGHT_IN_PROGRESS', completedSteps: [] });
    const obs = this.options.obs.snapshot();
    if (obs === undefined) return this.fail('OBS_NOT_SYNCHRONIZED');
    const resourceFailure = validateObsResources(profile, obs);
    if (resourceFailure !== undefined) return this.fail(resourceFailure);

    let twitch: LiveSessionTwitchPreflight;
    try {
      twitch = await this.options.twitch.preflight(profile, mode);
    } catch {
      return this.fail(mode === 'dry_run' ? 'TWITCH_SIMULATOR_UNAVAILABLE' : 'TWITCH_NOT_READY');
    }
    if (!twitch.categoryValid) return this.fail('TWITCH_CATEGORY_MISMATCH');
    const requiredScopes = mode === 'live' ? ['channel:manage:broadcast'] : [];
    if (requiredScopes.some((scope) => !twitch.scopes.includes(scope))) {
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
      expiresAt: new Date(this.now() + 60_000).toISOString(),
      requiredScopes,
      steps: [...STEPS],
    });
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
    this.publish({
      phase: 'stopped',
      reasonCode: emergency ? 'EMERGENCY_STOPPED' : 'STOPPED',
      ...(plan === undefined ? {} : { plan }),
      completedSteps: this.projection.completedSteps,
      obsStreamActive: false,
      twitchLive: false,
      liveVerified: false,
    });
    return this.snapshot();
  }

  public async dispose(): Promise<void> {
    if (this.active !== undefined || this.projection.phase === 'live') await this.stop(true);
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
      const obsTasks = (async () => {
        await this.options.obs.setProgramScene(
          profile.obs.preLiveSceneName,
          `${plan.planId}:prelive`,
          signal,
        );
        if (plan.mode === 'dry_run' || profile.obs.recording === 'on') {
          await this.options.obs.startRecord(`${plan.planId}:record`, signal);
        }
        if (plan.mode === 'live') {
          await this.options.obs.startStream(`${plan.planId}:stream`, signal);
        }
      })();

      if (plan.mode === 'live') {
        this.publish({
          phase: 'applying_twitch',
          reasonCode: 'APPLYING_TWITCH_AND_OBS',
          plan,
          activeStep: 'apply_twitch',
          completedSteps: ['preflight'],
        });
        const twitchTask = this.options.twitch.updateMetadata(
          plan.plannedTwitch,
          `${plan.planId}:metadata`,
          signal,
        );
        await Promise.all([obsTasks, twitchTask]);
        metadataApplied = true;
      } else {
        await obsTasks;
      }
      this.publish({
        phase: 'verifying_live',
        reasonCode: 'VERIFYING_AUTHORITATIVE_OUTPUTS',
        plan,
        activeStep: 'verify_live',
        completedSteps: ['preflight', 'apply_twitch', 'prepare_obs', 'start_output'],
      });
      await this.verifyOutput(plan, profile, signal);
      await this.countdown(plan, profile, signal);
      await this.options.obs.setProgramScene(
        profile.obs.liveSceneName,
        `${plan.planId}:live-scene`,
        signal,
      );
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
