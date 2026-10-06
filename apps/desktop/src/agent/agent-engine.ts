import type { AgentMood } from './agent-mood';

/*
 * Procedural renderer for the Pilot presence character.
 *
 * Everything is drawn in a fixed 140x160 design space and scaled to the canvas, so the
 * overlay scale preference never changes proportions. The face is a tiny LED matrix:
 * expressions are painted as smooth shapes into a 24x13 offscreen bitmap, then each lit
 * pixel becomes a glowing dot on the visor. All motion runs through springs, so any mood
 * can interrupt any other without popping.
 */

type Rgb = readonly [number, number, number];
type Mouth = 'none' | 'smile' | 'frown' | 'flat' | 'o' | 'dots' | 'voice' | 'meter';
type Fx =
  | 'thought'
  | 'sparks'
  | 'listen'
  | 'speak'
  | 'ask'
  | 'broadcast'
  | 'sleep'
  | 'glitch'
  | 'offline';
type HandPose = readonly [number, number, number, number];
type ReactionKind = 'celebrate' | 'poke' | 'dizzy' | 'notice';
export type AgentReaction = 'celebrate' | 'poke';

interface Pose {
  readonly aura: Rgb;
  readonly eye: Rgb;
  readonly tally: Rgb;
  readonly tallyBlink: number;
  readonly glow: number;
  readonly eyeOpen: number;
  readonly eyeSize: number;
  readonly eyeSmile: number;
  readonly eyeLid: number;
  readonly eyeSlant: number;
  readonly eyeRaise: number;
  readonly chevronEyes: boolean;
  readonly gazeX: number;
  readonly gazeY: number;
  readonly wander: number;
  readonly tilt: number;
  readonly lean: number;
  readonly lift: number;
  readonly bob: number;
  readonly tempo: number;
  readonly hands: HandPose;
  readonly handJitter: number;
  readonly mouth: Mouth;
  readonly fx: Fx | null;
}

interface Particle {
  kind: 'spark' | 'bubble' | 'z';
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  ttl: number;
  size: number;
  spin: number;
  rgb: Rgb;
}

const DESIGN_W = 140;
const DESIGN_H = 160;
const HEAD_X = 70;
const HEAD_Y = 78;
const HEAD_A = 44;
const HEAD_B = 38;
const GROUND_Y = 146;
const VISOR_CY = 3;
const COLS = 24;
const ROWS = 13;
const PITCH = 2.8;
const HAND_R = 8.5;
const ANTENNA_LENGTH = 15;
const MAX_PARTICLES = 90;
const FX_KEYS: readonly Fx[] = [
  'thought',
  'sparks',
  'listen',
  'speak',
  'ask',
  'broadcast',
  'sleep',
  'glitch',
  'offline',
];

function hex(value: string): Rgb {
  const n = Number.parseInt(value.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const BASE: Pose = {
  aura: hex('#8b7cff'),
  eye: hex('#d6fff8'),
  tally: hex('#4c4399'),
  tallyBlink: 0,
  glow: 0.55,
  eyeOpen: 1,
  eyeSize: 1,
  eyeSmile: 0.12,
  eyeLid: 0,
  eyeSlant: 0,
  eyeRaise: 0,
  chevronEyes: false,
  gazeX: 0,
  gazeY: 0,
  wander: 0.65,
  tilt: 0,
  lean: 0,
  lift: 0,
  bob: 2.2,
  tempo: 1,
  hands: [-52, 26, 52, 26],
  handJitter: 0,
  mouth: 'none',
  fx: null,
};

const POSES: Readonly<Record<AgentMood, Pose>> = {
  idle: BASE,
  standby: {
    ...BASE,
    aura: hex('#6d63d9'),
    tally: hex('#363a66'),
    glow: 0.36,
    eyeLid: 0.28,
    eyeSmile: 0,
    wander: 0.45,
    bob: 1.6,
    tempo: 0.7,
    hands: [-50, 30, 50, 30],
  },
  alert: {
    ...BASE,
    aura: hex('#a5b4fc'),
    tally: hex('#a5b4fc'),
    glow: 0.72,
    eyeSize: 1.14,
    eyeSmile: 0,
    wander: 0.15,
    lift: -4,
    hands: [-55, 10, 55, 10],
    mouth: 'o',
  },
  listening: {
    ...BASE,
    aura: hex('#2dd4bf'),
    eye: hex('#ccfbf1'),
    tally: hex('#2dd4bf'),
    glow: 0.8,
    eyeSize: 1.1,
    eyeSmile: 0,
    wander: 0.12,
    tilt: 0.09,
    lean: 2,
    hands: [-49, -4, 49, -4],
    handJitter: 0.15,
    mouth: 'meter',
    fx: 'listen',
  },
  processing: {
    ...BASE,
    tally: hex('#8b7cff'),
    tallyBlink: 1.6,
    eyeOpen: 0.5,
    eyeSmile: 0,
    eyeLid: 0.1,
    gazeY: -0.25,
    wander: 0,
    hands: [-40, 34, 40, 34],
    handJitter: 0.6,
    mouth: 'dots',
    fx: 'thought',
  },
  thinking: {
    ...BASE,
    aura: hex('#a78bfa'),
    tally: hex('#a78bfa'),
    tallyBlink: 0.8,
    eyeSmile: 0,
    eyeLid: 0.16,
    eyeRaise: 0.55,
    gazeX: 0.75,
    gazeY: -0.85,
    wander: 0.1,
    tilt: -0.12,
    hands: [-50, 26, 20, 38],
    mouth: 'flat',
    fx: 'thought',
  },
  working: {
    ...BASE,
    aura: hex('#38bdf8'),
    eye: hex('#e0f2fe'),
    tally: hex('#38bdf8'),
    tallyBlink: 2,
    glow: 0.7,
    eyeSmile: 0,
    eyeLid: 0.14,
    eyeSlant: 0.4,
    gazeY: 0.45,
    wander: 0.08,
    tempo: 1.3,
    hands: [-26, 44, 26, 44],
    handJitter: 1,
    mouth: 'flat',
    fx: 'sparks',
  },
  asking: {
    ...BASE,
    aura: hex('#ffb547'),
    eye: hex('#fff1d6'),
    tally: hex('#ffb547'),
    tallyBlink: 1.2,
    glow: 0.75,
    eyeSize: 1.08,
    eyeSmile: 0,
    eyeRaise: 0.75,
    gazeY: 0.1,
    wander: 0.1,
    tilt: 0.15,
    hands: [-52, 26, 54, -12],
    mouth: 'o',
    fx: 'ask',
  },
  speaking: {
    ...BASE,
    aura: hex('#5eead4'),
    tally: hex('#5eead4'),
    glow: 0.72,
    eyeSmile: 0.45,
    wander: 0.35,
    hands: [-50, 18, 50, 18],
    handJitter: 0.2,
    mouth: 'voice',
    fx: 'speak',
  },
  happy: {
    ...BASE,
    aura: hex('#f472b6'),
    eye: hex('#fdf4ff'),
    tally: hex('#f472b6'),
    glow: 0.82,
    eyeSmile: 1,
    lift: -6,
    bob: 3.5,
    tempo: 1.6,
    hands: [-50, -30, 50, -30],
    mouth: 'smile',
  },
  error: {
    ...BASE,
    aura: hex('#ff4d5e'),
    eye: hex('#ffb3ba'),
    tally: hex('#ff4d5e'),
    tallyBlink: 4,
    glow: 0.85,
    eyeSmile: 0,
    chevronEyes: true,
    wander: 0,
    tilt: -0.06,
    hands: [-36, -32, 36, -32],
    handJitter: 0.35,
    mouth: 'frown',
    fx: 'glitch',
  },
  worried: {
    ...BASE,
    aura: hex('#fb923c'),
    eye: hex('#ffedd5'),
    tally: hex('#fb923c'),
    tallyBlink: 1.4,
    eyeSmile: 0,
    eyeSize: 0.95,
    eyeLid: 0.18,
    eyeSlant: -0.45,
    wander: 0.8,
    tempo: 1.3,
    hands: [-16, 37, 16, 37],
    mouth: 'frown',
  },
  offline: {
    ...BASE,
    aura: hex('#64748b'),
    eye: hex('#a8b3c4'),
    tally: hex('#2a2f45'),
    glow: 0.22,
    eyeSmile: 0,
    eyeLid: 0.3,
    eyeSlant: -0.25,
    gazeY: 0.35,
    wander: 0.3,
    lift: 3,
    bob: 1.4,
    tempo: 0.6,
    hands: [-44, 40, 44, 40],
    mouth: 'flat',
    fx: 'offline',
  },
  sleeping: {
    ...BASE,
    aura: hex('#475569'),
    eye: hex('#94a3b8'),
    tally: hex('#1e2233'),
    glow: 0.24,
    eyeOpen: 0,
    eyeSmile: 0,
    wander: 0,
    gazeY: 0.3,
    lift: 6,
    bob: 1.4,
    tempo: 0.45,
    tilt: -0.05,
    hands: [-42, 44, 42, 44],
    fx: 'sleep',
  },
  live: {
    ...BASE,
    aura: hex('#ff6b81'),
    tally: hex('#ff2e4d'),
    glow: 0.7,
    eyeSmile: 0.3,
    eyeSlant: 0.15,
    bob: 2.6,
    tempo: 1.2,
    hands: [-52, 22, 52, 6],
    mouth: 'smile',
    fx: 'broadcast',
  },
};

const CONFETTI: readonly Rgb[] = [
  hex('#f0abfc'),
  hex('#5eead4'),
  hex('#ffd36e'),
  hex('#8b7cff'),
  hex('#ffffff'),
];

class Spring {
  v = 0;
  target: number;

  constructor(
    public x: number,
    private readonly k: number,
    private readonly d: number = 2 * Math.sqrt(k),
  ) {
    this.target = x;
  }

  step(dt: number): void {
    this.v += (this.k * (this.target - this.x) - this.d * this.v) * dt;
    this.x += this.v * dt;
  }

  get settled(): boolean {
    return Math.abs(this.v) < 1e-3 && Math.abs(this.target - this.x) < 1e-3;
  }
}

class ColorSpring {
  readonly channels: readonly [Spring, Spring, Spring];

  constructor(rgb: Rgb, k = 40) {
    this.channels = [new Spring(rgb[0], k), new Spring(rgb[1], k), new Spring(rgb[2], k)];
  }

  set(rgb: Rgb): void {
    this.channels[0].target = rgb[0];
    this.channels[1].target = rgb[1];
    this.channels[2].target = rgb[2];
  }

  rgba(alpha: number, lift = 0): string {
    const [r, g, b] = this.channels;
    const tone = (c: Spring) => Math.round(clamp(c.x + (255 - c.x) * lift, 0, 255));
    return rgbString([tone(r), tone(g), tone(b)], alpha);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function rgbString([r, g, b]: Rgb, alpha: number): string {
  return `rgba(${r},${g},${b},${clamp(alpha, 0, 1).toFixed(3)})`;
}

export class PilotAgentEngine {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly matrix: CanvasRenderingContext2D;
  private readonly springs = {
    lift: new Spring(0, 120, 10),
    squash: new Spring(1, 260, 11),
    tilt: new Spring(0, 90, 12),
    lean: new Spring(0, 90),
    gazeX: new Spring(0, 420, 32),
    gazeY: new Spring(0, 420, 32),
    eyeOpen: new Spring(1, 260),
    eyeSize: new Spring(1, 200, 20),
    eyeSmile: new Spring(0, 160),
    eyeLid: new Spring(0, 160),
    eyeSlant: new Spring(0, 160),
    eyeRaise: new Spring(0, 160),
    chevron: new Spring(0, 120),
    dizzy: new Spring(0, 120),
    glow: new Spring(0.55, 40),
    bob: new Spring(2.2, 30),
    tempo: new Spring(1, 30),
    tally: new Spring(1, 120),
    antenna: new Spring(0, 70, 3.5),
    handLX: new Spring(-52, 140, 13),
    handLY: new Spring(26, 140, 13),
    handRX: new Spring(52, 140, 13),
    handRY: new Spring(26, 140, 13),
    handJitter: new Spring(0, 60),
    mouthMix: new Spring(1, 90),
  };
  private readonly fx = new Map<Fx, Spring>(FX_KEYS.map((key) => [key, new Spring(0, 30)]));
  private readonly aura = new ColorSpring(BASE.aura);
  private readonly eye = new ColorSpring(BASE.eye, 60);
  private readonly tallyColor = new ColorSpring(BASE.tally, 60);
  private readonly particles: Particle[] = [];
  private readonly meter = new Array<number>(10).fill(0);

  private mood: AgentMood = 'idle';
  private mouth: Mouth = BASE.mouth;
  private previousMouth: Mouth = BASE.mouth;
  private reducedMotion: boolean;
  private destroyed = false;
  private raf = 0;
  private lastFrame = 0;
  private time = 0;
  private bobPhase = 0;
  private cssWidth = DESIGN_W;
  private cssHeight = DESIGN_H;
  private dpr = 1;

  private energyTarget = 0;
  private energy = 0;
  private energyPeak = 0.08;
  private energyAt = -Infinity;
  private voiceOnsetAt = -Infinity;
  private meterClock = 0;
  private speechKick = 0;
  private speech = 0;

  private pointer: { x: number; y: number } | null = null;
  private grabbed = false;
  private lastNoticeAt = -Infinity;
  private pokes: number[] = [];
  private reaction: { kind: ReactionKind; until: number } | null = null;
  private shakeUntil = 0;
  private shakeLength = 1;
  private nextBlinkAt = 1.5;
  private blinkStartedAt = -1;
  private nextSaccadeAt = 0.6;
  private saccade = { x: 0, y: 0 };
  private nextIdleActAt = 7;
  private idleAct: { kind: 'glance' | 'smile'; until: number; dir: number } | null = null;
  private glitchOffset = 0;
  private bulb = { x: HEAD_X, y: HEAD_Y - HEAD_B - ANTENNA_LENGTH };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    options: { reducedMotion: boolean },
  ) {
    const ctx = canvas.getContext('2d');
    const matrixCanvas = document.createElement('canvas');
    matrixCanvas.width = COLS;
    matrixCanvas.height = ROWS;
    const matrix = matrixCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || !matrix) throw new Error('Canvas 2D is unavailable for the Pilot agent');
    this.ctx = ctx;
    this.matrix = matrix;
    this.reducedMotion = options.reducedMotion;
    this.wake();
  }

  setMood(next: AgentMood): void {
    if (next === this.mood) return;
    const reconnected = this.mood === 'offline';
    this.mood = next;
    if (!this.grabbed) this.switchMouth(POSES[next].mouth);
    this.idleAct = null;
    if (!this.reducedMotion) {
      this.enterMood(next);
      if (reconnected) {
        this.hop(110);
        this.burst(10);
      }
    }
    this.wake();
  }

  /**
   * Mic RMS arrives about 8 times a second and normal speech sits near 0.1 to 0.3, so it is
   * normalized against a slowly decaying peak; any microphone then drives the full range.
   */
  setEnergy(level: number): void {
    const raw = clamp(level, 0, 1);
    this.energyPeak = Math.max(raw, this.energyPeak * 0.985, 0.06);
    const shaped = raw < 0.012 ? 0 : clamp(Math.sqrt(raw / this.energyPeak), 0, 1);
    if (shaped > 0.55 && this.energyTarget < 0.25 && this.time - this.voiceOnsetAt > 0.45) {
      this.voiceOnsetAt = this.time;
      if (!this.reducedMotion && this.mood === 'listening') this.hop(38 * shaped);
    }
    this.energyTarget = shaped;
    this.energyAt = this.time;
    this.wake();
  }

  /** Accent from a speech-synthesis word boundary, layered over the procedural babble. */
  pulseSpeech(): void {
    this.speechKick = 1;
    this.wake();
  }

  react(kind: AgentReaction): void {
    if (kind === 'celebrate') {
      this.reaction = { kind, until: this.time + 1.6 };
      if (!this.reducedMotion) {
        this.hop(150);
        this.burst(26);
      }
    } else {
      this.pokes = [...this.pokes.filter((at) => this.time - at < 1.8), this.time];
      if (this.pokes.length >= 4) {
        this.pokes = [];
        this.reaction = { kind: 'dizzy', until: this.time + 1.9 };
        if (!this.reducedMotion) this.springs.tilt.v += 5;
      } else {
        this.reaction = { kind: 'poke', until: this.time + 0.75 };
        if (!this.reducedMotion) {
          this.springs.squash.v -= 4.5;
          this.hop(55);
          this.burst(5);
        }
      }
    }
    this.wake();
  }

  setPointer(x: number, y: number): void {
    const { scale, offsetX } = this.layout();
    const designX = x / scale - offsetX;
    const designY = y / scale;
    if (!this.pointer && this.time - this.lastNoticeAt > 6 && this.reaction === null) {
      this.lastNoticeAt = this.time;
      this.reaction = { kind: 'notice', until: this.time + 1.1 };
      if (!this.reducedMotion) this.hop(45);
    }
    this.pointer = { x: designX, y: designY };
    this.wake();
  }

  clearPointer(): void {
    this.pointer = null;
    this.wake();
  }

  /** True when a canvas point (CSS px) lands on the character rather than empty space. */
  hitTest(x: number, y: number): boolean {
    const { scale, offsetX } = this.layout();
    const head = this.headWorld();
    const dx = (x / scale - offsetX - head.x) / (HEAD_A + 16);
    const dy = (y / scale - head.y + 6) / (HEAD_B + 20);
    return dx * dx + dy * dy <= 1;
  }

  /** Carried by the user: startled "whee" face and arms up, then a landing bounce. */
  setGrabbed(grabbed: boolean): void {
    if (grabbed === this.grabbed) return;
    this.grabbed = grabbed;
    this.switchMouth(grabbed ? 'o' : POSES[this.mood].mouth);
    if (!this.reducedMotion) {
      if (grabbed) this.hop(60);
      else {
        this.springs.squash.v -= 4;
        this.springs.lift.v += 40;
      }
    }
    this.wake();
  }

  /** Window movement while carried, in screen px; the body swings against it. */
  carry(dx: number, dy: number): void {
    if (!this.grabbed || this.reducedMotion) return;
    this.springs.tilt.v -= clamp(dx, -60, 60) * 0.05;
    this.springs.lift.v += clamp(dy, -60, 60) * 1.2;
    this.wake();
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    if (reduced) this.particles.length = 0;
    this.wake();
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.cssWidth = Math.max(1, cssWidth);
    this.cssHeight = Math.max(1, cssHeight);
    this.dpr = Math.max(1, dpr);
    this.canvas.width = Math.round(this.cssWidth * this.dpr);
    this.canvas.height = Math.round(this.cssHeight * this.dpr);
    this.wake(true);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private wake(forceDraw = false): void {
    if (this.destroyed) return;
    if (this.raf === 0) {
      this.lastFrame = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    } else if (forceDraw) {
      this.draw();
    }
  }

  private readonly frame = (now: number): void => {
    this.raf = 0;
    if (this.destroyed) return;
    const dt = clamp((now - this.lastFrame) / 1000, 0, 0.05);
    this.lastFrame = now;
    this.update(dt);
    this.draw();
    const transient = this.reaction !== null || this.idleAct !== null;
    if (!this.reducedMotion || transient || !this.isSettled()) {
      this.raf = requestAnimationFrame(this.frame);
    }
  };

  private layout(): { scale: number; offsetX: number } {
    const scale = this.cssHeight / DESIGN_H;
    return { scale, offsetX: (this.cssWidth / scale - DESIGN_W) / 2 };
  }

  private isSettled(): boolean {
    const springsSettled = Object.values(this.springs).every((s) => s.settled);
    const colorsSettled = [this.aura, this.eye, this.tallyColor].every((c) =>
      c.channels.every((s) => Math.abs(s.target - s.x) < 0.5),
    );
    return springsSettled && colorsSettled && [...this.fx.values()].every((s) => s.settled);
  }

  // ─── simulation ──────────────────────────────────────────────────────────

  private switchMouth(next: Mouth): void {
    if (next === this.mouth) return;
    this.previousMouth = this.mouth;
    this.mouth = next;
    this.springs.mouthMix.x = 0;
    this.springs.mouthMix.v = 0;
  }

  private enterMood(mood: AgentMood): void {
    switch (mood) {
      case 'listening':
      case 'alert':
        this.hop(75);
        break;
      case 'happy':
        this.hop(140);
        this.burst(22);
        break;
      case 'live':
        this.hop(95);
        this.burst(14);
        break;
      case 'error':
        this.shake(0.6);
        this.springs.squash.v -= 3.5;
        break;
      case 'worried':
        this.shake(0.3);
        break;
      case 'offline':
        this.springs.lift.v += 35;
        break;
      case 'asking':
        this.springs.tilt.v += 2.6;
        this.hop(40);
        break;
      case 'speaking':
        this.hop(40);
        break;
      default:
        break;
    }
  }

  private hop(velocity: number): void {
    this.springs.lift.v -= velocity;
    this.springs.squash.v += velocity * 0.028;
  }

  private shake(seconds: number): void {
    this.shakeUntil = this.time + seconds;
    this.shakeLength = seconds;
  }

  private burst(count: number): void {
    const origin = this.headWorld();
    for (let i = 0; i < count; i += 1) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5;
      const speed = 70 + Math.random() * 110;
      this.spawn({
        kind: 'spark',
        x: origin.x + Math.cos(angle) * 30,
        y: origin.y + Math.sin(angle) * 24,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        ttl: 0.8 + Math.random() * 0.7,
        size: 2 + Math.random() * 2.6,
        spin: (Math.random() - 0.5) * 12,
        rgb: CONFETTI[i % CONFETTI.length] ?? BASE.aura,
      });
    }
  }

  private spawn(particle: Particle): void {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push(particle);
  }

  private headWorld(): { x: number; y: number } {
    const bobY = Math.sin(this.bobPhase) * this.springs.bob.x;
    return {
      x: HEAD_X + this.springs.lean.x + this.shakeOffset(),
      y: HEAD_Y + this.springs.lift.x + bobY,
    };
  }

  private shakeOffset(): number {
    const remaining = this.shakeUntil - this.time;
    if (remaining <= 0 || this.reducedMotion) return 0;
    return Math.sin(this.time * 58) * 3.2 * (remaining / this.shakeLength);
  }

  private update(dt: number): void {
    this.time += dt;
    const animated = !this.reducedMotion;
    const s = this.springs;
    const pose = POSES[this.mood];

    if (this.reaction && this.time > this.reaction.until) this.reaction = null;
    if (this.idleAct && this.time > this.idleAct.until) this.idleAct = null;

    // Voice signals: mic energy for listening, procedural babble plus word accents for speech.
    this.energy += (this.energyTarget - this.energy) * (1 - Math.exp(-dt * 16));
    // Hold the last reading across the gap between chunks, then fall away if the mic goes quiet.
    if (this.time - this.energyAt > 0.2) this.energyTarget *= Math.exp(-dt * 6);
    this.meterClock += dt;
    if (this.meterClock > 0.07) {
      this.meterClock = 0;
      this.meter.shift();
      this.meter.push(this.energy);
    }
    this.speechKick *= Math.exp(-dt * 7);
    const babble =
      Math.max(0, Math.sin(this.time * 11.5 + Math.sin(this.time * 3.1) * 2)) *
      (0.55 + 0.45 * Math.sin(this.time * 1.7));
    const speechTarget = this.mood === 'speaking' ? clamp(babble * 0.8 + this.speechKick, 0, 1) : 0;
    this.speech += (speechTarget - this.speech) * (1 - Math.exp(-dt * 18));

    // Autonomous life: blinks, saccades, and small idle gestures.
    if (animated) {
      if (this.time >= this.nextBlinkAt) {
        this.blinkStartedAt = this.time;
        this.nextBlinkAt =
          this.time + (Math.random() < 0.2 ? 0.28 : 2.2 + Math.random() * 3.6);
      }
      if (this.time >= this.nextSaccadeAt) {
        this.saccade = { x: (Math.random() * 2 - 1) * 0.9, y: (Math.random() * 2 - 1) * 0.6 };
        this.nextSaccadeAt = this.time + 0.7 + Math.random() * 2.4;
      }
      const restful = this.mood === 'idle' || this.mood === 'standby' || this.mood === 'live';
      if (restful && !this.pointer && !this.reaction && this.time >= this.nextIdleActAt) {
        const kind = Math.random() < 0.55 ? 'glance' : 'smile';
        this.idleAct = { kind, until: this.time + 1.3, dir: Math.random() < 0.5 ? -1 : 1 };
        if (kind === 'smile') this.hop(35);
        this.nextIdleActAt = this.time + 6 + Math.random() * 7;
      }
    }
    const blinkT = (this.time - this.blinkStartedAt) / 0.16;
    const blink = animated && blinkT >= 0 && blinkT <= 1 ? Math.sin(blinkT * Math.PI) : 0;

    // Resolve the pose for this frame, then hand targets to the springs.
    let gazeX = pose.gazeX + this.saccade.x * pose.wander;
    let gazeY = pose.gazeY + this.saccade.y * pose.wander;
    let tilt = pose.tilt;
    let lean = pose.lean;
    let eyeSmile = pose.eyeSmile;
    let eyeSize = pose.eyeSize;
    let eyeOpen = pose.eyeOpen;
    let chevron = pose.chevronEyes ? 1 : 0;
    let dizzy = 0;
    let hands: HandPose = pose.hands;

    if (this.pointer && this.mood !== 'sleeping') {
      const head = this.headWorld();
      gazeX = clamp((this.pointer.x - head.x) / 55, -1, 1);
      gazeY = clamp((this.pointer.y - head.y) / 45, -1, 1);
      lean += gazeX * 3;
      tilt += gazeX * 0.05;
    }
    if (this.idleAct?.kind === 'glance') gazeX = this.idleAct.dir * 0.95;
    if (this.idleAct?.kind === 'smile') eyeSmile = Math.max(eyeSmile, 0.9);

    switch (this.reaction?.kind) {
      case 'celebrate':
        eyeSmile = 1;
        hands = [-50, -32, 50, -32];
        break;
      case 'poke':
        eyeSmile = 1;
        eyeOpen = Math.max(eyeOpen, 0.9);
        break;
      case 'dizzy':
        dizzy = 1;
        chevron = 0;
        eyeOpen = 1;
        tilt += Math.sin(this.time * 5) * 0.14;
        break;
      case 'notice':
        eyeSize *= 1.16;
        eyeOpen = Math.max(eyeOpen, 1);
        hands = [hands[0], hands[1], 55, -20];
        break;
      default:
        break;
    }
    if (this.grabbed) {
      eyeSize *= 1.18;
      eyeOpen = 1;
      eyeSmile = 0.35;
      chevron = 0;
      hands = [-46, -28, 46, -28];
    }
    if (this.mood === 'listening') {
      eyeSize *= 1 + this.energy * 0.14;
      tilt += Math.sin(this.time * 3.1) * 0.05 * this.energy;
    }

    s.gazeX.target = gazeX;
    s.gazeY.target = gazeY;
    s.tilt.target = tilt;
    s.lean.target = lean;
    s.lift.target = pose.lift;
    s.eyeOpen.target = eyeOpen * (1 - blink);
    s.eyeSize.target = eyeSize;
    s.eyeSmile.target = eyeSmile;
    s.eyeLid.target = pose.eyeLid;
    s.eyeSlant.target = pose.eyeSlant;
    s.eyeRaise.target = pose.eyeRaise;
    s.chevron.target = chevron;
    s.dizzy.target = dizzy;
    s.glow.target = pose.glow + this.energy * 0.35 + this.speech * 0.15;
    s.bob.target = animated ? pose.bob : 0;
    s.tempo.target = pose.tempo;
    s.handJitter.target = animated ? (this.grabbed ? 0.7 : pose.handJitter) : 0;
    s.handLX.target = hands[0];
    s.handLY.target = hands[1];
    s.handRX.target = hands[2];
    s.handRY.target = hands[3];
    s.mouthMix.target = 1;
    s.squash.target = animated ? 1 + Math.sin(this.bobPhase * 2) * 0.012 : 1;
    s.antenna.target = animated ? -s.tilt.v * 0.12 - s.lean.v * 0.02 : 0;
    s.tally.target =
      pose.tallyBlink > 0 && animated
        ? 0.25 + 0.75 * smoothstep(-0.35, 0.35, Math.sin(this.time * Math.PI * 2 * pose.tallyBlink))
        : 1;
    this.aura.set(pose.aura);
    this.eye.set(pose.eye);
    this.tallyColor.set(pose.tally);
    for (const [key, spring] of this.fx) {
      // The no-signal mark carries meaning, so it stays visible under reduced motion.
      spring.target = pose.fx === key && (animated || key === 'offline') ? 1 : 0;
    }

    // Substep the springs so slow frames stay stable.
    const steps = Math.ceil(dt / (1 / 120));
    const step = dt / Math.max(1, steps);
    for (let i = 0; i < steps; i += 1) {
      for (const spring of Object.values(s)) spring.step(step);
      for (const spring of this.fx.values()) spring.step(step);
      for (const color of [this.aura, this.eye, this.tallyColor]) {
        for (const channel of color.channels) channel.step(step);
      }
    }
    if (animated) this.bobPhase += dt * s.tempo.x * Math.PI * 1.1;

    this.glitchOffset =
      (this.fx.get('glitch')?.x ?? 0) > 0.3 && Math.random() < 0.09
        ? (Math.random() < 0.5 ? -1 : 1) * (1 + Math.random() * 2.5)
        : 0;

    if (animated) this.updateParticles(dt);
  }

  private updateParticles(dt: number): void {
    const head = this.headWorld();
    const thought = this.fx.get('thought')?.x ?? 0;
    const sleep = this.fx.get('sleep')?.x ?? 0;
    const happy = this.mood === 'happy' || this.reaction?.kind === 'celebrate' ? 1 : 0;

    if (Math.random() < thought * 1.1 * dt) {
      this.spawn({
        kind: 'bubble',
        x: head.x + 28 + Math.random() * 10,
        y: head.y - 30,
        vx: 6 + Math.random() * 6,
        vy: -16 - Math.random() * 8,
        life: 0,
        ttl: 1.6,
        size: 1.4 + Math.random() * 1.8,
        spin: 0,
        rgb: POSES[this.mood].aura,
      });
    }
    if (Math.random() < sleep * 0.75 * dt) {
      this.spawn({
        kind: 'z',
        x: head.x + 24,
        y: head.y - 32,
        vx: 7,
        vy: -13,
        life: 0,
        ttl: 2.4,
        size: 7,
        spin: 0,
        rgb: hex('#cbd5e1'),
      });
    }
    if (Math.random() < happy * 4 * dt) {
      const angle = Math.random() * Math.PI * 2;
      this.spawn({
        kind: 'spark',
        x: head.x + Math.cos(angle) * 54,
        y: head.y + Math.sin(angle) * 40,
        vx: 0,
        vy: -12,
        life: 0,
        ttl: 0.9,
        size: 2.4 + Math.random() * 1.6,
        spin: 3,
        rgb: CONFETTI[Math.floor(Math.random() * CONFETTI.length)] ?? BASE.aura,
      });
    }

    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const p = this.particles[i];
      if (!p) continue;
      p.life += dt;
      if (p.life >= p.ttl) {
        this.particles.splice(i, 1);
        continue;
      }
      if (p.kind === 'spark') {
        p.vy += 150 * dt;
        p.vx *= Math.exp(-dt * 1.5);
      } else if (p.kind === 'z') {
        p.size += dt * 2.4;
        p.vx = 7 + Math.sin(p.life * 3) * 6;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  // ─── rendering ───────────────────────────────────────────────────────────

  private draw(): void {
    const ctx = this.ctx;
    const { scale, offsetX } = this.layout();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(scale * this.dpr, 0, 0, scale * this.dpr, offsetX * scale * this.dpr, 0);

    const s = this.springs;
    const head = this.headWorld();
    const stretch = clamp(s.squash.x + clamp(-s.lift.v * 0.0011, -0.09, 0.11), 0.75, 1.3);
    const pulse = this.energy * 0.07 + this.speech * 0.02;
    const sx = (1 + pulse) / Math.sqrt(stretch);
    const sy = (1 + pulse) * stretch;
    const tilt = s.tilt.x;

    this.updateBulb(head, tilt, sx, sy);
    this.drawAura(head);
    this.drawFloor(head);
    this.drawFxBehind(head);

    ctx.save();
    ctx.translate(head.x, head.y);
    ctx.rotate(tilt);
    ctx.scale(sx, sy);
    this.drawAntenna();
    this.drawShell();
    this.drawVisor();
    ctx.restore();

    this.drawHands(head);
    this.drawFxFront(head);
    this.drawParticles();
  }

  private updateBulb(head: { x: number; y: number }, tilt: number, sx: number, sy: number): void {
    const angle = this.springs.antenna.x + Math.sin(this.time * 1.3) * (this.reducedMotion ? 0 : 0.05);
    const tipX = Math.sin(angle) * ANTENNA_LENGTH * sx;
    const tipY = (-HEAD_B + 3) * sy - Math.cos(angle) * ANTENNA_LENGTH;
    this.bulb = {
      x: head.x + tipX * Math.cos(tilt) - tipY * Math.sin(tilt),
      y: head.y + tipX * Math.sin(tilt) + tipY * Math.cos(tilt),
    };
  }

  private drawAura(head: { x: number; y: number }): void {
    const ctx = this.ctx;
    const glow = this.springs.glow.x;
    const gradient = ctx.createRadialGradient(head.x, head.y, 8, head.x, head.y, 84);
    gradient.addColorStop(0, this.aura.rgba(glow * 0.42));
    gradient.addColorStop(0.55, this.aura.rgba(glow * 0.12));
    gradient.addColorStop(1, this.aura.rgba(0));
    ctx.fillStyle = gradient;
    ctx.fillRect(head.x - 90, head.y - 90, 180, 180);
  }

  private drawFloor(head: { x: number; y: number }): void {
    const ctx = this.ctx;
    const height = clamp(1 - (HEAD_Y - head.y) * 0.012, 0.5, 1.2);
    ctx.save();
    ctx.translate(head.x, GROUND_Y);
    ctx.scale(1, 0.24);
    const radius = 42 * height;
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    gradient.addColorStop(0, this.aura.rgba(this.springs.glow.x * 0.5 * height));
    gradient.addColorStop(1, this.aura.rgba(0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private headPath(): Path2D {
    const path = new Path2D();
    const wobble = this.reducedMotion
      ? 0
      : 0.01 + this.energy * 0.035 + this.speech * 0.018 + (this.fx.get('glitch')?.x ?? 0) * 0.01;
    const points = 64;
    for (let i = 0; i <= points; i += 1) {
      const theta = (i / points) * Math.PI * 2;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const ripple =
        1 +
        wobble *
          (Math.sin(theta * 3 + this.time * 2.3) * 0.6 + Math.sin(theta * 5 - this.time * 3.4) * 0.4);
      const x = HEAD_A * Math.sign(cos) * Math.abs(cos) ** (2 / 3.1) * ripple;
      const y = HEAD_B * Math.sign(sin) * Math.abs(sin) ** (2 / 3.1) * ripple;
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    path.closePath();
    return path;
  }

  private drawAntenna(): void {
    const ctx = this.ctx;
    const angle = this.springs.antenna.x + Math.sin(this.time * 1.3) * (this.reducedMotion ? 0 : 0.05);
    const baseY = -HEAD_B + 3;
    const tipX = Math.sin(angle) * ANTENNA_LENGTH;
    const tipY = baseY - Math.cos(angle) * ANTENNA_LENGTH;
    ctx.strokeStyle = 'rgba(148,163,184,0.55)';
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    ctx.quadraticCurveTo(0, baseY - ANTENNA_LENGTH * 0.55, tipX, tipY);
    ctx.stroke();

    const level = this.springs.tally.x;
    const halo = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, 13);
    halo.addColorStop(0, this.tallyColor.rgba(0.75 * level));
    halo.addColorStop(1, this.tallyColor.rgba(0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(tipX, tipY, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = this.tallyColor.rgba(0.35 + 0.65 * level, 0.25 * level);
    ctx.beginPath();
    ctx.arc(tipX, tipY, 3.6, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawShell(): void {
    const ctx = this.ctx;
    const path = this.headPath();

    const body = ctx.createLinearGradient(0, -HEAD_B, 0, HEAD_B);
    body.addColorStop(0, '#262d42');
    body.addColorStop(0.5, '#0e1320');
    body.addColorStop(1, '#05070c');
    ctx.fillStyle = body;
    ctx.fill(path);

    const underglow = ctx.createRadialGradient(0, HEAD_B, 4, 0, HEAD_B, HEAD_B * 1.6);
    underglow.addColorStop(0, this.aura.rgba(0.32 * this.springs.glow.x));
    underglow.addColorStop(1, this.aura.rgba(0));
    ctx.fillStyle = underglow;
    ctx.fill(path);

    const rim = ctx.createLinearGradient(-HEAD_A, -HEAD_B, HEAD_A, HEAD_B);
    rim.addColorStop(0, this.aura.rgba(0.95, 0.2));
    rim.addColorStop(0.5, this.aura.rgba(0.18));
    rim.addColorStop(1, this.aura.rgba(0.6));
    ctx.strokeStyle = rim;
    ctx.lineWidth = 1.6;
    ctx.stroke(path);

    ctx.fillStyle = 'rgba(255,255,255,0.075)';
    ctx.beginPath();
    ctx.ellipse(-12, -HEAD_B + 10, 20, 6.5, -0.22, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawVisor(): void {
    const ctx = this.ctx;
    const width = COLS * PITCH + 7;
    const height = ROWS * PITCH + 7;
    const left = -width / 2;
    const top = VISOR_CY - height / 2;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(left, top, width, height, 14);
    ctx.fillStyle = '#020409';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.clip();

    this.paintMatrix();
    const data = this.matrix.getImageData(0, 0, COLS, ROWS).data;
    const originX = -(COLS * PITCH) / 2 + this.glitchOffset;
    const originY = VISOR_CY - (ROWS * PITCH) / 2;

    // Unlit LED grid gives the visor its texture.
    ctx.fillStyle = this.eye.rgba(0.07);
    ctx.beginPath();
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const x = originX + (col + 0.5) * PITCH;
        const y = originY + (row + 0.5) * PITCH;
        ctx.moveTo(x + PITCH * 0.3, y);
        ctx.arc(x, y, PITCH * 0.3, 0, Math.PI * 2);
      }
    }
    ctx.fill();

    const lit: Array<readonly [number, number, number]> = [];
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const alpha = (data[(row * COLS + col) * 4 + 3] ?? 0) / 255;
        if (alpha < 0.05) continue;
        lit.push([originX + (col + 0.5) * PITCH, originY + (row + 0.5) * PITCH, alpha]);
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = this.eye.rgba(1);
    for (const [x, y, alpha] of lit) {
      ctx.globalAlpha = alpha * 0.2;
      ctx.beginPath();
      ctx.arc(x, y, PITCH * 1.05, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = this.eye.rgba(1, 0.45);
    for (const [x, y, alpha] of lit) {
      ctx.globalAlpha = Math.min(1, alpha * 1.2);
      ctx.beginPath();
      ctx.arc(x, y, PITCH * 0.36, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (this.glitchOffset !== 0) {
      ctx.fillStyle = 'rgba(255,77,94,0.22)';
      ctx.fillRect(left, originY + Math.random() * ROWS * PITCH, width, PITCH * 1.4);
    }

    const glass = ctx.createLinearGradient(left, top, left + width * 0.6, top + height);
    glass.addColorStop(0, 'rgba(255,255,255,0.09)');
    glass.addColorStop(0.45, 'rgba(255,255,255,0.015)');
    glass.addColorStop(0.46, 'rgba(255,255,255,0)');
    ctx.fillStyle = glass;
    ctx.fillRect(left, top, width, height);
    ctx.restore();
  }

  /** Paints the face into the low-res matrix; alpha becomes LED brightness. */
  private paintMatrix(): void {
    const m = this.matrix;
    const s = this.springs;
    m.clearRect(0, 0, COLS, ROWS);
    m.fillStyle = '#fff';
    m.strokeStyle = '#fff';
    m.lineCap = 'round';
    m.lineJoin = 'round';

    const chevron = clamp(s.chevron.x, 0, 1);
    const dizzy = clamp(s.dizzy.x, 0, 1);
    const round = clamp(1 - chevron - dizzy, 0, 1);
    for (const side of [-1, 1] as const) {
      const cx = COLS / 2 + side * 5.3 + s.gazeX.x * 2.2;
      const cy = 5.3 + s.gazeY.x * 1.5 - (side === 1 ? s.eyeRaise.x * 0.9 : 0);
      if (round > 0.01) this.paintRoundEye(cx, cy, side, round);
      if (chevron > 0.01) {
        const dir = -side;
        m.globalAlpha = chevron;
        m.lineWidth = 1.15;
        m.beginPath();
        m.moveTo(cx - dir * 1.7, cy - 2.3);
        m.lineTo(cx + dir * 1.7, cy);
        m.lineTo(cx - dir * 1.7, cy + 2.3);
        m.stroke();
      }
      if (dizzy > 0.01) {
        m.globalAlpha = dizzy;
        // A true spiral smears at LED resolution; a spinning X reads as dizzy.
        m.lineWidth = 1.1;
        m.save();
        m.translate(cx, cy);
        m.rotate(this.time * 6 * side);
        m.beginPath();
        m.moveTo(-2.1, -2.1);
        m.lineTo(2.1, 2.1);
        m.moveTo(2.1, -2.1);
        m.lineTo(-2.1, 2.1);
        m.stroke();
        m.restore();
      }
      m.globalAlpha = 1;
    }

    const mix = clamp(s.mouthMix.x, 0, 1);
    if (mix < 0.99) this.paintMouth(this.previousMouth, 1 - mix);
    this.paintMouth(this.mouth, mix);
  }

  private paintRoundEye(cx: number, cy: number, side: -1 | 1, alpha: number): void {
    const m = this.matrix;
    const s = this.springs;
    const size = s.eyeSize.x;
    const open = clamp(s.eyeOpen.x, 0, 1.2);
    const rx = 2.5 * size;
    const ry = Math.max(0.55, 3.3 * size * open);

    m.globalCompositeOperation = 'source-over';
    m.globalAlpha = alpha;
    m.beginPath();
    m.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    m.fill();

    m.globalCompositeOperation = 'destination-out';
    m.globalAlpha = 1;
    const smile = clamp(s.eyeSmile.x, 0, 1);
    if (smile > 0.02 && ry > 1) {
      m.beginPath();
      m.ellipse(cx, cy + ry * (1 + (1 - smile) * 2.6), rx * 1.5, ry * 1.25, 0, 0, Math.PI * 2);
      m.fill();
    }
    const slant = s.eyeSlant.x;
    const lid = clamp(s.eyeLid.x, 0, 1);
    if ((lid > 0.01 || Math.abs(slant) > 0.01) && ry > 1) {
      m.save();
      m.translate(cx, cy);
      m.rotate(-side * slant * 0.55);
      const lidLine = -ry + 2 * ry * lid + Math.abs(slant) * ry * 0.35;
      m.fillRect(-rx * 2, -ry * 3 - 1, rx * 4, lidLine + ry * 3 + 1);
      m.restore();
    }
    m.globalCompositeOperation = 'source-over';
  }

  private paintMouth(kind: Mouth, alpha: number): void {
    if (kind === 'none' || alpha < 0.01) return;
    const m = this.matrix;
    const cx = COLS / 2;
    const cy = 10.9;
    m.globalAlpha = alpha;
    m.lineWidth = 1;
    m.beginPath();
    switch (kind) {
      case 'smile':
        m.arc(cx, cy - 1.8, 2.5, Math.PI * 0.2, Math.PI * 0.8);
        m.stroke();
        break;
      case 'frown':
        m.arc(cx, cy + 2.3, 2.3, Math.PI * 1.2, Math.PI * 1.8);
        m.stroke();
        break;
      case 'flat':
        m.moveTo(cx - 2, cy);
        m.lineTo(cx + 2, cy);
        m.stroke();
        break;
      case 'o':
        m.lineWidth = 0.9;
        m.ellipse(cx, cy, 1.25, 1.1, 0, 0, Math.PI * 2);
        m.stroke();
        break;
      case 'dots':
        for (let i = 0; i < 3; i += 1) {
          const bounce = this.reducedMotion ? 0 : Math.max(0, Math.sin(this.time * 7 - i * 0.9)) * 1;
          m.moveTo(cx + (i - 1) * 2.5 + 0.7, cy - bounce);
          m.arc(cx + (i - 1) * 2.5, cy - bounce, 0.7, 0, Math.PI * 2);
        }
        m.fill();
        break;
      case 'voice':
      case 'meter':
        for (let i = 0; i < 10; i += 1) {
          const taper = Math.sin((Math.PI * (i + 0.5)) / 10) ** 0.6;
          const level =
            kind === 'voice'
              ? this.speech *
                (0.35 + 0.65 * Math.abs(Math.sin(i * 1.7 + this.time * 13 + Math.sin(this.time * 5 + i))))
              : clamp(
                  (this.meter[i] ?? 0) * (0.8 + 0.3 * Math.sin(i * 2.3 + this.time * 17)),
                  0,
                  1,
                );
          const half = 0.35 + level * taper * 1.9;
          m.rect(cx - 5 + i + 0.05, cy - half, 0.9, half * 2);
        }
        m.fill();
        break;
    }
    m.globalAlpha = 1;
  }

  private drawHands(head: { x: number; y: number }): void {
    const ctx = this.ctx;
    const s = this.springs;
    const t = this.reducedMotion ? 0 : this.time;
    const jitter = s.handJitter.x;
    const float = s.bob.x / 2.2;
    const asking = this.mood === 'asking' ? 1 : 0;
    const waving = this.reaction?.kind === 'notice' ? 1 : 0;

    for (const side of [-1, 1] as const) {
      const phase = side === 1 ? 0 : Math.PI;
      let x = side === 1 ? s.handRX.x : s.handLX.x;
      let y = side === 1 ? s.handRY.x : s.handLY.x;
      x += Math.sin(t * 1.7 + phase) * 1.5 * float;
      y += Math.cos(t * 1.3 + phase) * 2.6 * float;
      y -= Math.abs(Math.sin(t * 15 + phase * 0.5)) * 4 * jitter;
      x += Math.cos(t * 3 + phase) * 3.5 * this.speech;
      y += Math.sin(t * 4.2 + phase) * 5 * this.speech;
      if (side === 1) x += Math.sin(t * (6 + waving * 8)) * (2.5 * asking + 5 * waving);
      if (this.mood === 'listening') x -= side * this.energy * 4;

      const hx = head.x + x;
      const hy = head.y + y * 0.92 - this.springs.lift.x * 0.25;
      const shading = ctx.createRadialGradient(hx - 3, hy - 3, 1, hx, hy, HAND_R);
      shading.addColorStop(0, '#323a52');
      shading.addColorStop(1, '#070a11');
      ctx.fillStyle = shading;
      ctx.beginPath();
      ctx.arc(hx, hy, HAND_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = this.aura.rgba(0.65, 0.15);
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.beginPath();
      ctx.ellipse(hx - 2.4, hy - 3.4, 3.6, 1.8, -0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private fxWeight(key: Fx): number {
    return clamp(this.fx.get(key)?.x ?? 0, 0, 1);
  }

  private drawFxBehind(head: { x: number; y: number }): void {
    const ctx = this.ctx;
    const sparks = this.fxWeight('sparks');
    const thought = this.fxWeight('thought');
    // Back half of the orbits passes behind the head.
    if (sparks > 0.01) this.drawOrbitSparks(head, sparks, false);
    if (thought > 0.01) this.drawOrbitDots(head, thought, false);

    const ask = this.fxWeight('ask');
    if (ask > 0.01) {
      ctx.save();
      ctx.strokeStyle = this.aura.rgba(0.55 * ask);
      ctx.lineWidth = 1.3;
      ctx.setLineDash([3, 5]);
      ctx.lineDashOffset = -this.time * 12;
      ctx.beginPath();
      ctx.arc(head.x, head.y, 60 + Math.sin(this.time * 3) * 2.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawFxFront(head: { x: number; y: number }): void {
    const ctx = this.ctx;
    const sparks = this.fxWeight('sparks');
    const thought = this.fxWeight('thought');
    if (sparks > 0.01) this.drawOrbitSparks(head, sparks, true);
    if (thought > 0.01) this.drawOrbitDots(head, thought, true);

    ctx.lineCap = 'round';
    const listen = this.fxWeight('listen');
    const speak = this.fxWeight('speak');
    for (let i = 0; i < 3; i += 1) {
      if (listen > 0.01) {
        const p = (this.time * 0.85 + i / 3) % 1;
        const alpha = listen * Math.sin(p * Math.PI) * (0.25 + this.energy * 0.9);
        this.drawSideArcs(head, 88 - p * 42, alpha);
      }
      if (speak > 0.01) {
        const p = (this.time * 1.1 + i / 3) % 1;
        const alpha = speak * (1 - p) * (0.15 + this.speech * 0.85);
        this.drawSideArcs(head, 50 + p * 38, alpha);
      }
    }

    const offline = this.fxWeight('offline');
    if (offline > 0.01) this.drawNoSignal(offline);

    const broadcast = this.fxWeight('broadcast');
    if (broadcast > 0.01) {
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 2; i += 1) {
        const p = (this.time * 0.7 + i / 2) % 1;
        ctx.strokeStyle = this.tallyColor.rgba(broadcast * (1 - p) * 0.8);
        ctx.beginPath();
        ctx.arc(this.bulb.x, this.bulb.y, 5 + p * 24, -Math.PI * 0.85, -Math.PI * 0.15);
        ctx.stroke();
      }
    }
  }

  /** Signal arcs beside the antenna with a slash through them. */
  private drawNoSignal(weight: number): void {
    const ctx = this.ctx;
    const x = this.bulb.x + 15;
    const y = this.bulb.y + 6;
    const pulse = this.reducedMotion ? 1 : 0.7 + 0.3 * Math.sin(this.time * 2.2);
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = this.aura.rgba(weight * 0.9, 0.35);
    for (const radius of [2.5, 5.5, 8.5]) {
      ctx.beginPath();
      ctx.arc(x, y, radius, -Math.PI * 0.78, -Math.PI * 0.22);
      ctx.stroke();
    }
    ctx.lineWidth = 1.7;
    ctx.strokeStyle = `rgba(255,107,120,${(weight * pulse).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(x - 7, y - 10);
    ctx.lineTo(x + 7, y + 1);
    ctx.stroke();
  }

  private drawSideArcs(head: { x: number; y: number }, radius: number, alpha: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = this.aura.rgba(alpha);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(head.x, head.y, radius, -0.5, 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(head.x, head.y, radius, Math.PI - 0.5, Math.PI + 0.5);
    ctx.stroke();
  }

  private drawOrbitDots(head: { x: number; y: number }, weight: number, front: boolean): void {
    const ctx = this.ctx;
    for (let i = 0; i < 3; i += 1) {
      const angle = this.time * 1.8 + (i * Math.PI * 2) / 3;
      const depth = Math.sin(angle);
      if ((depth >= 0) !== front) continue;
      ctx.fillStyle = this.aura.rgba(weight * (0.45 + 0.45 * (depth + 1) * 0.5), 0.3);
      ctx.beginPath();
      const radius = 1.6 + (depth + 1) * 0.9;
      ctx.arc(head.x + Math.cos(angle) * 58, head.y - 8 + depth * 13, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawOrbitSparks(head: { x: number; y: number }, weight: number, front: boolean): void {
    const ctx = this.ctx;
    ctx.lineWidth = 1.7;
    ctx.lineCap = 'round';
    for (let i = 0; i < 7; i += 1) {
      const angle = this.time * 3.4 + (i * Math.PI * 2) / 7;
      const depth = Math.sin(angle);
      if ((depth >= 0) !== front) continue;
      const point = (a: number) => ({
        x: head.x + Math.cos(a) * 62,
        y: head.y + 6 + Math.sin(a) * 15 - Math.cos(a) * 8,
      });
      const from = point(angle);
      const to = point(angle + 0.22);
      ctx.strokeStyle = this.aura.rgba(weight * (0.35 + 0.55 * (depth + 1) * 0.5), 0.35);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
  }

  private drawParticles(): void {
    const ctx = this.ctx;
    for (const p of this.particles) {
      const fade = 1 - p.life / p.ttl;
      if (p.kind === 'spark') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin * p.life);
        ctx.fillStyle = rgbString(p.rgb, fade);
        ctx.beginPath();
        for (let k = 0; k < 8; k += 1) {
          const radius = k % 2 === 0 ? p.size : p.size * 0.32;
          const angle = (k * Math.PI) / 4;
          ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (p.kind === 'bubble') {
        ctx.strokeStyle = rgbString(p.rgb, fade * 0.7);
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size + p.life * 1.4, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = rgbString(p.rgb, Math.sin(fade * Math.PI) * 0.85);
        ctx.font = `700 ${p.size.toFixed(1)}px Inter, ui-sans-serif, system-ui, sans-serif`;
        ctx.fillText('z', p.x, p.y);
      }
    }
  }
}
