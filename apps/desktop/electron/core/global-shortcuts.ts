import type { ShortcutAction, ShortcutBindings } from '@obscurpilot/contracts/audio';
import { uIOhook, UiohookKey, type UiohookKeyboardEvent } from 'uiohook-napi';

interface Combo {
  readonly alt: boolean;
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
  readonly keycode: number;
}

const KEYCODE_BY_UPPER_NAME: ReadonlyMap<string, number> = new Map(
  Object.entries(UiohookKey as unknown as Record<string, number>)
    .filter(([, code]) => typeof code === 'number')
    .map(([name, code]) => [name.toUpperCase(), code]),
);

export function parseCombo(accelerator: string): Combo | undefined {
  let alt = false;
  let ctrl = false;
  let shift = false;
  let meta = false;
  let keycode: number | undefined;
  for (const raw of accelerator.split('+')) {
    const upper = raw.trim().toUpperCase();
    if (upper === 'ALT') alt = true;
    else if (upper === 'CTRL' || upper === 'CONTROL' || upper === 'COMMANDORCONTROL') ctrl = true;
    else if (upper === 'SHIFT') shift = true;
    else if (upper === 'META' || upper === 'SUPER' || upper === 'CMD' || upper === 'COMMAND') {
      meta = true;
    } else {
      const code = KEYCODE_BY_UPPER_NAME.get(upper);
      if (code === undefined || keycode !== undefined) return undefined;
      keycode = code;
    }
  }
  return keycode === undefined ? undefined : { alt, ctrl, shift, meta, keycode };
}

export function isUsableBinding(accelerator: string): boolean {
  return accelerator === '' || parseCombo(accelerator) !== undefined;
}

export interface ShortcutHandlers {
  onHoldToTalkDown(): void;
  onHoldToTalkUp(): void;
  onToggleTalk(): void;
  onTerminate(): void;
  onToggleWindow(): void;
}

/**
 * Sole owner of the global keyboard hook. Hold-to-talk fires on the down and
 * up edges; every other action fires once per press. Combos require an exact
 * modifier match so a superset chord never triggers a binding.
 */
export class GlobalShortcutService {
  private combos = new Map<ShortcutAction, Combo>();
  private readonly down = new Set<ShortcutAction>();
  private hookStarted = false;
  private disposed = false;

  public constructor(private readonly handlers: ShortcutHandlers) {}

  public setBindings(bindings: ShortcutBindings): void {
    const next = new Map<ShortcutAction, Combo>();
    for (const action of Object.keys(bindings) as ShortcutAction[]) {
      const value = bindings[action];
      if (value === '') continue;
      const combo = parseCombo(value);
      if (combo === undefined) {
        throw new Error(`Shortcut for ${action} is not usable: ${value}`);
      }
      next.set(action, combo);
    }
    this.combos = next;
    this.down.clear();
    if (!this.hookStarted && !this.disposed) {
      uIOhook.on('keydown', this.onKeyDown);
      uIOhook.on('keyup', this.onKeyUp);
      uIOhook.start();
      this.hookStarted = true;
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.hookStarted) {
      uIOhook.off('keydown', this.onKeyDown);
      uIOhook.off('keyup', this.onKeyUp);
      uIOhook.stop();
      this.hookStarted = false;
    }
    this.down.clear();
  }

  private matches(combo: Combo, event: UiohookKeyboardEvent): boolean {
    return (
      event.keycode === combo.keycode &&
      event.altKey === combo.alt &&
      event.ctrlKey === combo.ctrl &&
      event.shiftKey === combo.shift &&
      event.metaKey === combo.meta
    );
  }

  private broken(combo: Combo, event: UiohookKeyboardEvent): boolean {
    return (
      event.keycode === combo.keycode ||
      (combo.alt && !event.altKey) ||
      (combo.ctrl && !event.ctrlKey) ||
      (combo.shift && !event.shiftKey) ||
      (combo.meta && !event.metaKey)
    );
  }

  private readonly onKeyDown = (event: UiohookKeyboardEvent): void => {
    if (this.disposed) return;
    for (const [action, combo] of this.combos) {
      if (this.down.has(action) || !this.matches(combo, event)) continue;
      this.down.add(action);
      if (action === 'holdToTalk') this.handlers.onHoldToTalkDown();
      else if (action === 'toggleTalk') this.handlers.onToggleTalk();
      else if (action === 'terminate') this.handlers.onTerminate();
      else if (action === 'toggleWindow') this.handlers.onToggleWindow();
    }
  };

  private readonly onKeyUp = (event: UiohookKeyboardEvent): void => {
    if (this.disposed) return;
    for (const action of [...this.down]) {
      const combo = this.combos.get(action);
      if (combo === undefined || !this.broken(combo, event)) continue;
      this.down.delete(action);
      if (action === 'holdToTalk') this.handlers.onHoldToTalkUp();
    }
  };
}
