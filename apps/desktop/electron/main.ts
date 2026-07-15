import { randomUUID } from 'node:crypto';
import {
  BootstrapProjectionSchema,
  GetBootstrapPayloadSchema,
  type BootstrapProjection,
} from '@obscurpilot/contracts/bootstrap';
import { IPC_CHANNELS } from '@obscurpilot/contracts/ipc';
import {
  AppSnapshotSchema,
  GetSnapshotPayloadSchema,
  StateChangedEventSchema,
} from '@obscurpilot/contracts/state';
import { app, BrowserWindow, ipcMain, session, type IpcMainInvokeEvent } from 'electron';
import { registerApplicationProtocol } from './application-protocol.js';
import {
  getDevelopmentServerUrl,
  loadDevelopmentEnvironment,
  parseEnvironment,
} from './environment.js';
import { registerSecureHandler } from './ipc-router.js';
import { LifecycleScope } from './lifecycle.js';
import {
  installPermissionDenial,
  installSecurityHeaders,
  isTrustedRendererUrl,
} from './security.js';
import { MainStateService } from './state-service.js';
import { createMainWindow } from './window-manager.js';

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

  const mainWindow = await createMainWindow(isDevelopment, developmentServerUrl);
  stateService.setLifecycle('ready');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && !shutdownStarted) {
      void createMainWindow(isDevelopment, developmentServerUrl);
    }
  });

  app.on('second-instance', () => {
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
