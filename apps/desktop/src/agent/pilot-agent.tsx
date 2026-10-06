import { type Ref, useEffect, useImperativeHandle, useRef } from 'react';
import { PilotAgentEngine } from './agent-engine';
import type { AgentMood } from './agent-mood';

export interface PilotAgentHandle {
  setEnergy(level: number): void;
  pulseSpeech(): void;
  celebrate(): void;
}

interface PilotAgentProps {
  readonly mood: AgentMood;
  /** Native hover tooltip; the overlay has no visible text of its own. */
  readonly title?: string;
  readonly ref?: Ref<PilotAgentHandle>;
  /** The pointer moved onto or off the character itself (not the transparent margin). */
  readonly onInteractiveChange?: (interactive: boolean) => void;
  readonly onDrag?: (phase: 'start' | 'end') => void;
}

const POINTER_IDLE_MS = 2_500;
const DRAG_THRESHOLD_PX = 4;

export function PilotAgent({ mood, title, ref, onInteractiveChange, onDrag }: PilotAgentProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<PilotAgentEngine | null>(null);
  const callbacks = useRef({ onInteractiveChange, onDrag });

  useEffect(() => {
    callbacks.current = { onInteractiveChange, onDrag };
  });

  useImperativeHandle(
    ref,
    () => ({
      setEnergy: (level) => engineRef.current?.setEnergy(level),
      pulseSpeech: () => engineRef.current?.pulseSpeech(),
      celebrate: () => engineRef.current?.react('celebrate'),
    }),
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const engine = new PilotAgentEngine(canvas, { reducedMotion: motionQuery.matches });
    engineRef.current = engine;

    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      engine.resize(rect.width, rect.height, window.devicePixelRatio);
    };
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(canvas);
    measure();

    let interactive = false;
    const setInteractive = (next: boolean) => {
      canvas.style.cursor = press?.dragging ? 'grabbing' : next ? 'grab' : 'default';
      if (next === interactive) return;
      interactive = next;
      callbacks.current.onInteractiveChange?.(next);
    };

    let press: { x: number; y: number; lastX: number; lastY: number; dragging: boolean } | null =
      null;
    const release = () => {
      if (press === null) return;
      const { dragging } = press;
      press = null;
      if (dragging) {
        engine.setGrabbed(false);
        callbacks.current.onDrag?.('end');
      } else {
        engine.react('poke');
      }
      setInteractive(interactive);
    };

    // Click-through overlays still receive forwarded mouse moves, but not reliable leave
    // events, so the gaze lets go after a short idle instead.
    let pointerTimer = 0;
    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      engine.setPointer(x, y);
      if (press === null) {
        setInteractive(engine.hitTest(x, y));
      } else {
        const moved = Math.hypot(event.screenX - press.x, event.screenY - press.y);
        if (!press.dragging && moved > DRAG_THRESHOLD_PX) {
          press.dragging = true;
          engine.setGrabbed(true);
          callbacks.current.onDrag?.('start');
          setInteractive(true);
        }
        if (press.dragging) engine.carry(event.screenX - press.lastX, event.screenY - press.lastY);
        press.lastX = event.screenX;
        press.lastY = event.screenY;
      }
      window.clearTimeout(pointerTimer);
      pointerTimer = window.setTimeout(() => {
        if (press !== null) return;
        engine.clearPointer();
        setInteractive(false);
      }, POINTER_IDLE_MS);
    };
    const onPointerDown = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (!engine.hitTest(event.clientX - rect.left, event.clientY - rect.top)) return;
      canvas.setPointerCapture(event.pointerId);
      press = {
        x: event.screenX,
        y: event.screenY,
        lastX: event.screenX,
        lastY: event.screenY,
        dragging: false,
      };
    };
    const onPointerLeave = () => {
      if (press !== null) return;
      engine.clearPointer();
      setInteractive(false);
    };
    const onMotionChange = () => engine.setReducedMotion(motionQuery.matches);

    window.addEventListener('pointermove', onPointerMove);
    document.documentElement.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('lostpointercapture', release);
    motionQuery.addEventListener('change', onMotionChange);
    return () => {
      window.clearTimeout(pointerTimer);
      window.removeEventListener('pointermove', onPointerMove);
      document.documentElement.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', release);
      canvas.removeEventListener('lostpointercapture', release);
      motionQuery.removeEventListener('change', onMotionChange);
      resizeObserver.disconnect();
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setMood(mood);
  }, [mood]);

  return <canvas ref={canvasRef} className="pilot-agent" title={title} aria-hidden="true" />;
}
