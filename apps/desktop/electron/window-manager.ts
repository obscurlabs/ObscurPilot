import { resolve } from 'node:path';
import { BrowserWindow } from 'electron';

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
