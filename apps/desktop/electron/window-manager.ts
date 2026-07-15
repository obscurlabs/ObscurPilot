import { resolve } from 'node:path';
import { BrowserWindow, session } from 'electron';
import { registerApplicationProtocol } from './application-protocol.js';

export async function createMainWindow(
  isDevelopment: boolean,
  developmentServerUrl: URL,
): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title: 'ObscurPilot',
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
  window.once('ready-to-show', () => {
    window.show();
  });

  if (isDevelopment) {
    await window.loadURL(developmentServerUrl.href);
  } else {
    await window.loadURL('app://bundle/index.html');
  }

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
            ? "default-src 'self'; script-src 'self'; connect-src 'self' " +
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
