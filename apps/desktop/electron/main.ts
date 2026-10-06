import { createHash, randomUUID } from 'node:crypto';
import {
  BootstrapProjectionSchema,
  GetBootstrapPayloadSchema,
  type BootstrapProjection,
} from '@obscurpilot/contracts/bootstrap';
import {
  AudioDeviceListSchema,
  EmptyPayloadSchema,
  HandsFreeChangedEventSchema,
  HandsFreePreferencesSchema,
  HandsFreeProjectionSchema,
  HandsFreeSpeechFinishedPayloadSchema,
  OperationAcceptedSchema,
  PttCommandPayloadSchema,
  DEFAULT_SHORTCUT_BINDINGS,
  SelectAudioDevicePayloadSchema,
  ShortcutBindingsSchema,
} from '@obscurpilot/contracts/audio';
import { IPC_CHANNELS } from '@obscurpilot/contracts/ipc';
import {
  GetObsSnapshotPayloadSchema,
  ObsConnectResultSchema,
  ObsProjectionSchema,
  ReconnectObsPayloadSchema,
  type ObsConnectResult,
  type ObsConnectStep,
} from '@obscurpilot/contracts/obs';
import {
  LogEntryEventSchema,
  LogsEmptyPayloadSchema,
  LogsProjectionSchema,
} from '@obscurpilot/contracts/observability';
import {
  createObsProductionTools,
  ObsBridge,
  type ObsCommandRequest,
} from '@obscurpilot/adapters/obs';
import {
  AppSnapshotSchema,
  GetSnapshotPayloadSchema,
  StateChangedEventSchema,
  type ConnectionProjection,
} from '@obscurpilot/contracts/state';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  session,
  shell,
  Tray,
  type IpcMainInvokeEvent,
} from 'electron';
import { resolve } from 'node:path';
import { GlobalShortcutService } from './core/global-shortcuts.js';
import { PttAudioService } from './services/audio-service.js';
import { registerApplicationProtocol } from './core/application-protocol.js';
import {
  getDevelopmentServerUrl,
  loadDevelopmentEnvironment,
  parseEnvironment,
} from './core/environment.js';
import { PublicFault, registerSecureHandler } from './core/ipc-router.js';
import { LifecycleScope } from './core/lifecycle.js';
import {
  installPermissionDenial,
  installSecurityHeaders,
  isTrustedRendererUrl,
} from './core/security.js';
import { MainStateService } from './services/state-service.js';
import { LogService } from './services/log-service.js';
import {
  enableObsWebSocket,
  findObsExecutable,
  isObsRunning,
  obsWebSocketConfigPath,
  readObsWebSocketSettings,
} from './services/obs-setup.js';
import { SecureSettingsStore } from './storage/secure-settings.js';
import {
  createAudioCaptureWindow,
  createMainWindow,
  createMainWindowShell,
  loadMainWindow,
} from './core/window-manager.js';
import { createPilotOverlayWindow, PilotOverlayController } from './core/pilot-overlay.js';
import {
  CloudAuthProjectionSchema,
  CloudConfirmationPayloadSchema,
  CloudCredentialPayloadSchema,
  CloudGetAuthPayloadSchema,
  CloudSignOutPayloadSchema,
} from '@obscurpilot/contracts/cloud';
import { CloudBridge } from './services/cloud-bridge.js';
import {
  TwitchActivityEventSchema,
  TwitchCategorySearchPayloadSchema,
  TwitchCategorySearchResultSchema,
  TwitchEmptyPayloadSchema,
  TwitchOperationAcceptedSchema,
  TwitchProjectionSchema,
} from '@obscurpilot/contracts/twitch';
import { TwitchBridge } from './services/twitch-bridge.js';
import { requireSecureEncryptionProvider } from './storage/encrypted-json-store.js';
import {
  AgentConfirmationDecisionPayloadSchema,
  AgentEmptyPayloadSchema,
  AgentInteractionChangedEventSchema,
  AgentInteractionProjectionSchema,
  AgentStartResultSchema,
  type AgentStartResult,
} from '@obscurpilot/contracts/agent';
import {
  createGroqClient,
  createSdkReasoningTransport,
  GroqReasoningAdapter,
  GuardedReasoningOrchestrator,
} from '@obscurpilot/adapters/groq';
import { WisprTranscriptionAdapter } from '@obscurpilot/adapters/wispr';
import { VoiceOrchestrator } from './services/voice-orchestrator.js';
import { HandsFreeConversation } from './services/hands-free-conversation.js';
import { ToolRegistry } from '@obscurpilot/domain/tool-registry';
import { authorizeTool } from '@obscurpilot/domain/policy';
import {
  ChatAnalysisEventSchema,
  ChatMessageEventSchema,
  LiveSessionChangedEventSchema,
  LiveSessionDecisionPayloadSchema,
  LiveSessionEmptyPayloadSchema,
  LiveSessionProjectionSchema,
  LiveSessionProfilesProjectionSchema,
  TwitchMetadataSchema,
  ModerationCommandPayloadSchema,
  ModerationIntentV1Schema,
  PilotOverlayAcceptedSchema,
  PilotOverlayDragPayloadSchema,
  PilotOverlayInteractivePayloadSchema,
  PilotOverlayPreferencesSchema,
  PrepareLiveSessionPayloadSchema,
  type TwitchMetadata,
  type LiveSessionProfileV1,
} from '@obscurpilot/contracts/live-session';
import {
  LiveSessionCoordinator,
  type LiveSessionObsPort,
  type LiveSessionTwitchPort,
} from '@obscurpilot/domain/live-session-coordinator';
import { BoundedChatIntelligence, ModerationGuard } from '@obscurpilot/domain/chat-intelligence';
import { ObsProcessSupervisor } from './services/obs-process-supervisor.js';

const lifecycle = new LifecycleScope();
const stateService = new MainStateService();
let shutdownStarted = false;

const TRAY_ICON_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAKSSURBVFhH7VcrcNtAEA0sDCwMLAwMNCw0dHPqODAwMLHUcZlhoWFgYGGgoWGhoaGhPnErlex1nnRyde/ubMspCOib2ZE/73bv9ns6O/uPEzG51pex0oNWJkqumPNPMR3rd0mkb2IlT7GSMom09oqS58m13E7H+px1nIwk0sMkkrVjbI/EStJY6XtsnPUdDZwiVvKdlfcTWU3H+oJ1HwQWYbGrcKd4nUSy6EiQa7wxYBtB4OQ+hU3s5RsSkNcA2HSs9FcY9KxNHz7pD7zGC7/bZTkd6/fM9QG8L5/l0aMD4difE0kkI14IZQcXeoAkZF3wIPN2gJFYycZz8t7GWySRzLv6EMZgUqJ+PeSj3B5C0z84n2TOvBpoIkScMaeLNP19mb6UAzz5vy6aPmIdbMOctuatDhfK2jTV53lRPWdFpTuyLIrKyzehtSrDad34gU6/sggdZEW1IOON5OVKa3++eCrrxiKwmxAOi2CQ5z+vHMMdSYtqyGsA9Ieufny3CJyAKD2LYJBl5S0btTaQl7Zig4P6uf4x9SyCQZaVH9kobcB2rQF7wElw9GoiLC2CAWKcFdWaDdeSl+V2u/WWLfcDeMQioN7tDWgdmul1HuTVho1n2a8Rc1t4xrmbK0kkP6xdKrljTguUYppXd4g5nqGTAxheXb2mwbnVwnFCw/ASe4IbHEqSOTWacWo3I6dceoKT24jr/haYVu4CCcZ2H5qLK90fA/1lBySjOxH7ewKn5PaLzYQuMxbQlp2dN55YHrpa1QnnDLUTPAmyfxO1ItwH5yZph81TZu7Y/St9PVjDeMIJRx8xh/B2x6NgcuKJFR8nsnDG7qkw3tj/VtRKkwPhUnst2rib2OOdYGY+j0Lt+83iD9Yi1wDfLtoEAAAAAElFTkSuQmCC';

type Stage11TwitchToolInput = {
  readonly title?: string;
  readonly categoryId?: string;
  readonly categoryName?: string;
  readonly tags?: readonly string[];
  readonly language?: string;
  readonly text?: string;
  readonly targetUserId?: string;
  readonly targetLogin?: string;
  readonly messageId?: string;
  readonly evidenceMessageId?: string;
  readonly durationSeconds?: number;
  readonly reason?: string;
};

function stage11Record(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Tool input must be an object');
  }
  return input as Record<string, unknown>;
}

function stage11String(record: Record<string, unknown>, key: string, maximum = 500): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '' || value.length > maximum) {
    throw new Error(key.toUpperCase() + '_REQUIRED');
  }
  return value.trim();
}

function bindMainWindowLifetime(window: BrowserWindow): void {
  window.once('closed', () => {
    if (!shutdownStarted) app.quit();
  });
}

function getSupportedPlatform(): 'win32' | 'darwin' | 'linux' {
  if (
    process.platform === 'win32' ||
    process.platform === 'darwin' ||
    process.platform === 'linux'
  ) {
    return process.platform;
  }
  throw new Error('Unsupported operating system: ' + process.platform);
}

async function startApplication(): Promise<void> {
  loadDevelopmentEnvironment(app.getAppPath(), app.isPackaged);
  const environment = parseEnvironment(process.env);
  const logs = new LogService({
    consoleLevel: environment.OBSCURPILOT_LOG_LEVEL,
    secrets: [
      environment.WISPR_FLOW_API_KEY,
      environment.GROQ_API_KEY,
      environment.OBS_WEBSOCKET_PASSWORD,
      environment.SUPABASE_ANON_KEY,
    ],
    onEntry: (entry) => {
      const envelope = LogEntryEventSchema.parse({
        protocolVersion: 1,
        eventId: randomUUID(),
        emittedAt: new Date().toISOString(),
        payload: entry,
      });
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.logEntry, envelope);
      }
    },
  });
  logs.info('app', `ObscurPilot ${app.getVersion()} starting`, `Electron ${process.versions.electron}`);
  logs.info(
    'app',
    'Provider keys',
    [
      `Wispr Flow ${environment.WISPR_FLOW_API_KEY === undefined ? 'missing' : 'set'}`,
      `Groq ${environment.GROQ_API_KEY === undefined ? 'missing' : 'set'}`,
      `Supabase ${environment.SUPABASE_URL === undefined ? 'missing' : 'set'}`,
      `Twitch ${environment.TWITCH_CLIENT_ID === undefined ? 'missing' : 'set'}`,
    ].join(', '),
  );
  const useBuiltRenderer =
    app.isPackaged ||
    process.env.OBSCURPILOT_E2E === '1' ||
    process.argv.includes('--built-renderer');
  const isDevelopment = !useBuiltRenderer;
  const developmentServerUrl = getDevelopmentServerUrl(environment);
  const trustedSender = (event: IpcMainInvokeEvent) =>
    isTrustedRendererUrl(event.senderFrame?.url, isDevelopment, developmentServerUrl.origin);

  lifecycle.add(
    installSecurityHeaders(session.defaultSession, isDevelopment, developmentServerUrl.origin),
  );
  lifecycle.add(installPermissionDenial(session.defaultSession));

  if (!isDevelopment) registerApplicationProtocol();
  const mainWindow = createMainWindowShell(isDevelopment);
  bindMainWindowLifetime(mainWindow);

  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.getBootstrap,
      payloadSchema: GetBootstrapPayloadSchema,
      resultSchema: BootstrapProjectionSchema,
      isTrustedSender: trustedSender,
      handler: (): BootstrapProjection => ({
        protocolVersion: 1,
        app: { name: 'ObscurPilot', version: app.getVersion() },
        runtime: {
          platform: getSupportedPlatform(),
          electron: process.versions.electron,
          chrome: process.versions.chrome,
          node: process.versions.node,
        },
        configuration: {
          wisprConfigured: environment.WISPR_FLOW_API_KEY !== undefined,
          groqConfigured: environment.GROQ_API_KEY !== undefined,
          supabaseConfigured:
            environment.SUPABASE_URL !== undefined && environment.SUPABASE_ANON_KEY !== undefined,
          twitchConfigured:
            environment.TWITCH_CLIENT_ID !== undefined &&
            environment.TWITCH_REDIRECT_URI !== undefined,
        },
      }),
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.getSnapshot,
      payloadSchema: GetSnapshotPayloadSchema,
      resultSchema: AppSnapshotSchema,
      isTrustedSender: trustedSender,
      handler: () => stateService.snapshot(),
    }),
  );
  lifecycle.add(
    stateService.subscribe((event) => {
      for (const patch of event.patches) {
        if (patch.kind === 'connection') logConnection(logs, patch.value);
        else logs.transition('app', `Lifecycle ${patch.value}`, 'LIFECYCLE');
      }
      const envelope = StateChangedEventSchema.parse({
        protocolVersion: 1,
        eventId: randomUUID(),
        emittedAt: new Date().toISOString(),
        payload: event,
      });
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.stateChanged, envelope);
      }
    }),
  );

  const captureWindow = await createAudioCaptureWindow(isDevelopment, developmentServerUrl);
  const settings = new SecureSettingsStore(resolve(app.getPath('userData'), 'secure-settings.enc'));
  const persistedSettings = await settings.load();
  const audioServiceRef: { current?: PttAudioService } = {};
  let audioSuppressedForSpeech = false;
  const handsFreeConversation = new HandsFreeConversation(
    persistedSettings.handsFree,
    (projection) => {
      logs.transition(
        'hands-free',
        `Hands-free ${projection.phase.replaceAll('_', ' ')}`,
        projection.reasonCode,
        projection.phase === 'error' ? 'error' : 'info',
      );
      const envelope = HandsFreeChangedEventSchema.parse({
        protocolVersion: 1,
        eventId: randomUUID(),
        emittedAt: new Date().toISOString(),
        payload: projection,
      });
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed() && window.id !== captureWindow.id) {
          window.webContents.send(IPC_CHANNELS.handsFreeChanged, envelope);
        }
      }
      const shouldSuppress = projection.phase === 'speaking';
      if (shouldSuppress !== audioSuppressedForSpeech) {
        audioSuppressedForSpeech = shouldSuppress;
        audioServiceRef.current?.setSuppressed(shouldSuppress);
      }
    },
  );
  const pilotOverlayWindow = await createPilotOverlayWindow(isDevelopment, developmentServerUrl);
  const pilotOverlay = new PilotOverlayController(
    pilotOverlayWindow,
    persistedSettings.pilotOverlay,
    (pilotOverlayPreferences) => settings.update({ pilotOverlay: pilotOverlayPreferences }),
  );
  lifecycle.add(() => {
    pilotOverlay.dispose();
    if (!pilotOverlayWindow.isDestroyed()) pilotOverlayWindow.destroy();
  });
  const groqClient =
    environment.GROQ_API_KEY === undefined
      ? undefined
      : createGroqClient({ apiKey: environment.GROQ_API_KEY });
  const wisprApiKey = environment.WISPR_FLOW_API_KEY;
  const voiceOrchestrator =
    wisprApiKey === undefined
      ? undefined
      : new VoiceOrchestrator({
          transcription: new WisprTranscriptionAdapter({
            apiKey: wisprApiKey,
            onEvent: (event) =>
              logs.write(
                event.level,
                'wispr',
                event.event === 'wispr.transcription.started'
                  ? 'Transcribing with Wispr Flow'
                  : `Transcription ${event.outcome ?? 'finished'}`,
                event.durationMs === undefined ? undefined : `${event.durationMs} ms`,
              ),
            // Flow spells these right instead of guessing: the wake phrase and live OBS names.
            dictionary: () => {
              const obs = obsBridge.snapshot();
              return [
                'ObscurPilot',
                'Obscur',
                'OBS',
                'Twitch',
                settings.snapshot().handsFree.wakePhrase,
                ...(obs?.scenes.map((scene) => scene.name) ?? []),
                ...(obs?.inputs.map((input) => input.name) ?? []),
              ];
            },
          }),
          onProjection: (projection) => {
            logs.transition(
              'agent',
              `Agent ${projection.phase.replaceAll('_', ' ')}`,
              projection.reasonCode,
              projection.phase === 'error' ? 'error' : 'info',
            );
            handsFreeConversation.syncAgent(projection);
            const envelope = AgentInteractionChangedEventSchema.parse({
              protocolVersion: 1,
              eventId: randomUUID(),
              emittedAt: new Date().toISOString(),
              payload: projection,
            });
            for (const window of BrowserWindow.getAllWindows()) {
              if (!window.isDestroyed() && window.id !== captureWindow.id) {
                window.webContents.send(IPC_CHANNELS.agentInteractionChanged, envelope);
              }
            }
          },
          onConnection: (projection) => stateService.setConnection(projection),
        });
  for (const [provider, configured] of [
    ['wispr', voiceOrchestrator !== undefined],
    ['groq', groqClient !== undefined],
  ] as const) {
    stateService.setConnection({
      provider,
      phase: 'idle',
      attempt: 0,
      changedAt: new Date().toISOString(),
      reasonCode: configured ? 'CONFIGURED' : 'NOT_CONFIGURED',
      correlationId: randomUUID(),
    });
  }
  if (voiceOrchestrator !== undefined) {
    lifecycle.add(() => voiceOrchestrator.dispose());
  }
  const activeAudioService = new PttAudioService(
    ipcMain,
    captureWindow,
    settings,
    (envelope) => {
      const { phase, reasonCode } = envelope.payload;
      logs.transition(
        'voice',
        `Capture ${phase}`,
        reasonCode,
        phase === 'error' || phase === 'rejected' ? 'warn' : 'debug',
      );
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed() && window.id !== captureWindow.id) {
          window.webContents.send(IPC_CHANNELS.pttChanged, envelope);
        }
      }
    },
    (clip, source) => voiceOrchestrator?.processClip(clip, source),
    (phase, reasonCode, level) => handsFreeConversation.audioPhase(phase, reasonCode, level),
  );
  audioServiceRef.current = activeAudioService;
  await activeAudioService.start();
  lifecycle.add(() => activeAudioService.dispose());

  // OBS's own WebSocket settings on this machine win over .env, so no password copying.
  const obsSettingsPath = obsWebSocketConfigPath(app.getPath('appData'));
  let lastObsFailure: string | undefined;
  const obsBridge = new ObsBridge({
    credentials: () => {
      const local = readObsWebSocketSettings(obsSettingsPath);
      if (local !== undefined) {
        return {
          url: `ws://127.0.0.1:${local.port}`,
          ...(local.password === undefined ? {} : { password: local.password }),
        };
      }
      return {
        url: environment.OBS_WEBSOCKET_URL,
        ...(environment.OBS_WEBSOCKET_PASSWORD === undefined
          ? {}
          : { password: environment.OBS_WEBSOCKET_PASSWORD }),
      };
    },
    onConnection: (projection) => stateService.setConnection(projection),
    onFailure: (reasonCode, cause) => {
      // Backoff retries repeat the same cause; only the first occurrence is worth a warning.
      const level = cause === lastObsFailure ? 'debug' : 'warn';
      logs.write(level, 'obs', obsFailureHint(reasonCode), cause);
      lastObsFailure = cause;
    },
  });
  lifecycle.add(() => obsBridge.dispose());
  const obsExecutable = findObsExecutable(environment.OBS_EXECUTABLE_PATH);
  logs.info(
    'obs',
    obsExecutable === undefined ? 'OBS Studio not found on this PC' : 'OBS Studio found',
    obsExecutable ?? 'Install OBS Studio or set its path in .env',
  );
  const obsProcessSupervisor = new ObsProcessSupervisor({
    ...(obsExecutable === undefined ? {} : { executablePath: obsExecutable }),
    getSnapshot: () => obsBridge.snapshot(),
    reconnect: () => obsBridge.reconnect(),
  });

  const cloudBridge =
    environment.SUPABASE_URL !== undefined && environment.SUPABASE_ANON_KEY !== undefined
      ? new CloudBridge({
          url: environment.SUPABASE_URL,
          publishableKey: environment.SUPABASE_ANON_KEY,
          appVersion: app.getVersion(),
          userDataPath: app.getPath('userData'),
          platform: getSupportedPlatform(),
          onConnection: (projection) => stateService.setConnection(projection),
        })
      : undefined;
  if (cloudBridge === undefined) {
    stateService.setConnection({
      provider: 'supabase',
      phase: 'idle',
      attempt: 0,
      changedAt: new Date().toISOString(),
      reasonCode: 'NOT_CONFIGURED',
      correlationId: randomUUID(),
    });
  } else {
    lifecycle.add(() => cloudBridge.dispose());
  }

  const chatIntelligence = new BoundedChatIntelligence();
  const twitchBridge =
    cloudBridge !== undefined && environment.TWITCH_CLIENT_ID !== undefined
      ? new TwitchBridge({
          clientId: environment.TWITCH_CLIENT_ID,
          cloud: cloudBridge,
          userDataPath: app.getPath('userData'),
          encryption: requireSecureEncryptionProvider(safeStorage, getSupportedPlatform()),
          openExternal: (url) => shell.openExternal(url, { activate: true }),
          onConnection: (projection) => stateService.setConnection(projection),
          onProjection: (projection) => {
            const phase =
              projection.phase === 'connected'
                ? 'ready'
                : projection.phase === 'authorizing'
                  ? 'authenticating'
                  : projection.phase === 'connecting'
                    ? 'synchronizing'
                    : projection.phase === 'backoff'
                      ? 'backoff'
                      : projection.phase === 'degraded'
                        ? 'degraded'
                        : projection.phase === 'signed_out'
                          ? 'auth_required'
                          : 'idle';
            stateService.setConnection({
              provider: 'twitch',
              phase,
              attempt: 0,
              changedAt: new Date().toISOString(),
              reasonCode: projection.reasonCode,
              correlationId: randomUUID(),
            });
          },
          onActivity: (activity) => {
            const envelope = TwitchActivityEventSchema.parse({
              protocolVersion: 1,
              eventId: randomUUID(),
              emittedAt: new Date().toISOString(),
              payload: activity,
            });
            for (const window of BrowserWindow.getAllWindows()) {
              if (!window.isDestroyed())
                window.webContents.send(IPC_CHANNELS.twitchActivity, envelope);
            }
          },
          onChatMessage: (input) => {
            const result = chatIntelligence.ingest(input);
            if (!result.accepted || result.message === undefined || result.analysis === undefined)
              return;
            const messageEnvelope = ChatMessageEventSchema.parse({
              protocolVersion: 1,
              eventId: randomUUID(),
              emittedAt: new Date().toISOString(),
              payload: result.message,
            });
            const analysisEnvelope = ChatAnalysisEventSchema.parse({
              protocolVersion: 1,
              eventId: randomUUID(),
              emittedAt: new Date().toISOString(),
              payload: result.analysis,
            });
            for (const window of BrowserWindow.getAllWindows()) {
              if (window.isDestroyed() || window.id === captureWindow.id) continue;
              window.webContents.send(IPC_CHANNELS.chatMessage, messageEnvelope);
              window.webContents.send(IPC_CHANNELS.chatAnalysis, analysisEnvelope);
            }
          },
        })
      : undefined;
  if (twitchBridge === undefined) {
    stateService.setConnection({
      provider: 'twitch',
      phase: 'idle',
      attempt: 0,
      changedAt: new Date().toISOString(),
      reasonCode: 'NOT_CONFIGURED',
      correlationId: randomUUID(),
    });
  } else {
    lifecycle.add(() => twitchBridge.dispose());
  }

  const waitForObsRefresh = async (
    previousVersion: number,
    signal?: AbortSignal,
  ): Promise<void> => {
    const deadline = Date.now() + 6_000;
    while (Date.now() < deadline) {
      if (signal?.aborted) throw signal.reason;
      const snapshot = obsBridge.snapshot();
      if (snapshot !== undefined && snapshot.snapshotVersion > previousVersion) return;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
    throw new Error('OBS_SNAPSHOT_REFRESH_TIMEOUT');
  };
  const executeObs = async (
    commandId: string,
    command: ObsCommandRequest,
    signal?: AbortSignal,
  ): Promise<void> => {
    const snapshot = obsBridge.snapshot();
    if (snapshot === undefined) throw new Error('OBS_NOT_SYNCHRONIZED');
    await obsBridge.execute(
      {
        commandId,
        expectedSnapshotVersion: snapshot.snapshotVersion,
        expectedGeneration: snapshot.generation,
        command,
        timeoutMs: 5_000,
      },
      signal,
    );
    await waitForObsRefresh(snapshot.snapshotVersion, signal);
  };
  const provisionVoiceProduction = async (signal?: AbortSignal) => {
    await obsProcessSupervisor.ensureReady();
    let snapshot = obsBridge.snapshot();
    if (snapshot === undefined) throw new Error('OBS_NOT_SYNCHRONIZED');
    if (snapshot.streamActive || snapshot.recordActive) {
      throw new Error('OBS_OUTPUT_ACTIVE_PROVISIONING_DENIED');
    }
    const preLiveSceneName = 'ObscurPilot - Starting Soon';
    const liveSceneName = 'ObscurPilot - Live';
    const countdownInputName = 'ObscurPilot Countdown';
    const gameInputName = 'ObscurPilot Game Capture';
    const sceneNames = new Set(snapshot.scenes.map((scene) => scene.name));
    for (const sceneName of [preLiveSceneName, liveSceneName]) {
      if (sceneNames.has(sceneName)) continue;
      await executeObs(
        randomUUID(),
        { requestType: 'CreateScene', requestData: { sceneName } },
        signal,
      );
    }
    snapshot = obsBridge.snapshot();
    if (snapshot === undefined) throw new Error('OBS_NOT_SYNCHRONIZED');
    const inputNames = new Set(snapshot.inputs.map((input) => input.name));
    if (!inputNames.has(countdownInputName)) {
      const requestData = {
        sceneName: preLiveSceneName,
        inputName: countdownInputName,
        inputKind: process.platform === 'win32' ? 'text_gdiplus_v3' : 'text_ft2_source_v2',
        inputSettings: {
          text: 'Starting Soon\n05:00',
          align: 'center',
          valign: 'center',
          font: { face: 'Inter', size: 72, style: 'Bold' },
        },
        sceneItemEnabled: true,
      };
      try {
        await executeObs(randomUUID(), { requestType: 'CreateInput', requestData }, signal);
      } catch (error: unknown) {
        if (process.platform !== 'win32') throw error;
        await executeObs(
          randomUUID(),
          {
            requestType: 'CreateInput',
            requestData: { ...requestData, inputKind: 'text_gdiplus' },
          },
          signal,
        );
      }
    }
    snapshot = obsBridge.snapshot();
    if (snapshot === undefined) throw new Error('OBS_NOT_SYNCHRONIZED');
    if (!snapshot.inputs.some((input) => input.name === gameInputName)) {
      await executeObs(
        randomUUID(),
        {
          requestType: 'CreateInput',
          requestData: {
            sceneName: liveSceneName,
            inputName: gameInputName,
            inputKind: 'game_capture',
            inputSettings: {
              capture_mode: 'any_fullscreen',
              capture_cursor: true,
              allow_transparency: false,
            },
            sceneItemEnabled: true,
          },
        },
        signal,
      );
    }
    snapshot = obsBridge.snapshot();
    if (snapshot === undefined) throw new Error('OBS_NOT_SYNCHRONIZED');
    return {
      snapshot,
      preLiveSceneName,
      liveSceneName,
      countdownInputName,
      gameInputName,
    };
  };
  const obsSessionPort: LiveSessionObsPort = {
    snapshot: () => obsBridge.snapshot(),
    setProgramScene: async (sceneName, commandId, signal) => {
      if (obsBridge.snapshot()?.currentProgramSceneName === sceneName) return;
      await executeObs(
        commandId,
        { requestType: 'SetCurrentProgramScene', requestData: { sceneName } },
        signal,
      );
    },
    setCountdownText: (inputName, text, commandId, signal) =>
      executeObs(
        commandId,
        {
          requestType: 'SetInputSettings',
          requestData: { inputName, inputSettings: { text }, overlay: true },
        },
        signal,
      ),
    startStream: async (commandId, signal) => {
      if (obsBridge.snapshot()?.streamActive) return;
      await executeObs(commandId, { requestType: 'StartStream' }, signal);
    },
    stopStream: async (commandId, signal) => {
      if (!obsBridge.snapshot()?.streamActive) return;
      await executeObs(commandId, { requestType: 'StopStream' }, signal);
    },
    startRecord: async (commandId, signal) => {
      if (obsBridge.snapshot()?.recordActive) return;
      await executeObs(commandId, { requestType: 'StartRecord' }, signal);
    },
    stopRecord: async (commandId, signal) => {
      if (!obsBridge.snapshot()?.recordActive) return;
      await executeObs(commandId, { requestType: 'StopRecord' }, signal);
    },
  };
  const twitchSessionPort: LiveSessionTwitchPort = {
    preflight: (profile, mode) => {
      if (mode === 'dry_run') {
        const metadata: TwitchMetadata = {
          title: profile.twitch.title,
          categoryId: profile.twitch.categoryId,
          categoryName: profile.twitch.categoryName,
          tags: [...profile.twitch.tags],
          language: profile.twitch.language,
        };
        return Promise.resolve({ metadata, scopes: [], categoryValid: true, live: false });
      }
      if (twitchBridge === undefined) return Promise.reject(new Error('TWITCH_NOT_CONFIGURED'));
      return twitchBridge.sessionPreflight(profile);
    },
    updateMetadata: async (metadata) => {
      if (twitchBridge === undefined) throw new Error('TWITCH_NOT_CONFIGURED');
      await twitchBridge.updateMetadata(metadata);
    },
    restoreMetadata: async (metadata) => {
      if (twitchBridge === undefined) throw new Error('TWITCH_NOT_CONFIGURED');
      await twitchBridge.restoreMetadata(metadata);
    },
    isLive: () =>
      twitchBridge === undefined
        ? Promise.reject(new Error('TWITCH_NOT_CONFIGURED'))
        : twitchBridge.isLive(),
  };
  const liveSession = new LiveSessionCoordinator({
    obs: obsSessionPort,
    twitch: twitchSessionPort,
    onProjection: (projection) => {
      logs.transition(
        'live',
        `Live session ${projection.phase.replaceAll('_', ' ')}`,
        projection.reasonCode,
        projection.phase === 'failed' ? 'error' : 'info',
      );
      const envelope = LiveSessionChangedEventSchema.parse({
        protocolVersion: 1,
        eventId: randomUUID(),
        emittedAt: new Date().toISOString(),
        payload: projection,
      });
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed() && window.id !== captureWindow.id) {
          window.webContents.send(IPC_CHANNELS.liveSessionChanged, envelope);
        }
      }
      if (projection.phase === 'live') {
        handsFreeConversation.speak(
          'The countdown is complete. OBS and Twitch are verified live.',
          'LIVE_SESSION_VERIFIED',
        );
      }
      if (projection.phase === 'failed') {
        handsFreeConversation.speak(
          'I could not start the stream. The reason is ' +
            projection.reasonCode.replaceAll('_', ' ').toLocaleLowerCase('en-US') +
            '.',
          'LIVE_SESSION_FAILED',
        );
      }
      if (projection.phase === 'stopped') {
        handsFreeConversation.speak(
          'The production session is stopped and the output is offline.',
          'LIVE_SESSION_STOPPED',
        );
      }
    },
  });
  lifecycle.add(() => liveSession.dispose());

  const toggleMainWindow = (): void => {
    if (mainWindow.isDestroyed()) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  };
  const shortcutService = new GlobalShortcutService({
    onHoldToTalkDown: () => {
      voiceOrchestrator?.cancel('SUPERSEDED');
      activeAudioService.press();
    },
    onHoldToTalkUp: () => {
      activeAudioService.release();
    },
    onToggleTalk: () => {
      const phase = activeAudioService.projection().phase;
      if (phase === 'arming' || phase === 'capturing') {
        activeAudioService.release();
      } else {
        voiceOrchestrator?.cancel('SUPERSEDED');
        activeAudioService.press();
      }
    },
    onTerminate: () => {
      activeAudioService.cancel();
      voiceOrchestrator?.cancel();
      void liveSession.stop(true).catch(() => undefined);
    },
    onToggleWindow: toggleMainWindow,
  });
  try {
    shortcutService.setBindings(settings.snapshot().shortcuts);
  } catch (error: unknown) {
    logs.warn(
      'shortcuts',
      'Stored shortcuts are unusable, falling back to defaults',
      error instanceof Error ? error.message : 'unknown reason',
    );
    shortcutService.setBindings(DEFAULT_SHORTCUT_BINDINGS);
    await settings.update({ shortcuts: DEFAULT_SHORTCUT_BINDINGS });
  }
  lifecycle.add(() => shortcutService.dispose());

  const trayIcon = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_BASE64}`);
  const tray = new Tray(trayIcon);
  tray.setToolTip('ObscurPilot — hold your talk shortcut to speak');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open ObscurPilot', click: toggleMainWindow },
      { type: 'separator' },
      { label: 'Quit ObscurPilot', click: () => app.quit() },
    ]),
  );
  tray.on('click', toggleMainWindow);
  lifecycle.add(() => tray.destroy());

  mainWindow.on('close', (event) => {
    if (shutdownStarted) return;
    event.preventDefault();
    mainWindow.hide();
  });

  const moderationGuard = new ModerationGuard(new Set());

  if (voiceOrchestrator !== undefined && groqClient !== undefined) {
    const registry = new ToolRegistry();
    let pendingVoicePreparation:
      | {
          readonly categoryQuery: string;
          readonly title?: string;
          readonly countdownSeconds: number;
          readonly mode: 'dry_run' | 'live';
        }
      | undefined;
    const getGrants = () => cloudBridge?.toolGrantSnapshot() ?? [];
    for (const tool of createObsProductionTools(obsBridge, { getGrants })) {
      registry.register(tool);
    }
    registry.register({
      name: 'twitch.read_connection',
      version: 1,
      risk: 'observe',
      modelName: 'twitch_read_connection_v1',
      description: 'Read the redacted Twitch connection and EventSub readiness state.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      parse: (input) => {
        if (typeof input !== 'object' || input === null || Object.keys(input).length !== 0) {
          throw new Error('twitch.read_connection accepts an empty object');
        }
        return {};
      },
      authorize: async (context) =>
        authorizeTool(getGrants(), {
          now: Date.now(),
          toolName: 'twitch.read_connection',
          requiredScope: 'twitch:read',
          risk: 'observe',
          confirmed: context.confirmed === true,
        }),
      execute: async () => {
        const projection = twitchBridge?.snapshot();
        return {
          configured: projection?.configured ?? false,
          phase: projection?.phase ?? 'not_configured',
          reasonCode: projection?.reasonCode ?? 'NOT_CONFIGURED',
          eventSubReady: projection?.reasonCode === 'EVENTSUB_READY',
        };
      },
    });
    registry.register({
      name: 'live_session.auto_prepare',
      version: 1,
      risk: 'reversible',
      modelName: 'live_session_auto_prepare_v1',
      description:
        'Automatically resolve a Twitch category, provision safe ObscurPilot Starting Soon and Live OBS resources, save a profile, and prepare an immutable plan. This never starts streaming.',
      parameters: {
        type: 'object',
        properties: {
          categoryQuery: { type: 'string', minLength: 1, maxLength: 120 },
          title: { type: 'string', minLength: 1, maxLength: 140 },
          countdownSeconds: { type: 'integer', minimum: 0, maximum: 3600 },
          mode: { type: 'string', enum: ['dry_run', 'live'] },
        },
        required: ['categoryQuery', 'mode'],
        additionalProperties: false,
      },
      parse: (input) => {
        const value = stage11Record(input);
        if (
          Object.keys(value).some(
            (key) => !['categoryQuery', 'title', 'countdownSeconds', 'mode'].includes(key),
          )
        ) {
          throw new Error('UNKNOWN_AUTO_PREPARE_ARGUMENT');
        }
        const countdownSeconds =
          value.countdownSeconds === undefined ? 300 : Number(value.countdownSeconds);
        if (
          !Number.isInteger(countdownSeconds) ||
          countdownSeconds < 0 ||
          countdownSeconds > 3_600
        ) {
          throw new Error('COUNTDOWN_SECONDS_INVALID');
        }
        if (!['dry_run', 'live'].includes(String(value.mode))) {
          throw new Error('LIVE_SESSION_MODE_REQUIRED');
        }
        return {
          categoryQuery: stage11String(value, 'categoryQuery', 120),
          ...(typeof value.title === 'string' && value.title.trim()
            ? { title: value.title.trim().slice(0, 140) }
            : {}),
          countdownSeconds,
          mode: value.mode as 'dry_run' | 'live',
        };
      },
      authorize: async (context) =>
        authorizeTool(getGrants(), {
          now: Date.now(),
          toolName: 'live_session.auto_prepare',
          requiredScope: 'session:prepare',
          risk: 'reversible',
          confirmed: context.confirmed === true,
        }),
      execute: async (context, input) => {
        if (twitchBridge === undefined) throw new Error('TWITCH_NOT_CONFIGURED');
        pendingVoicePreparation = input;
        const twitchProjection = twitchBridge.snapshot();
        if (twitchProjection.phase !== 'connected') {
          if (twitchProjection.phase !== 'authorizing') {
            await twitchBridge.connect();
          }
          return {
            phase: 'authorization_required',
            reasonCode: 'TWITCH_AUTHORIZATION_OPENED',
            authorizationRequired: true,
            nextInstruction:
              'Approve Twitch in the browser, return to ObscurPilot, and say continue preparing the stream.',
          };
        }
        const [categories, resources] = await Promise.all([
          twitchBridge.searchCategories(input.categoryQuery),
          provisionVoiceProduction(context.signal),
        ]);
        const category =
          categories.find(
            (candidate) =>
              candidate.name.toLocaleLowerCase('en-US') ===
              input.categoryQuery.toLocaleLowerCase('en-US'),
          ) ?? categories[0];
        if (category === undefined) throw new Error('TWITCH_CATEGORY_NOT_FOUND');
        const profileName = category.name + ' voice';
        const existing = settings
          .snapshot()
          .liveSessionProfiles.find(
            (profile) =>
              profile.name.toLocaleLowerCase('en-US') === profileName.toLocaleLowerCase('en-US'),
          );
        const profile: LiveSessionProfileV1 = {
          schemaVersion: 1,
          profileId: existing?.profileId ?? randomUUID(),
          revision: (existing?.revision ?? 0) + 1,
          name: profileName,
          twitch: {
            title: input.title ?? category.name + ' - Live with ObscurPilot',
            categoryId: category.id,
            categoryName: category.name,
            tags: [],
            language: 'en',
          },
          obs: {
            sceneCollectionName: resources.snapshot.sceneCollectionName,
            preLiveSceneName: resources.preLiveSceneName,
            liveSceneName: resources.liveSceneName,
            requiredInputs: [resources.countdownInputName, resources.gameInputName],
            countdownSeconds: input.countdownSeconds,
            countdownInputName: resources.countdownInputName,
            recording: 'off',
          },
          verification: {
            obsReadyTimeoutMs: 30_000,
            twitchLiveTimeoutMs: 120_000,
          },
        };
        const current = settings.snapshot();
        await settings.update({
          liveSessionProfiles: [
            ...current.liveSessionProfiles.filter(
              (candidate) => candidate.profileId !== profile.profileId,
            ),
            profile,
          ].slice(-20),
          activeLiveSessionProfileId: profile.profileId,
        });
        const projection = await liveSession.prepare(profile, input.mode);
        pendingVoicePreparation = undefined;
        return {
          phase: projection.phase,
          reasonCode: projection.reasonCode,
          profileName: profile.name,
          categoryName: category.name,
          countdownSeconds: profile.obs.countdownSeconds,
          planId: projection.plan?.planId,
        };
      },
    });
    registry.register({
      name: 'live_session.prepare_profile',
      version: 1,
      risk: 'reversible',
      modelName: 'live_session_prepare_profile_v1',
      description:
        'Prepare and validate one creator-saved live-session profile by exact name. This never starts an output.',
      parameters: {
        type: 'object',
        properties: {
          profileName: { type: 'string', minLength: 1, maxLength: 80 },
          mode: { type: 'string', enum: ['dry_run', 'live'] },
        },
        required: ['profileName', 'mode'],
        additionalProperties: false,
      },
      parse: (input) => {
        if (typeof input !== 'object' || input === null || Array.isArray(input)) {
          throw new Error('live_session.prepare_profile requires an object');
        }
        const value = input as Record<string, unknown>;
        if (
          Object.keys(value).some((key) => !['profileName', 'mode'].includes(key)) ||
          typeof value.profileName !== 'string' ||
          !['dry_run', 'live'].includes(String(value.mode))
        ) {
          throw new Error('A saved profileName and dry_run or live mode are required');
        }
        return {
          profileName: value.profileName.trim(),
          mode: value.mode as 'dry_run' | 'live',
        };
      },
      authorize: async (context) =>
        authorizeTool(getGrants(), {
          now: Date.now(),
          toolName: 'live_session.prepare_profile',
          requiredScope: 'session:prepare',
          risk: 'reversible',
          confirmed: context.confirmed === true,
        }),
      execute: async (_context, input) => {
        const normalized = input.profileName.toLocaleLowerCase('en-US');
        const matches = settings
          .snapshot()
          .liveSessionProfiles.filter(
            (profile) => profile.name.toLocaleLowerCase('en-US') === normalized,
          );
        if (matches.length !== 1) {
          throw new Error(
            matches.length === 0 ? 'SAVED_PROFILE_NOT_FOUND' : 'SAVED_PROFILE_NAME_AMBIGUOUS',
          );
        }
        await obsProcessSupervisor.ensureReady();
        const projection = await liveSession.prepare(matches[0]!, input.mode);
        return {
          phase: projection.phase,
          reasonCode: projection.reasonCode,
          planId: projection.plan?.planId,
          planHash: projection.plan?.planHash,
          expiresAt: projection.plan?.expiresAt,
        };
      },
    });
    registry.register({
      name: 'live_session.start_prepared',
      version: 1,
      risk: 'confirm',
      modelName: 'live_session_start_prepared_v1',
      description:
        'Approve and start the currently prepared immutable live-session plan after creator confirmation.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      parse: (input) => {
        if (typeof input !== 'object' || input === null || Object.keys(input).length !== 0) {
          throw new Error('live_session.start_prepared accepts an empty object');
        }
        return {};
      },
      authorize: async (context) =>
        authorizeTool(getGrants(), {
          now: Date.now(),
          toolName: 'live_session.start_prepared',
          requiredScope: 'session:start',
          risk: 'confirm',
          confirmed: context.confirmed === true,
        }),
      execute: async () => {
        const projection = liveSession.snapshot();
        if (projection.phase !== 'awaiting_confirmation' || projection.plan === undefined) {
          throw new Error('NO_PREPARED_PLAN');
        }
        const next = liveSession.decide(projection.plan.planId, 'approve');
        return { phase: next.phase, reasonCode: next.reasonCode, planId: projection.plan.planId };
      },
    });
    registry.register({
      name: 'live_session.stop',
      version: 1,
      risk: 'confirm',
      modelName: 'live_session_stop_v1',
      description: 'Stop active OBS streaming and recording outputs after creator confirmation.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      parse: (input) => {
        if (typeof input !== 'object' || input === null || Object.keys(input).length !== 0) {
          throw new Error('live_session.stop accepts an empty object');
        }
        return {};
      },
      authorize: async (context) =>
        authorizeTool(getGrants(), {
          now: Date.now(),
          toolName: 'live_session.stop',
          requiredScope: 'session:stop',
          risk: 'confirm',
          confirmed: context.confirmed === true,
        }),
      execute: async () => {
        const projection = await liveSession.stop(false);
        return { phase: projection.phase, reasonCode: projection.reasonCode };
      },
    });
    const twitchMutationTools = [
      {
        name: 'twitch.channel.update',
        scope: 'twitch:channel:write',
        description: 'Update the Twitch channel title, category, tags, and language.',
      },
      {
        name: 'twitch.chat.send_message',
        scope: 'twitch:chat:write',
        description: 'Send one public Twitch chat message as the authenticated creator.',
      },
      {
        name: 'twitch.chat.delete_message',
        scope: 'twitch:chat:moderate',
        description: 'Delete one Twitch chat message locked to its immutable message and user IDs.',
      },
      {
        name: 'twitch.moderation.timeout_user',
        scope: 'twitch:moderate',
        description: 'Timeout one resolved Twitch user for a bounded duration.',
      },
      {
        name: 'twitch.moderation.ban_user',
        scope: 'twitch:moderate',
        description: 'Permanently ban one resolved Twitch channel user.',
      },
      {
        name: 'twitch.moderation.unban_user',
        scope: 'twitch:moderate',
        description: 'Remove a channel ban from one resolved Twitch user.',
      },
      {
        name: 'twitch.user.block',
        scope: 'twitch:user:block',
        description:
          'Personally block one resolved Twitch user without changing channel moderation.',
      },
      {
        name: 'twitch.user.unblock',
        scope: 'twitch:user:block',
        description: 'Remove a personal block from one resolved Twitch user.',
      },
    ] as const;
    for (const specification of twitchMutationTools) {
      registry.register<Stage11TwitchToolInput, unknown>({
        name: specification.name,
        version: 1,
        risk: 'confirm',
        modelName: specification.name.replaceAll('.', '_') + '_v1',
        description: specification.description,
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 140 },
            categoryId: { type: 'string', pattern: '^[0-9]{1,32}$' },
            categoryName: { type: 'string', minLength: 1, maxLength: 120 },
            tags: {
              type: 'array',
              items: { type: 'string', minLength: 1, maxLength: 25 },
              maxItems: 10,
            },
            language: { type: 'string', pattern: '^[a-z]{2}$' },
            text: { type: 'string', minLength: 1, maxLength: 500 },
            targetUserId: { type: 'string', minLength: 1, maxLength: 128 },
            targetLogin: { type: 'string', minLength: 1, maxLength: 80 },
            messageId: { type: 'string', minLength: 1, maxLength: 256 },
            evidenceMessageId: { type: 'string', minLength: 1, maxLength: 256 },
            durationSeconds: {
              type: 'integer',
              minimum: 1,
              maximum: 1_209_600,
            },
            reason: { type: 'string', minLength: 1, maxLength: 500 },
          },
          additionalProperties: false,
        },
        parse: (input) => {
          const value = stage11Record(input);
          const allowed = new Set([
            'title',
            'categoryId',
            'categoryName',
            'tags',
            'language',
            'text',
            'targetUserId',
            'targetLogin',
            'messageId',
            'evidenceMessageId',
            'durationSeconds',
            'reason',
          ]);
          if (Object.keys(value).some((key) => !allowed.has(key))) {
            throw new Error('UNKNOWN_TOOL_ARGUMENT');
          }
          if (specification.name === 'twitch.channel.update') {
            const tags = value.tags;
            return {
              title: stage11String(value, 'title', 140),
              categoryId: stage11String(value, 'categoryId', 32),
              categoryName: stage11String(value, 'categoryName', 120),
              tags: Array.isArray(tags)
                ? tags
                    .map((tag) => String(tag).trim())
                    .filter(Boolean)
                    .slice(0, 10)
                : [],
              language: stage11String(value, 'language', 2).toLowerCase(),
            };
          }
          if (specification.name === 'twitch.chat.send_message') {
            return { text: stage11String(value, 'text') };
          }
          const common: Stage11TwitchToolInput = {
            targetUserId: stage11String(value, 'targetUserId', 128),
            targetLogin: stage11String(value, 'targetLogin', 80),
            reason:
              typeof value.reason === 'string' && value.reason.trim()
                ? value.reason.trim().slice(0, 500)
                : 'Creator-approved voice moderation action',
            ...(typeof value.evidenceMessageId === 'string'
              ? { evidenceMessageId: value.evidenceMessageId }
              : {}),
          };
          if (specification.name === 'twitch.chat.delete_message') {
            return { ...common, messageId: stage11String(value, 'messageId', 256) };
          }
          if (specification.name === 'twitch.moderation.timeout_user') {
            const durationSeconds = Number(value.durationSeconds);
            if (
              !Number.isInteger(durationSeconds) ||
              durationSeconds < 1 ||
              durationSeconds > 1_209_600
            ) {
              throw new Error('TIMEOUT_DURATION_REQUIRED');
            }
            return { ...common, durationSeconds };
          }
          return common;
        },
        authorize: async (context) =>
          authorizeTool(getGrants(), {
            now: Date.now(),
            toolName: specification.name,
            requiredScope: specification.scope,
            risk: 'confirm',
            confirmed: context.confirmed === true,
          }),
        execute: async (_context, input) => {
          if (twitchBridge === undefined) throw new Error('TWITCH_NOT_CONFIGURED');
          if (specification.name === 'twitch.channel.update') {
            await twitchBridge.updateMetadata(
              TwitchMetadataSchema.parse({
                title: input.title,
                categoryId: input.categoryId,
                categoryName: input.categoryName,
                tags: input.tags,
                language: input.language,
              }),
            );
            return { accepted: true };
          }
          if (specification.name === 'twitch.chat.send_message') {
            return { messageId: await twitchBridge.sendMessage(input.text ?? '') };
          }
          const actionByTool = {
            'twitch.chat.delete_message': 'delete_message',
            'twitch.moderation.timeout_user': 'timeout_user',
            'twitch.moderation.ban_user': 'ban_user',
            'twitch.moderation.unban_user': 'unban_user',
            'twitch.user.block': 'block_user',
            'twitch.user.unblock': 'unblock_user',
          } as const;
          const intent = ModerationIntentV1Schema.parse({
            schemaVersion: 1,
            intentId: randomUUID(),
            action: actionByTool[specification.name],
            targetUserId: input.targetUserId,
            targetLogin: input.targetLogin,
            ...(input.messageId === undefined ? {} : { messageId: input.messageId }),
            ...(input.durationSeconds === undefined
              ? {}
              : { durationSeconds: input.durationSeconds }),
            reason: input.reason,
            ...(input.evidenceMessageId === undefined
              ? {}
              : { evidenceMessageId: input.evidenceMessageId }),
          });
          const evidence =
            intent.evidenceMessageId === undefined
              ? undefined
              : chatIntelligence.get(intent.evidenceMessageId);
          moderationGuard.authorize(
            intent,
            evidence,
            twitchBridge.snapshot().account?.providerUserId ?? '',
            true,
          );
          await twitchBridge.executeModeration(intent);
          moderationGuard.complete(intent.intentId);
          return {
            accepted: true,
            targetUserId: intent.targetUserId,
            targetLogin: intent.targetLogin,
            action: intent.action,
          };
        },
      });
    }
    const reasoning = new GuardedReasoningOrchestrator({
      reasoning: new GroqReasoningAdapter({
        primaryModel: environment.GROQ_REASONING_MODEL,
        ...(environment.GROQ_REASONING_FALLBACK_MODEL === undefined
          ? {}
          : { fallbackModel: environment.GROQ_REASONING_FALLBACK_MODEL }),
        transport: createSdkReasoningTransport(groqClient),
      }),
      registry,
      getSnapshot: () => {
        const obs = obsBridge.snapshot();
        const twitch = twitchBridge?.snapshot();
        return {
          redactedContext: JSON.stringify({
            obs:
              obs === undefined
                ? { ready: false }
                : {
                    ready: true,
                    snapshotVersion: obs.snapshotVersion,
                    generation: obs.generation,
                    currentProgramSceneName: obs.currentProgramSceneName,
                    streamActive: obs.streamActive,
                    recordActive: obs.recordActive,
                    scenes: obs.scenes.slice(0, 100).map((scene) => scene.name),
                    inputs: obs.inputs.slice(0, 100).map((input) => input.name),
                  },
            twitch: {
              configured: twitch?.configured ?? false,
              phase: twitch?.phase ?? 'not_configured',
              eventSubReady: twitch?.reasonCode === 'EVENTSUB_READY',
            },
            liveSession: {
              phase: liveSession.snapshot().phase,
              reasonCode: liveSession.snapshot().reasonCode,
              currentProfileName: liveSession.snapshot().plan?.profileName,
              currentMode: liveSession.snapshot().plan?.mode,
              savedProfileNames: settings
                .snapshot()
                .liveSessionProfiles.map((profile) => profile.name),
              pendingVoicePreparation,
            },
            chatReviewTargets: chatIntelligence
              .snapshot()
              .slice(-20)
              .map((message) => ({
                messageId: message.messageId,
                userId: message.userId,
                userLogin: message.userLogin,
                userDisplayName: message.userDisplayName,
                broadcaster: message.roles.broadcaster,
                moderator: message.roles.moderator,
              })),
          }),
          ...(obs === undefined
            ? {}
            : {
                expectedObsSnapshotVersion: obs.snapshotVersion,
                expectedObsGeneration: obs.generation,
              }),
        };
      },
      requestConfirmation: (request) => voiceOrchestrator.requestConfirmation(request),
      onPhase: ({ phase, correlationId, model, tool }) =>
        voiceOrchestrator.setPhase({
          phase,
          reasonCode: phase === 'reasoning' ? 'MODEL_IN_FLIGHT' : 'TOOL_IN_FLIGHT',
          correlationId,
          ...(model === undefined ? {} : { model }),
          ...(tool === undefined ? {} : { tool }),
        }),
      onAudit: (event) => {
        void cloudBridge
          ?.recordCommandAudit({
            correlationId: randomUUID(),
            toolName: `${event.toolName}@${event.toolVersion}`,
            outcome:
              event.status === 'succeeded'
                ? 'allowed'
                : event.status === 'denied'
                  ? 'denied'
                  : 'failed',
            reasonCode: event.reasonCode,
            durationMs: event.durationMs,
            metadata: {
              voiceCorrelationId: event.correlationId,
              commandIdHash: createHash('sha256').update(event.commandId).digest('hex'),
              idempotencyKeyHash: createHash('sha256').update(event.idempotencyKey).digest('hex'),
              model: event.model,
              promptVersion: event.promptVersion,
              policyVersion: event.policyVersion,
            },
          })
          .catch(() => undefined);
      },
    });
    voiceOrchestrator.setTranscriptHandler(async (result, context) => {
      const accepted = handsFreeConversation.acceptTranscript(result.text, context.source);
      if (!accepted.accepted) {
        voiceOrchestrator.setPhase({
          phase: 'completed',
          reasonCode: 'WAKE_PHRASE_NOT_DETECTED',
          correlationId: context.correlationId,
        });
        return;
      }
      if (accepted.command === '') {
        voiceOrchestrator.setPhase({
          phase: 'completed',
          reasonCode: 'WAKE_PHRASE_ACCEPTED',
          correlationId: context.correlationId,
        });
        handsFreeConversation.speak(
          'I am listening. Tell me what you want to prepare for the stream.',
          'WAKE_ACKNOWLEDGED',
        );
        return;
      }
      const outcome = await reasoning.run(accepted.command, context.correlationId, context.signal);
      voiceOrchestrator.setPhase({
        phase: 'completed',
        reasonCode: 'COMMAND_LOOP_COMPLETE',
        correlationId: context.correlationId,
        model: outcome.model,
      });
      handsFreeConversation.speak(
        outcome.response || 'The requested production task is complete.',
        'COMMAND_RESPONSE',
      );
    });
  }

  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.handsFreeGetProjection,
      payloadSchema: EmptyPayloadSchema,
      resultSchema: HandsFreeProjectionSchema,
      isTrustedSender: trustedSender,
      handler: () => handsFreeConversation.snapshot(),
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.handsFreeSetPreferences,
      payloadSchema: HandsFreePreferencesSchema,
      resultSchema: HandsFreeProjectionSchema,
      isTrustedSender: trustedSender,
      handler: async ({ payload }) => {
        await activeAudioService.setHandsFreePreferences(payload);
        return handsFreeConversation.setPreferences(payload);
      },
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.handsFreeSpeechFinished,
      payloadSchema: HandsFreeSpeechFinishedPayloadSchema,
      resultSchema: HandsFreeProjectionSchema,
      isTrustedSender: trustedSender,
      handler: ({ payload }) => handsFreeConversation.speechFinished(payload.speechId),
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.pttCommand,
      payloadSchema: PttCommandPayloadSchema,
      resultSchema: OperationAcceptedSchema,
      isTrustedSender: trustedSender,
      handler: ({ payload }) => {
        if (payload.action === 'press') {
          voiceOrchestrator?.cancel('SUPERSEDED');
          activeAudioService.press();
        }
        if (payload.action === 'release') activeAudioService.release();
        if (payload.action === 'cancel') {
          activeAudioService.cancel();
          voiceOrchestrator?.cancel();
        }
        return { accepted: true as const };
      },
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.agentGetProjection,
      payloadSchema: AgentEmptyPayloadSchema,
      resultSchema: AgentInteractionProjectionSchema,
      isTrustedSender: trustedSender,
      handler: () =>
        // No Wispr Flow key means no voice agent yet: that is setup, not a failure.
        voiceOrchestrator?.snapshot() ?? {
          phase: 'idle' as const,
          reasonCode: 'VOICE_NOT_CONFIGURED',
          elapsedMs: 0,
        },
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.agentConfirmationDecision,
      payloadSchema: AgentConfirmationDecisionPayloadSchema,
      resultSchema: AgentInteractionProjectionSchema,
      isTrustedSender: trustedSender,
      handler: ({ payload }) => {
        if (voiceOrchestrator === undefined) {
          throw new PublicFault('PRECONDITION_FAILED', 'Groq is not configured');
        }
        return voiceOrchestrator.decideConfirmation(payload);
      },
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.liveSessionGetProjection,
      payloadSchema: LiveSessionEmptyPayloadSchema,
      resultSchema: LiveSessionProjectionSchema,
      isTrustedSender: trustedSender,
      handler: () => liveSession.snapshot(),
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.twitchCategorySearch,
      payloadSchema: TwitchCategorySearchPayloadSchema,
      resultSchema: TwitchCategorySearchResultSchema,
      isTrustedSender: trustedSender,
      handler: async ({ payload }) => {
        if (twitchBridge === undefined) {
          throw new PublicFault('PRECONDITION_FAILED', 'Twitch is not connected');
        }
        return { categories: await twitchBridge.searchCategories(payload.query) };
      },
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.liveSessionGetProfiles,
      payloadSchema: LiveSessionEmptyPayloadSchema,
      resultSchema: LiveSessionProfilesProjectionSchema,
      isTrustedSender: trustedSender,
      handler: () => {
        const current = settings.snapshot();
        return {
          profiles: current.liveSessionProfiles,
          ...(current.activeLiveSessionProfileId === undefined
            ? {}
            : { activeProfileId: current.activeLiveSessionProfileId }),
        };
      },
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.liveSessionPrepare,
      payloadSchema: PrepareLiveSessionPayloadSchema,
      resultSchema: LiveSessionProjectionSchema,
      isTrustedSender: trustedSender,
      handler: async ({ payload }) => {
        await obsProcessSupervisor.ensureReady(payload.profile.verification.obsReadyTimeoutMs);
        const current = settings.snapshot();
        const profiles = current.liveSessionProfiles.filter(
          (profile) => profile.profileId !== payload.profile.profileId,
        );
        profiles.push(payload.profile);
        await settings.update({
          liveSessionProfiles: profiles.slice(-20),
          activeLiveSessionProfileId: payload.profile.profileId,
        });
        return liveSession.prepare(payload.profile, payload.mode);
      },
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.liveSessionDecision,
      payloadSchema: LiveSessionDecisionPayloadSchema,
      resultSchema: LiveSessionProjectionSchema,
      isTrustedSender: trustedSender,
      handler: ({ payload }) => liveSession.decide(payload.planId, payload.decision),
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.liveSessionStop,
      payloadSchema: LiveSessionEmptyPayloadSchema,
      resultSchema: LiveSessionProjectionSchema,
      isTrustedSender: trustedSender,
      handler: () => liveSession.stop(false),
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.liveSessionEmergencyStop,
      payloadSchema: LiveSessionEmptyPayloadSchema,
      resultSchema: LiveSessionProjectionSchema,
      isTrustedSender: trustedSender,
      handler: () => liveSession.stop(true),
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.moderationExecute,
      payloadSchema: ModerationCommandPayloadSchema,
      resultSchema: TwitchOperationAcceptedSchema,
      isTrustedSender: trustedSender,
      handler: async ({ payload }) => {
        if (twitchBridge === undefined || twitchBridge.snapshot().account === undefined) {
          throw new PublicFault('PRECONDITION_FAILED', 'Twitch is not connected');
        }
        if (moderationGuard.isComplete(payload.intent.intentId)) return { accepted: true as const };
        const evidence =
          payload.intent.evidenceMessageId === undefined
            ? undefined
            : chatIntelligence.get(payload.intent.evidenceMessageId);
        moderationGuard.authorize(
          payload.intent,
          evidence,
          twitchBridge.snapshot().account?.providerUserId ?? '',
          payload.confirmed,
        );
        await twitchBridge.executeModeration(payload.intent);
        moderationGuard.complete(payload.intent.intentId);
        return { accepted: true as const };
      },
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.pilotOverlayGetPreferences,
      payloadSchema: LiveSessionEmptyPayloadSchema,
      resultSchema: PilotOverlayPreferencesSchema,
      isTrustedSender: trustedSender,
      handler: () => settings.snapshot().pilotOverlay,
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.pilotOverlaySetPreferences,
      payloadSchema: PilotOverlayPreferencesSchema,
      resultSchema: PilotOverlayPreferencesSchema,
      isTrustedSender: trustedSender,
      handler: async ({ payload }) => {
        await settings.update({ pilotOverlay: payload });
        pilotOverlay.apply(payload);
        return payload;
      },
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.pilotOverlayDrag,
      payloadSchema: PilotOverlayDragPayloadSchema,
      resultSchema: PilotOverlayAcceptedSchema,
      isTrustedSender: trustedSender,
      handler: async ({ payload }) => {
        if (payload.phase === 'start') pilotOverlay.beginDrag();
        else await pilotOverlay.endDrag();
        return { accepted: true as const };
      },
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.pilotOverlaySetInteractive,
      payloadSchema: PilotOverlayInteractivePayloadSchema,
      resultSchema: PilotOverlayAcceptedSchema,
      isTrustedSender: trustedSender,
      handler: ({ payload }) => {
        pilotOverlay.setInteractive(payload.interactive);
        return { accepted: true as const };
      },
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.shortcutsGet,
      payloadSchema: EmptyPayloadSchema,
      resultSchema: ShortcutBindingsSchema,
      isTrustedSender: trustedSender,
      handler: () => settings.snapshot().shortcuts,
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.shortcutsSet,
      payloadSchema: ShortcutBindingsSchema,
      resultSchema: ShortcutBindingsSchema,
      isTrustedSender: trustedSender,
      handler: async ({ payload }) => {
        try {
          shortcutService.setBindings(payload);
        } catch {
          throw new PublicFault('PRECONDITION_FAILED', 'One of the shortcuts cannot be used');
        }
        await settings.update({ shortcuts: payload });
        return payload;
      },
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.audioListDevices,
      payloadSchema: EmptyPayloadSchema,
      resultSchema: AudioDeviceListSchema,
      isTrustedSender: trustedSender,
      handler: () => activeAudioService.listDevices(),
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.audioSelectDevice,
      payloadSchema: SelectAudioDevicePayloadSchema,
      resultSchema: OperationAcceptedSchema,
      isTrustedSender: trustedSender,
      handler: async ({ payload }) => {
        await activeAudioService.selectDevice(payload.deviceId);
        return { accepted: true as const };
      },
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.obsGetSnapshot,
      payloadSchema: GetObsSnapshotPayloadSchema,
      resultSchema: ObsProjectionSchema,
      isTrustedSender: trustedSender,
      handler: () => {
        const snapshot = obsBridge.snapshot();
        return snapshot === undefined
          ? { available: false, reasonCode: 'NOT_SYNCHRONIZED' }
          : { available: true, snapshot, reasonCode: 'READY' };
      },
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.obsReconnect,
      payloadSchema: ReconnectObsPayloadSchema,
      resultSchema: OperationAcceptedSchema,
      isTrustedSender: trustedSender,
      handler: async () => {
        logs.info('obs', 'Reconnect requested');
        await obsBridge.reconnect();
        return { accepted: true as const };
      },
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.obsConnect,
      payloadSchema: ReconnectObsPayloadSchema,
      resultSchema: ObsConnectResultSchema,
      isTrustedSender: trustedSender,
      handler: () => connectObs(),
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.agentStart,
      payloadSchema: AgentEmptyPayloadSchema,
      resultSchema: AgentStartResultSchema,
      isTrustedSender: trustedSender,
      handler: () => startPilot(),
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.agentStop,
      payloadSchema: AgentEmptyPayloadSchema,
      resultSchema: AgentStartResultSchema,
      isTrustedSender: trustedSender,
      handler: async () => {
        const preferences = { ...settings.snapshot().handsFree, enabled: false };
        await activeAudioService.setHandsFreePreferences(preferences);
        handsFreeConversation.setPreferences(preferences);
        logs.info('agent', 'Pilot voice turned off');
        return { running: false, steps: [{ label: 'Turn off voice', status: 'done' as const }] };
      },
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.logsGet,
      payloadSchema: LogsEmptyPayloadSchema,
      resultSchema: LogsProjectionSchema,
      isTrustedSender: trustedSender,
      handler: () => ({ entries: logs.snapshot() }),
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.logsClear,
      payloadSchema: LogsEmptyPayloadSchema,
      resultSchema: OperationAcceptedSchema,
      isTrustedSender: trustedSender,
      handler: () => {
        logs.clear();
        return { accepted: true as const };
      },
    }),
  );

  /** One click to get going: show Pilot, connect OBS, and turn on hands-free voice. */
  async function startPilot(): Promise<AgentStartResult> {
    const steps: ObsConnectStep[] = [];
    const step = (label: string, status: ObsConnectStep['status'], detail?: string) => {
      steps.push({ label, status, ...(detail === undefined ? {} : { detail }) });
      logs.write(status === 'failed' ? 'warn' : 'info', 'agent', `${label}: ${status}`, detail);
    };
    logs.info('agent', 'Start Pilot requested');

    const overlay = { ...settings.snapshot().pilotOverlay, visible: true };
    await settings.update({ pilotOverlay: overlay });
    pilotOverlay.apply(overlay);
    step('Show Pilot', 'done');

    const obs = await connectObs();
    const obsFailure = obs.steps.find((item) => item.status === 'failed');
    step('Connect OBS', obs.connected ? 'done' : 'failed', obs.connected ? undefined : obsFailure?.detail);

    if (voiceOrchestrator === undefined) {
      step('Turn on voice', 'failed', 'Add your Wispr Flow API key to .env, then restart ObscurPilot.');
    } else {
      const preferences = { ...settings.snapshot().handsFree, enabled: true };
      await activeAudioService.setHandsFreePreferences(preferences);
      handsFreeConversation.setPreferences(preferences);
      step('Turn on voice', 'done', `Say "${preferences.wakePhrase}", or hold the push-to-talk key`);
    }

    if (groqClient === undefined) {
      step('Command brain', 'failed', 'Add your Groq API key to .env so Pilot can act on commands.');
    } else {
      step('Command brain', 'done', 'Groq reasoning ready');
    }
    return { running: steps.every((item) => item.status !== 'failed'), steps };
  }

  /** One click: find OBS, switch its WebSocket server on, launch it, and connect. */
  async function connectObs(): Promise<ObsConnectResult> {
    const steps: ObsConnectStep[] = [];
    const step = (label: string, status: ObsConnectStep['status'], detail?: string) => {
      steps.push({ label, status, ...(detail === undefined ? {} : { detail }) });
      logs.write(status === 'failed' ? 'warn' : 'info', 'obs', `${label}: ${status}`, detail);
    };
    const finish = (): ObsConnectResult => ({
      connected: obsBridge.snapshot() !== undefined,
      steps,
    });
    logs.info('obs', 'Connect OBS requested');
    if (obsBridge.snapshot() !== undefined) {
      step('Connect to OBS', 'done', 'Already connected');
      return finish();
    }
    if (obsExecutable === undefined) {
      step('Find OBS Studio', 'failed', 'Install OBS Studio from obsproject.com, then try again.');
      return finish();
    }
    step('Find OBS Studio', 'done', obsExecutable);
    const running = await isObsRunning();
    const websocket = readObsWebSocketSettings(obsSettingsPath);
    if (websocket?.enabled === true) {
      step('Turn on OBS WebSocket server', 'skipped', `Already on, port ${websocket.port}`);
    } else if (running) {
      step(
        'Turn on OBS WebSocket server',
        'failed',
        'In OBS open Tools > WebSocket Server Settings, tick Enable WebSocket server, then press Connect again.',
      );
      return finish();
    } else {
      const enabled = await enableObsWebSocket(obsSettingsPath);
      step('Turn on OBS WebSocket server', 'done', `Port ${enabled.port}`);
    }
    try {
      if (running) {
        step('Start OBS Studio', 'skipped', 'Already running');
        await obsBridge.reconnect();
      } else {
        step('Start OBS Studio', 'done', 'Launching');
      }
      await obsProcessSupervisor.ensureReady(25_000);
      step('Connect to OBS', 'done');
    } catch {
      step('Connect to OBS', 'failed', lastObsFailure ?? 'OBS did not answer in time');
    }
    return finish();
  }
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.cloudGetAuth,
      payloadSchema: CloudGetAuthPayloadSchema,
      resultSchema: CloudAuthProjectionSchema,
      isTrustedSender: trustedSender,
      handler: () =>
        cloudBridge?.snapshot() ?? {
          configured: false as const,
          phase: 'not_configured' as const,
          reasonCode: 'NOT_CONFIGURED',
        },
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.cloudSignIn,
      payloadSchema: CloudCredentialPayloadSchema,
      resultSchema: CloudAuthProjectionSchema,
      isTrustedSender: trustedSender,
      handler: async ({ payload }) => {
        if (cloudBridge === undefined) {
          return {
            configured: false as const,
            phase: 'not_configured' as const,
            reasonCode: 'NOT_CONFIGURED',
          };
        }
        const projection = await cloudBridge.signIn(payload);
        if (projection.phase === 'authenticated') await twitchBridge?.start();
        return projection;
      },
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.cloudSignUp,
      payloadSchema: CloudCredentialPayloadSchema,
      resultSchema: CloudAuthProjectionSchema,
      isTrustedSender: trustedSender,
      handler: async ({ payload }) => {
        if (cloudBridge === undefined) {
          return {
            configured: false as const,
            phase: 'not_configured' as const,
            reasonCode: 'NOT_CONFIGURED',
          };
        }
        const projection = await cloudBridge.signUp(payload);
        if (projection.phase === 'authenticated') await twitchBridge?.start();
        return projection;
      },
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.cloudResendConfirmation,
      payloadSchema: CloudConfirmationPayloadSchema,
      resultSchema: OperationAcceptedSchema,
      isTrustedSender: trustedSender,
      handler: async ({ payload }) => {
        if (cloudBridge === undefined) {
          throw new PublicFault('PRECONDITION_FAILED', 'Cloud authorization is not configured');
        }
        await cloudBridge.resendConfirmation(payload);
        return { accepted: true as const };
      },
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.cloudSignOut,
      payloadSchema: CloudSignOutPayloadSchema,
      resultSchema: CloudAuthProjectionSchema,
      isTrustedSender: trustedSender,
      handler: async () => {
        if (cloudBridge === undefined) {
          return {
            configured: false as const,
            phase: 'not_configured' as const,
            reasonCode: 'NOT_CONFIGURED',
          };
        }
        await twitchBridge?.suspend();
        return cloudBridge.signOut();
      },
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.cloudRequestDeletion,
      payloadSchema: CloudGetAuthPayloadSchema,
      resultSchema: OperationAcceptedSchema,
      isTrustedSender: trustedSender,
      handler: () => {
        if (cloudBridge === undefined) {
          throw new PublicFault('PRECONDITION_FAILED', 'Cloud persistence is not configured');
        }
        return cloudBridge.requestAccountDeletion();
      },
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.twitchGetProjection,
      payloadSchema: TwitchEmptyPayloadSchema,
      resultSchema: TwitchProjectionSchema,
      isTrustedSender: trustedSender,
      handler: () =>
        twitchBridge?.snapshot() ?? {
          configured: false as const,
          phase: 'not_configured' as const,
          reasonCode: 'NOT_CONFIGURED',
        },
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.twitchConnect,
      payloadSchema: TwitchEmptyPayloadSchema,
      resultSchema: TwitchOperationAcceptedSchema,
      isTrustedSender: trustedSender,
      handler: () => {
        if (twitchBridge === undefined) {
          throw new PublicFault(
            'PRECONDITION_FAILED',
            'Twitch and cloud authorization must be configured',
          );
        }
        return twitchBridge.connect();
      },
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.twitchDisconnect,
      payloadSchema: TwitchEmptyPayloadSchema,
      resultSchema: TwitchProjectionSchema,
      isTrustedSender: trustedSender,
      handler: () =>
        twitchBridge?.disconnect() ?? {
          configured: false as const,
          phase: 'not_configured' as const,
          reasonCode: 'NOT_CONFIGURED',
        },
    }),
  );
  lifecycle.add(
    registerSecureHandler({
      ipcMain,
      channel: IPC_CHANNELS.twitchReconnect,
      payloadSchema: TwitchEmptyPayloadSchema,
      resultSchema: TwitchOperationAcceptedSchema,
      isTrustedSender: trustedSender,
      handler: async () => {
        if (twitchBridge === undefined)
          throw new PublicFault('PRECONDITION_FAILED', 'Twitch is not configured');
        await twitchBridge.reconnect();
        return { accepted: true as const };
      },
    }),
  );
  const handleProtocolCallback = async (value: string): Promise<boolean> => {
    if (cloudBridge !== undefined && (await cloudBridge.handleAuthCallback(value))) {
      if (cloudBridge.snapshot().phase === 'authenticated') await twitchBridge?.start();
      return true;
    }
    return twitchBridge === undefined ? false : twitchBridge.handleCallback(value);
  };
  const consumeProtocolCallback = (value: string): void => {
    void handleProtocolCallback(value).catch((error: unknown) => {
      console.error(
        'ObscurPilot protocol callback failed:',
        error instanceof Error ? error.message : 'Unknown callback error',
      );
      stateService.setConnection({
        provider: 'twitch',
        phase: 'degraded',
        attempt: 0,
        changedAt: new Date().toISOString(),
        reasonCode: 'OAUTH_CALLBACK_FAILED',
        correlationId: randomUUID(),
      });
    });
  };

  obsBridge.start();
  if (cloudBridge !== undefined) {
    void cloudBridge
      .start()
      .then(async () => {
        const initialCallback = process.argv.find((argument) =>
          argument.startsWith('obscurpilot://'),
        );
        if (initialCallback !== undefined && (await handleProtocolCallback(initialCallback)))
          return;
        if (twitchBridge === undefined) return;
        await twitchBridge.start();
      })
      .catch(() => {
        stateService.setConnection({
          provider: 'supabase',
          phase: 'degraded',
          attempt: 0,
          changedAt: new Date().toISOString(),
          reasonCode: 'START_FAILED',
          correlationId: randomUUID(),
        });
      });
  }
  await loadMainWindow(mainWindow, isDevelopment, developmentServerUrl);
  stateService.setLifecycle('ready');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && !shutdownStarted) {
      void createMainWindow(isDevelopment, developmentServerUrl).then(bindMainWindowLifetime);
    }
  });

  const onOpenUrl = (event: Electron.Event, url: string) => {
    event.preventDefault();
    consumeProtocolCallback(url);
  };
  app.on('open-url', onOpenUrl);
  lifecycle.add(() => {
    app.off('open-url', onOpenUrl);
  });
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient('obscurpilot');
  } else if (process.platform === 'win32') {
    app.setAsDefaultProtocolClient('obscurpilot', process.execPath, [app.getAppPath()]);
  }

  app.on('second-instance', (_event, commandLine) => {
    const callback = commandLine.find((argument) => argument.startsWith('obscurpilot://'));
    if (callback !== undefined) consumeProtocolCallback(callback);
    if (mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  });

  if (process.argv.includes('--smoke-exit')) {
    mainWindow.destroy();
    app.quit();
  }
}

async function shutdown(): Promise<void> {
  stateService.setLifecycle('stopping');
  try {
    await lifecycle.dispose();
  } catch (error: unknown) {
    console.error(
      'ObscurPilot shutdown cleanup failed:',
      error instanceof Error ? error.message : 'Unknown cleanup error',
    );
  } finally {
    app.quit();
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app
    .whenReady()
    .then(startApplication)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown startup error';
      console.error('ObscurPilot startup failed:', message);
      dialog.showErrorBox(
        'ObscurPilot could not start',
        `${message}\n\nCheck the development terminal for details.`,
      );
      void lifecycle.dispose().finally(() => app.quit());
    });
}

app.on('before-quit', (event) => {
  if (!shutdownStarted) {
    event.preventDefault();
    shutdownStarted = true;
    void shutdown();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

const CONNECTION_NAMES: Readonly<Record<ConnectionProjection['provider'], string>> = {
  obs: 'OBS',
  twitch: 'Twitch',
  wispr: 'Wispr Flow',
  groq: 'Groq',
  supabase: 'Cloud sync',
};

function logConnection(logs: LogService, connection: ConnectionProjection): void {
  // Only real faults are errors. Being signed out or missing a key is a setup step.
  const setupStep =
    connection.reasonCode === 'SIGNED_OUT' ||
    connection.reasonCode === 'CLOUD_AUTH_REQUIRED' ||
    connection.reasonCode === 'NOT_CONFIGURED';
  const level = setupStep
    ? 'warn'
    : connection.phase === 'degraded' || connection.phase === 'auth_required'
      ? 'error'
      : connection.phase === 'backoff' || connection.phase === 'reconnecting'
        ? 'warn'
        : 'info';
  const name = CONNECTION_NAMES[connection.provider];
  logs.transition(
    connection.provider,
    `${name} ${connection.phase.replaceAll('_', ' ')}`,
    connection.reasonCode,
    level,
  );
}

function obsFailureHint(reasonCode: string): string {
  if (reasonCode === 'AUTH_REQUIRED') return 'OBS rejected the WebSocket password';
  if (reasonCode === 'VERSION_MISMATCH') return 'OBS 30 or newer with WebSocket 5 is required';
  return 'OBS is not reachable; is it running with the WebSocket server on?';
}
