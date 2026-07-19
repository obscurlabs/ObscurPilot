import {
  LiveSessionReliabilitySchema,
  type LiveSessionReliability,
} from '@obscurpilot/contracts/live-session';

interface Outcome {
  readonly ok: boolean;
  readonly durationMs: number;
}

export class ReliabilityTracker {
  private readonly outcomes: Outcome[] = [];
  private recoveries = 0;
  private duplicatesPrevented = 0;

  public constructor(private readonly capacity = 10_000) {
    if (!Number.isInteger(capacity) || capacity < 10 || capacity > 100_000) {
      throw new RangeError('Reliability capacity must be between 10 and 100000');
    }
  }

  public record(ok: boolean, durationMs: number): void {
    this.outcomes.push({ ok, durationMs: Math.max(0, Math.round(durationMs)) });
    if (this.outcomes.length > this.capacity) this.outcomes.shift();
  }

  public recordRecovery(): void {
    this.recoveries += 1;
  }

  public recordDuplicatePrevented(): void {
    this.duplicatesPrevented += 1;
  }

  public snapshot(): LiveSessionReliability {
    const durations = this.outcomes.map((outcome) => outcome.durationMs).sort((a, b) => a - b);
    const verified = this.outcomes.reduce((total, outcome) => total + Number(outcome.ok), 0);
    const operations = this.outcomes.length;
    return LiveSessionReliabilitySchema.parse({
      operations,
      verified,
      failed: operations - verified,
      recoveries: this.recoveries,
      duplicatesPrevented: this.duplicatesPrevented,
      successRate: operations === 0 ? 1 : verified / operations,
      p50LatencyMs: percentile(durations, 0.5),
      p95LatencyMs: percentile(durations, 0.95),
    });
  }
}

function percentile(sorted: readonly number[], quantile: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index] ?? 0;
}
