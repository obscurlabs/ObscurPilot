import type { EncodedAudioClip } from '@obscurpilot/domain/audio-pipeline';

interface PendingTurn {
  readonly clip: EncodedAudioClip;
  timer: ReturnType<typeof setTimeout>;
  turnId?: number;
}

interface RealtimeTurn {
  readonly id: number;
  state: 'heard' | 'committed' | 'fallback';
  consumed: boolean;
  expiresAt: number;
}

export interface HandsFreeTurnFallbackOptions {
  readonly onFallback: (clip: EncodedAudioClip) => Promise<void> | void;
  readonly graceMs?: number;
  readonly progressGraceMs?: number;
  readonly turnTtlMs?: number;
  readonly now?: () => number;
}

/**
 * Keeps one bounded local copy of each hands-free utterance while the realtime
 * provider decides whether it owns the turn. Hearing a transcript is only
 * progress; ownership is committed only by an assistant response or tool
 * start. Otherwise the clip reaches Groq so push-to-talk is never required.
 */
export class HandsFreeTurnFallback {
  private readonly pending: PendingTurn[] = [];
  private readonly graceMs: number;
  private readonly progressGraceMs: number;
  private readonly turnTtlMs: number;
  private readonly now: () => number;
  private currentTurn: RealtimeTurn | undefined;
  private nextTurnId = 0;
  private disposed = false;

  public constructor(private readonly options: HandsFreeTurnFallbackOptions) {
    this.graceMs = options.graceMs ?? 2_500;
    this.progressGraceMs = options.progressGraceMs ?? 4_000;
    this.turnTtlMs = options.turnTtlMs ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  public enqueue(clip: EncodedAudioClip): void {
    if (this.disposed) return zeroClip(clip);
    this.pruneTurn();
    const turn = this.availableTurn();
    if (turn?.state === 'committed') {
      turn.consumed = true;
      zeroClip(clip);
      return;
    }
    const pending: PendingTurn = {
      clip,
      timer: undefined as unknown as ReturnType<typeof setTimeout>,
      ...(turn?.state === 'heard' ? { turnId: turn.id } : {}),
    };
    this.armFallback(pending, turn?.state === 'heard' ? this.progressGraceMs : this.graceMs);
    this.pending.push(pending);
  }

  public beginRealtimeTurn(): void {
    if (this.disposed) return;
    this.pruneTurn();
    const turn: RealtimeTurn = {
      id: ++this.nextTurnId,
      state: 'heard',
      consumed: false,
      expiresAt: this.now() + this.turnTtlMs,
    };
    this.currentTurn = turn;
    const pending = this.pending.find((candidate) => candidate.turnId === undefined);
    if (pending !== undefined) {
      pending.turnId = turn.id;
      this.armFallback(pending, this.progressGraceMs);
    }
  }

  public commitRealtimeTurn(): void {
    if (this.disposed) return;
    this.pruneTurn();
    const turn =
      this.currentTurn ??
      ({
        id: ++this.nextTurnId,
        state: 'heard',
        consumed: false,
        expiresAt: this.now() + this.turnTtlMs,
      } satisfies RealtimeTurn);
    this.currentTurn = turn;
    if (turn.state === 'committed' || turn.state === 'fallback') return;
    turn.state = 'committed';
    turn.expiresAt = this.now() + this.turnTtlMs;
    const pending = this.pending.find(
      (candidate) => candidate.turnId === turn.id || candidate.turnId === undefined,
    );
    if (pending === undefined) return;
    this.removePending(pending);
    turn.consumed = true;
    zeroClip(pending.clip);
  }

  public acceptsRealtimeOutput(): boolean {
    this.pruneTurn();
    return this.currentTurn?.state !== 'fallback';
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const pending of this.pending.splice(0)) {
      clearTimeout(pending.timer);
      zeroClip(pending.clip);
    }
    this.currentTurn = undefined;
  }

  private fallback(pending: PendingTurn): void {
    const index = this.pending.indexOf(pending);
    if (index < 0) return;
    this.pending.splice(index, 1);
    if (this.disposed) return zeroClip(pending.clip);
    const turn = this.currentTurn;
    if (pending.turnId !== undefined && turn?.id === pending.turnId) {
      turn.state = 'fallback';
      turn.consumed = true;
      turn.expiresAt = this.now() + this.turnTtlMs;
    }
    void Promise.resolve(this.options.onFallback(pending.clip)).catch(() => zeroClip(pending.clip));
  }

  private availableTurn(): RealtimeTurn | undefined {
    const turn = this.currentTurn;
    if (turn === undefined || turn.state === 'fallback' || turn.consumed) return undefined;
    return turn;
  }

  private armFallback(pending: PendingTurn, delayMs: number): void {
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => this.fallback(pending), delayMs);
    pending.timer.unref?.();
  }

  private removePending(pending: PendingTurn): void {
    const index = this.pending.indexOf(pending);
    if (index >= 0) this.pending.splice(index, 1);
    clearTimeout(pending.timer);
  }

  private pruneTurn(): void {
    if (this.currentTurn !== undefined && this.currentTurn.expiresAt <= this.now()) {
      this.currentTurn = undefined;
    }
  }
}

function zeroClip(clip: EncodedAudioClip): void {
  clip.bytes.fill(0);
}
