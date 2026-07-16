import { createHash, randomUUID } from 'node:crypto';
import {
  BootstrapProjectionSchema,
  GetBootstrapPayloadSchema,
  type BootstrapProjection,
} from '@obscurpilot/contracts/bootstrap';
import {
  AudioDeviceListSchema,
  EmptyPayloadSchema,
  OperationAcceptedSchema,
  PttCommandPayloadSchema,
  SelectAudioDevicePayloadSchema,
  SetPttAcceleratorPayloadSchema,
} from '@obscurpilot/contracts/audio';
import { IPC_CHANNELS } from '@obscurpilot/contracts/ipc';
import {
  GetObsSnapshotPayloadSchema,
  ObsProjectionSchema,
  ReconnectObsPayloadSchema,
} from '@obscurpilot/contracts/obs';
import { createObsProductionTools, ObsBridge } from '@obscurpilot/adapters-obs/boundary';
import {
  AppSnapshotSchema,
  GetSnapshotPayloadSchema,
  StateChangedEventSchema,
} from '@obscurpilot/contracts/state';
import {
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
  session,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import { resolve } from 'node:path';
import { PttAudioService } from './audio-service.js';
import { registerApplicationProtocol } from './application-protocol.js';
import {
  getDevelopmentServerUrl,
  loadDevelopmentEnvironment,
  parseEnvironment,
} from './environment.js';
import { PublicFault, registerSecureHandler } from './ipc-router.js';
import { LifecycleScope } from './lifecycle.js';
import {
  installPermissionDenial,
  installSecurityHeaders,
  isTrustedRendererUrl,
} from './security.js';
import { MainStateService } from './state-service.js';
import { SecureSettingsStore } from './secure-settings.js';
import { createAudioCaptureWindow, createMainWindow } from './window-manager.js';
import {
  CloudAuthProjectionSchema,
  CloudConfirmationPayloadSchema,
  CloudCredentialPayloadSchema,
  CloudGetAuthPayloadSchema,
  CloudSignOutPayloadSchema,
} from '@obscurpilot/contracts/cloud';
import { CloudBridge } from './cloud-bridge.js';
import {
  TwitchActivityEventSchema,
  TwitchEmptyPayloadSchema,
  TwitchOperationAcceptedSchema,
  TwitchProjectionSchema,
} from '@obscurpilot/contracts/twitch';
import { TwitchBridge } from './twitch-bridge.js';
import { requireSecureEncryptionProvider } from './encrypted-json-store.js';
import {
  AgentConfirmationDecisionPayloadSchema,
  AgentEmptyPayloadSchema,
  AgentInteractionChangedEventSchema,
  AgentInteractionProjectionSchema,
} from '@obscurpilot/contracts/agent';
import {
  createGroqClient,
  createSdkReasoningTransport,
  createSdkTranscriptionTransport,
  GroqReasoningAdapter,
  GroqTranscriptionAdapter,
  GuardedReasoningOrchestrator,
} from '@obscurpilot/adapters-groq/boundary';
import { VoiceOrchestrator } from './voice-orchestrator.js';
import { ToolRegistry } from '@obscurpilot/domain/tool-registry';
import { authorizeTool } from '@obscurpilot/domain/policy';

const lifecycle = new LifecycleScope();
const stateService = new MainStateService();
let shutdownStarted = false;

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
  const isDevelopment = !app.isPackaged && process.env.OBSCURPILOT_E2E !== '1';
  const developmentServerUrl = getDevelopmentServerUrl(environment);
  const trustedSender = (event: IpcMainInvokeEvent) =>
    isTrustedRendererUrl(event.senderFrame?.url, isDevelopment, developmentServerUrl.origin);

  lifecycle.add(
    installSecurityHeaders(session.defaultSession, isDevelopment, developmentServerUrl.origin),
  );
  lifecycle.add(installPermissionDenial(session.defaultSession));

  if (!isDevelopment) registerApplicationProtocol();

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
  const groqClient =
    environment.GROQ_API_KEY === undefined
      ? undefined
      : createGroqClient({ apiKey: environment.GROQ_API_KEY });
  const voiceOrchestrator =
    groqClient === undefined
      ? undefined
      : new VoiceOrchestrator({
          transcription: new GroqTranscriptionAdapter({
            model: environment.GROQ_STT_MODEL,
            transport: createSdkTranscriptionTransport(groqClient),
          }),
          onProjection: (projection) => {
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
  if (voiceOrchestrator === undefined) {
    stateService.setConnection({
      provider: 'groq',
      phase: 'idle',
      attempt: 0,
      changedAt: new Date().toISOString(),
      reasonCode: 'NOT_CONFIGURED',
      correlationId: randomUUID(),
    });
  } else {
    stateService.setConnection({
      provider: 'groq',
      phase: 'idle',
      attempt: 0,
      changedAt: new Date().toISOString(),
      reasonCode: 'CONFIGURED',
      correlationId: randomUUID(),
    });
    lifecycle.add(() => voiceOrchestrator.dispose());
  }
  const audioService = new PttAudioService(
    ipcMain,
    captureWindow,
    settings,
    (envelope) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed() && window.id !== captureWindow.id) {
          window.webContents.send(IPC_CHANNELS.pttChanged, envelope);
        }
      }
    },
    (clip) => voiceOrchestrator?.processClip(clip),
  );
  await audioService.start();
  lifecycle.add(() => audioService.dispose());

  const obsBridge = new ObsBridge({
    url: environment.OBS_WEBSOCKET_URL,
    ...(environment.OBS_WEBSOCKET_PASSWORD === undefined
      ? {}
      : { password: environment.OBS_WEBSOCKET_PASSWORD }),
    onConnection: (projection) => stateService.setConnection(projection),
  });
  lifecycle.add(() => obsBridge.dispose());

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

  const twitchBridge =
    cloudBridge !== undefined && environment.TWITCH_CLIENT_ID !== undefined
      ? new TwitchBridge({
          clientId: environment.TWITCH_CLIENT_ID,
          cloud: cloudBridge,
          userDataPath: app.getPath('userData'),
          encryption: requireSecureEncryptionProvider(safeStorage, getSupportedPlatform()),
          openExternal: (url) => shell.openExternal(url, { activate: true }),
          onConnection: (projection) => stateService.setConnection(projection),
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

  if (voiceOrchestrator !== undefined && groqClient !== undefined) {
    const registry = new ToolRegistry();
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
      const outcome = await reasoning.run(result.text, context.correlationId, context.signal);
      voiceOrchestrator.setPhase({
        phase: 'completed',
        reasonCode: 'COMMAND_LOOP_COMPLETE',
        correlationId: context.correlationId,
        model: outcome.model,
      });
    });
  }

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
          audioService.press();
        }
        if (payload.action === 'release') audioService.release();
        if (payload.action === 'cancel') {
          audioService.cancel();
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
        voiceOrchestrator?.snapshot() ?? {
          phase: 'error' as const,
          reasonCode: 'NOT_CONFIGURED',
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
      channel: IPC_CHANNELS.pttSetAccelerator,
      payloadSchema: SetPttAcceleratorPayloadSchema,
      resultSchema: OperationAcceptedSchema,
      isTrustedSender: trustedSender,
      handler: async ({ payload }) => {
        await audioService.setAccelerator(payload.accelerator);
        return { accepted: true as const };
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
      handler: () => audioService.listDevices(),
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
        await audioService.selectDevice(payload.deviceId);
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
        await obsBridge.reconnect();
        return { accepted: true as const };
      },
    }),
  );
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
  const mainWindow = await createMainWindow(isDevelopment, developmentServerUrl);
  stateService.setLifecycle('ready');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && !shutdownStarted) {
      void createMainWindow(isDevelopment, developmentServerUrl);
    }
  });

  const onOpenUrl = (event: Electron.Event, url: string) => {
    event.preventDefault();
    void handleProtocolCallback(url);
  };
  app.on('open-url', onOpenUrl);
  lifecycle.add(() => {
    app.off('open-url', onOpenUrl);
  });
  if (app.isPackaged) app.setAsDefaultProtocolClient('obscurpilot');

  app.on('second-instance', (_event, commandLine) => {
    const callback = commandLine.find((argument) => argument.startsWith('obscurpilot://'));
    if (callback !== undefined) void handleProtocolCallback(callback);
    if (mainWindow.isMinimized()) mainWindow.restore();
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
      console.error(
        'ObscurPilot startup failed:',
        error instanceof Error ? error.message : 'Unknown startup error',
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
