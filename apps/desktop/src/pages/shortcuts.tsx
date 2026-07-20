import type { ShortcutAction, ShortcutBindings } from '@obscurpilot/contracts/audio';
import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';

const ACTIONS: ReadonlyArray<{
  readonly action: ShortcutAction;
  readonly name: string;
  readonly description: string;
}> = [
  {
    action: 'holdToTalk',
    name: 'Hold to talk',
    description: 'The copilot listens only while these keys stay held. Release to send.',
  },
  {
    action: 'toggleTalk',
    name: 'Push to talk (toggle)',
    description: 'Press once to open the microphone, press again to send. Off by default.',
  },
  {
    action: 'terminate',
    name: 'Terminate',
    description:
      'Panic switch. Stops listening, cancels the running command and emergency-stops a live session.',
  },
  {
    action: 'toggleWindow',
    name: 'Show or hide ObscurPilot',
    description: 'Brings this window back from the tray, or tucks it away while you play.',
  },
];

function comboFromKeyboardEvent(event: KeyboardEvent): string | undefined {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');
  const code = event.code;
  let key: string | undefined;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;
  else if (['Space', 'End', 'Home', 'PageUp', 'PageDown', 'Insert'].includes(code)) key = code;
  else if (/^Arrow(Up|Down|Left|Right)$/.test(code)) key = code;
  if (key === undefined) return undefined;
  parts.push(key);
  return parts.join('+');
}

function KeyCombo({ combo }: { readonly combo: string }) {
  if (combo === '') return <span className="op-shortcut-off">Not set</span>;
  return (
    <span className="op-kbd-group">
      {combo.split('+').map((part) => (
        <kbd className="op-kbd" key={part}>
          {part}
        </kbd>
      ))}
    </span>
  );
}

export function ShortcutsPage() {
  const [bindings, setBindings] = useState<ShortcutBindings>();
  const [recording, setRecording] = useState<ShortcutAction>();
  const [notice, setNotice] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.obscurPilot
      .getShortcuts()
      .then((current) => {
        if (!cancelled) setBindings(current);
      })
      .catch(() => {
        if (!cancelled) setNotice('Shortcuts are unavailable right now. Reopen this page.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (recording === undefined) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setRecording(undefined);
        return;
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        setBindings((current) =>
          current === undefined ? current : { ...current, [recording]: '' },
        );
        setDirty(true);
        setRecording(undefined);
        return;
      }
      const combo = comboFromKeyboardEvent(event);
      if (combo === undefined) return;
      setBindings((current) =>
        current === undefined ? current : { ...current, [recording]: combo },
      );
      setDirty(true);
      setRecording(undefined);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recording]);

  const duplicates = (() => {
    if (bindings === undefined) return new Set<string>();
    const seen = new Map<string, number>();
    for (const { action } of ACTIONS) {
      const value = bindings[action];
      if (value !== '') seen.set(value, (seen.get(value) ?? 0) + 1);
    }
    return new Set([...seen.entries()].filter(([, count]) => count > 1).map(([value]) => value));
  })();

  const save = async () => {
    if (bindings === undefined || duplicates.size > 0) return;
    setSaving(true);
    setNotice(undefined);
    try {
      const saved = await window.obscurPilot.setShortcuts(bindings);
      setBindings(saved);
      setDirty(false);
      setNotice('Shortcuts saved. They work everywhere, even while a game has focus.');
    } catch {
      setNotice('One of these combinations cannot be used. Pick a different one.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="op-page">
      <header className="op-page-head">
        <h1>Shortcuts</h1>
        <p>
          Global keys that work while you play or record. Click a shortcut, then press the new
          combination. Press Backspace to turn one off, Escape to cancel.
        </p>
      </header>
      <Card>
        <CardHeader>
          <h2 className="panel-title">Key bindings</h2>
        </CardHeader>
        <CardContent>
          {bindings === undefined ? (
            <p className="op-muted">Loading shortcuts…</p>
          ) : (
            <ul className="op-shortcut-list">
              {ACTIONS.map(({ action, name, description }) => {
                const value = bindings[action];
                const isRecording = recording === action;
                const conflicted = value !== '' && duplicates.has(value);
                return (
                  <li className="op-shortcut-row" data-conflict={conflicted} key={action}>
                    <div className="op-shortcut-copy">
                      <span className="op-shortcut-name">{name}</span>
                      <span className="op-shortcut-description">{description}</span>
                      {conflicted ? (
                        <span className="op-shortcut-conflict" role="alert">
                          This combination is used twice. Change one of them.
                        </span>
                      ) : null}
                    </div>
                    <button
                      className="op-shortcut-capture"
                      data-recording={isRecording}
                      type="button"
                      onClick={() => setRecording(isRecording ? undefined : action)}
                    >
                      {isRecording ? 'Press keys…' : <KeyCombo combo={value} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="op-shortcut-foot">
            {bindings !== undefined && bindings.holdToTalk === '' && bindings.toggleTalk === '' ? (
              <p className="op-shortcut-warning" role="alert">
                Both talk shortcuts are off — the copilot cannot hear you until one is set.
              </p>
            ) : null}
            {notice !== undefined ? (
              <p className="op-muted" role="status">
                {notice}
              </p>
            ) : null}
            <Button disabled={!dirty || saving || duplicates.size > 0} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save shortcuts'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
