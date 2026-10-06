import { resolve } from 'node:path';
import { BrowserWindow, screen, type Rectangle } from 'electron';
import type {
  PilotOverlayAnchor,
  PilotOverlayCorner,
  PilotOverlayPreferences,
} from '@obscurpilot/contracts/live-session';

// Sized to the Pilot character alone so no transparent margin blocks clicks behind it.
const OVERLAY_WIDTH = 140;
const OVERLAY_HEIGHT = 160;
const EDGE_MARGIN = 12;
const CORNER_MAGNET = 0.06;
const FRAME_MS = 16;
const SNAP_MS = 260;

export async function createPilotOverlayWindow(
  isDevelopment: boolean,
  developmentServerUrl: URL,
): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
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
  window.setIgnoreMouseEvents(true, { forward: true });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  if (isDevelopment) {
    await window.loadURL(new URL('/overlay.html', developmentServerUrl).href);
  } else {
    window.webContents.on('devtools-opened', () => window.webContents.closeDevTools());
    await window.loadURL('app://bundle/overlay.html');
  }
  return window;
}

/**
 * Owns where the Pilot sits. The window ignores the mouse except while the renderer reports
 * the pointer over the character, so the transparent margin never blocks clicks. Dragging
 * follows the OS cursor from here (not renderer events), and on release the Pilot snaps to
 * the nearest screen edge, magnetising into corners; it never rests mid-screen.
 */
export class PilotOverlayController {
  private interactive = false;
  private dragTimer: NodeJS.Timeout | undefined;
  private snapTimer: NodeJS.Timeout | undefined;

  public constructor(
    private readonly window: BrowserWindow,
    private preferences: PilotOverlayPreferences,
    private readonly persist: (preferences: PilotOverlayPreferences) => Promise<void>,
  ) {
    this.apply(preferences);
  }

  public apply(preferences: PilotOverlayPreferences): void {
    this.preferences = preferences;
    if (this.window.isDestroyed()) return;
    this.stopTimers();
    const anchor = preferences.anchor ?? anchorForCorner(preferences.corner);
    this.window.setBounds(boundsForAnchor(anchor, this.size(), this.workArea()), false);
    this.refreshMouse();
    if (preferences.visible) this.window.showInactive();
    else this.window.hide();
  }

  public setInteractive(interactive: boolean): void {
    this.interactive = interactive;
    this.refreshMouse();
  }

  public beginDrag(): void {
    if (this.preferences.locked || this.window.isDestroyed()) return;
    this.stopTimers();
    const start = screen.getCursorScreenPoint();
    const bounds = this.window.getBounds();
    const grab = { x: start.x - bounds.x, y: start.y - bounds.y };
    const size = this.size();
    this.dragTimer = setInterval(() => {
      if (this.window.isDestroyed()) return this.stopTimers();
      const cursor = screen.getCursorScreenPoint();
      this.window.setBounds({ x: cursor.x - grab.x, y: cursor.y - grab.y, ...size }, false);
    }, FRAME_MS);
  }

  public async endDrag(): Promise<void> {
    if (this.dragTimer === undefined || this.window.isDestroyed()) return;
    this.stopTimers();
    const bounds = this.window.getBounds();
    const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const anchor = anchorForBounds(bounds, workArea);
    this.animateTo(boundsForAnchor(anchor, this.size(), workArea));
    this.preferences = { ...this.preferences, anchor, corner: cornerForAnchor(anchor) };
    await this.persist(this.preferences);
  }

  public dispose(): void {
    this.stopTimers();
  }

  private animateTo(target: Rectangle): void {
    const from = this.window.getBounds();
    const startedAt = Date.now();
    this.snapTimer = setInterval(() => {
      if (this.window.isDestroyed()) return this.stopTimers();
      const t = Math.min(1, (Date.now() - startedAt) / SNAP_MS);
      const eased = 1 - (1 - t) ** 3;
      this.window.setBounds(
        {
          x: Math.round(from.x + (target.x - from.x) * eased),
          y: Math.round(from.y + (target.y - from.y) * eased),
          width: target.width,
          height: target.height,
        },
        false,
      );
      if (t === 1) this.stopTimers();
    }, FRAME_MS);
  }

  private refreshMouse(): void {
    if (this.window.isDestroyed()) return;
    const ignore = this.preferences.locked || !this.interactive;
    this.window.setIgnoreMouseEvents(ignore, { forward: true });
  }

  private size(): { width: number; height: number } {
    return {
      width: Math.round(OVERLAY_WIDTH * this.preferences.scale),
      height: Math.round(OVERLAY_HEIGHT * this.preferences.scale),
    };
  }

  private workArea(): Rectangle {
    return screen.getDisplayMatching(this.window.getBounds()).workArea;
  }

  private stopTimers(): void {
    clearInterval(this.dragTimer);
    clearInterval(this.snapTimer);
    this.dragTimer = undefined;
    this.snapTimer = undefined;
  }
}

export function anchorForCorner(corner: PilotOverlayCorner): PilotOverlayAnchor {
  return {
    edge: corner.endsWith('left') ? 'left' : 'right',
    offset: corner.startsWith('top') ? 0 : 1,
  };
}

export function cornerForAnchor({ edge, offset }: PilotOverlayAnchor): PilotOverlayCorner {
  const end = offset < 0.5 ? 0 : 1;
  if (edge === 'left' || edge === 'right') {
    return `${end === 0 ? 'top' : 'bottom'}_${edge}`;
  }
  return `${edge}_${end === 0 ? 'left' : 'right'}`;
}

export function anchorForBounds(bounds: Rectangle, workArea: Rectangle): PilotOverlayAnchor {
  const centerX = bounds.x + bounds.width / 2 - workArea.x;
  const centerY = bounds.y + bounds.height / 2 - workArea.y;
  const distances = [
    ['left', centerX],
    ['right', workArea.width - centerX],
    ['top', centerY],
    ['bottom', workArea.height - centerY],
  ] as const;
  const [edge] = distances.reduce((nearest, next) => (next[1] < nearest[1] ? next : nearest));
  const vertical = edge === 'left' || edge === 'right';
  const travel = vertical
    ? workArea.height - bounds.height - EDGE_MARGIN * 2
    : workArea.width - bounds.width - EDGE_MARGIN * 2;
  const position = vertical
    ? bounds.y - workArea.y - EDGE_MARGIN
    : bounds.x - workArea.x - EDGE_MARGIN;
  const raw = Math.min(1, Math.max(0, position / Math.max(1, travel)));
  const offset = raw < CORNER_MAGNET ? 0 : raw > 1 - CORNER_MAGNET ? 1 : raw;
  return { edge, offset };
}

export function boundsForAnchor(
  { edge, offset }: PilotOverlayAnchor,
  size: { width: number; height: number },
  workArea: Rectangle,
): Rectangle {
  const minX = workArea.x + EDGE_MARGIN;
  const maxX = workArea.x + workArea.width - size.width - EDGE_MARGIN;
  const minY = workArea.y + EDGE_MARGIN;
  const maxY = workArea.y + workArea.height - size.height - EDGE_MARGIN;
  const along = (min: number, max: number) => Math.round(min + (max - min) * offset);
  const x = edge === 'left' ? minX : edge === 'right' ? maxX : along(minX, maxX);
  const y = edge === 'top' ? minY : edge === 'bottom' ? maxY : along(minY, maxY);
  return { x, y, ...size };
}
