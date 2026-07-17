import { resolve } from 'node:path';
import { BrowserWindow, screen, session } from 'electron';
import type { PilotOverlayPreferences } from '@obscurpilot/contracts/live-session';
import { registerApplicationProtocol } from './application-protocol.js';

export function createMainWindowShell(isDevelopment: boolean): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    show: true,
    title: 'ObscurPilot — Starting secure runtime…',
    backgroundColor: '#09090b',
    webPreferences: {
      contextIsolation: true,
      devTools: isDevelopment,
      nodeIntegration: false,
      preload: resolve(__dirname, 'preload.cjs'),
      sandbox: true,
      webSecurity: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  window.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  if (!isDevelopment) {
    window.webContents.on('devtools-opened', () => {
      window.webContents.closeDevTools();
    });
  }
  window.webContents.on('did-fail-load', (_event, code, description, validatedUrl) => {
    window.setTitle('ObscurPilot — Interface unavailable');
    console.error('ObscurPilot renderer load failed:', code, description, validatedUrl);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    window.setTitle('ObscurPilot — Renderer stopped');
    console.error('ObscurPilot renderer stopped:', details.reason);
  });
  window.setProgressBar(2, { mode: 'indeterminate' });
  return window;
}

export async function loadMainWindow(
  window: BrowserWindow,
  isDevelopment: boolean,
  developmentServerUrl: URL,
): Promise<void> {
  if (window.isDestroyed()) throw new Error('Main window was closed during startup');

  if (isDevelopment) {
    await window.loadURL(developmentServerUrl.href);
  } else {
    await window.loadURL('app://bundle/index.html');
  }

  window.setProgressBar(-1);
  window.setTitle('ObscurPilot');
  if (!window.isVisible()) window.show();
  window.focus();
}

export async function createMainWindow(
  isDevelopment: boolean,
  developmentServerUrl: URL,
): Promise<BrowserWindow> {
  const window = createMainWindowShell(isDevelopment);
  await loadMainWindow(window, isDevelopment, developmentServerUrl);
  return window;
}

export async function createAudioCaptureWindow(
  isDevelopment: boolean,
  developmentServerUrl: URL,
): Promise<BrowserWindow> {
  const audioSession = session.fromPartition('obscurpilot-audio', { cache: false });
  const captureWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: resolve(__dirname, 'audio-preload.cjs'),
      sandbox: true,
      webSecurity: true,
      partition: 'obscurpilot-audio',
    },
  });
  audioSession.setPermissionCheckHandler(
    (webContents, permission) =>
      permission === 'media' && webContents?.id === captureWindow?.webContents.id,
  );
  audioSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media' && webContents.id === captureWindow.webContents.id);
  });
  audioSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          isDevelopment
            ? "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self' " +
              developmentServerUrl.origin +
              " ws://127.0.0.1:5173; object-src 'none'"
            : "default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'",
        ],
        'Permissions-Policy': ['camera=(), microphone=(self), geolocation=()'],
      },
    });
  });
  captureWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  captureWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  if (isDevelopment) {
    await captureWindow.loadURL(new URL('/audio-capture.html', developmentServerUrl).href);
  } else {
    registerApplicationProtocol(audioSession.protocol);
    await captureWindow.loadURL('app://bundle/audio-capture.html');
  }
  return captureWindow;
}

export async function createPilotOverlayWindow(
  isDevelopment: boolean,
  developmentServerUrl: URL,
  preferences: PilotOverlayPreferences,
): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: Math.round(288 * preferences.scale),
    height: Math.round(172 * preferences.scale),
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      devTools: isDevelopment,
      nodeIntegration: false,
      preload: resolve(__dirname, 'preload.cjs'),
      sandbox: true,
      webSecurity: true,
    },
  });
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setContentProtection(true);
  window.setIgnoreMouseEvents(preferences.clickThrough, { forward: true });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  if (!isDevelopment) {
    window.webContents.on('devtools-opened', () => window.webContents.closeDevTools());
  }
  if (isDevelopment) {
    await window.loadURL(new URL('/overlay.html', developmentServerUrl).href);
  } else {
    await window.loadURL('app://bundle/overlay.html');
  }
  applyPilotOverlayPreferences(window, preferences);
  return window;
}

export function applyPilotOverlayPreferences(
  window: BrowserWindow,
  preferences: PilotOverlayPreferences,
): void {
  if (window.isDestroyed()) return;
  const width = Math.round(288 * preferences.scale);
  const height = Math.round(172 * preferences.scale);
  const { x, y, width: workWidth, height: workHeight } = screen.getPrimaryDisplay().workArea;
  const margin = 18;
  const left = preferences.corner.endsWith('left') ? x + margin : x + workWidth - width - margin;
  const top = preferences.corner.startsWith('top') ? y + margin : y + workHeight - height - margin;
  window.setBounds({ x: left, y: top, width, height }, false);
  window.setIgnoreMouseEvents(preferences.clickThrough, { forward: true });
  if (preferences.visible) window.showInactive();
  else window.hide();
}
