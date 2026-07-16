export interface ToolLoopLimits {
  readonly maxTurns: number;
  readonly maxToolCalls: number;
  readonly maxWallClockMs: number;
  readonly maxArgumentBytes: number;
}

export const DEFAULT_TOOL_LOOP_LIMITS: ToolLoopLimits = {
  maxTurns: 4,
  maxToolCalls: 6,
  maxWallClockMs: 15_000,
  maxArgumentBytes: 32 * 1024,
};

export class LoopLimitError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'LoopLimitError';
  }
}

export class BoundedLoopController {
  private turns = 0;
  private toolCalls = 0;
  private argumentBytes = 0;
  private readonly startedAt: number;
  private pausedAt: number | undefined;
  private pausedDurationMs = 0;

  public constructor(
    private readonly now: () => number = Date.now,
    private readonly limits: ToolLoopLimits = DEFAULT_TOOL_LOOP_LIMITS,
  ) {
    this.startedAt = now();
  }

  public beginTurn(): void {
    this.assertWithinDeadline();
    this.turns += 1;
    if (this.turns > this.limits.maxTurns) {
      throw new LoopLimitError('Model turn ceiling exceeded');
    }
  }

  public registerToolCall(argumentsValue: unknown): void {
    this.assertWithinDeadline();
    this.toolCalls += 1;
    this.argumentBytes += new TextEncoder().encode(JSON.stringify(argumentsValue)).byteLength;
    if (this.toolCalls > this.limits.maxToolCalls) {
      throw new LoopLimitError('Tool call ceiling exceeded');
    }
    if (this.argumentBytes > this.limits.maxArgumentBytes) {
      throw new LoopLimitError('Tool argument byte ceiling exceeded');
    }
  }

  public assertWithinDeadline(): void {
    const current = this.pausedAt ?? this.now();
    if (current - this.startedAt - this.pausedDurationMs > this.limits.maxWallClockMs) {
      throw new LoopLimitError('Tool loop deadline exceeded');
    }
  }

  public pauseDeadline(): void {
    if (this.pausedAt === undefined) this.pausedAt = this.now();
  }

  public resumeDeadline(): void {
    if (this.pausedAt === undefined) return;
    this.pausedDurationMs += Math.max(0, this.now() - this.pausedAt);
    this.pausedAt = undefined;
  }
}
