import type { PttProjection } from '@obscurpilot/contracts/audio';
import { useEffect, useRef, useState } from 'react';

const INITIAL: PttProjection = {
  phase: 'idle',
  elapsedMs: 0,
  level: 0,
  reasonCode: 'IDLE',
};

const LABELS: Record<PttProjection['phase'], string> = {
  idle: 'Hold to speak',
  arming: 'Opening microphone',
  capturing: 'Listening',
  encoding: 'Preparing voice',
  ready: 'Voice captured',
  rejected: 'Try again',
  error: 'Microphone unavailable',
};

export function VoicePresence() {
  const [projection, setProjection] = useState<PttProjection>(INITIAL);
  const orbRef = useRef<HTMLSpanElement>(null);
  const pressedRef = useRef(false);

  useEffect(
    () =>
      window.obscurPilot.onPttChanged((next) => {
        orbRef.current?.style.setProperty('--voice-energy', next.level.toFixed(3));
        setProjection((current) => {
          if (
            current.phase === next.phase &&
            current.reasonCode === next.reasonCode &&
            current.clip?.clipId === next.clip?.clipId
          ) {
            return current;
          }
          return { ...next, level: 0 };
        });
      }),
    [],
  );

  const press = () => {
    if (pressedRef.current) return;
    pressedRef.current = true;
    void window.obscurPilot.commandPtt('press');
  };
  const release = () => {
    if (!pressedRef.current) return;
    pressedRef.current = false;
    void window.obscurPilot.commandPtt('release');
  };

  return (
    <section className="voice-presence" aria-labelledby="voice-presence-title">
      <div>
        <p className="eyebrow">Voice boundary</p>
        <h2 id="voice-presence-title">Agent presence</h2>
        <p className="voice-copy">
          Hold the control while speaking. The global shortcut toggles capture when this window is
          not focused.
        </p>
      </div>
      <button
        className="voice-control"
        data-phase={projection.phase}
        aria-label={LABELS[projection.phase]}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          press();
        }}
        onPointerUp={release}
        onPointerCancel={() => {
          pressedRef.current = false;
          void window.obscurPilot.commandPtt('cancel');
        }}
        onKeyDown={(event) => {
          if (!event.repeat && (event.key === ' ' || event.key === 'Enter')) {
            event.preventDefault();
            press();
          }
        }}
        onKeyUp={(event) => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            release();
          }
        }}
      >
        <span className="orb-shell" ref={orbRef} aria-hidden="true">
          <span className="orb-ring orb-ring-outer" />
          <span className="orb-ring orb-ring-inner" />
          <span className="orb-core" />
        </span>
        <span className="voice-label">{LABELS[projection.phase]}</span>
        <span className="voice-reason">{projection.reasonCode.replaceAll('_', ' ')}</span>
      </button>
      <div className="sr-only" aria-live="polite">
        {LABELS[projection.phase]}
      </div>
      {projection.clip !== undefined ? (
        <p className="clip-proof">
          Captured {Math.round(projection.clip.durationMs / 100) / 10}s ·{' '}
          {Math.round(projection.clip.bytes / 1024)} KB
        </p>
      ) : null}
    </section>
  );
}
