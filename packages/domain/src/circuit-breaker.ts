export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  readonly failureThreshold: number;
  readonly failureWindowMs: number;
  readonly openDurationMs: number;
  readonly successfulProbesToClose: number;
}

export const DEFAULT_CIRCUIT_BREAKER_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  failureWindowMs: 30_000,
  openDurationMs: 20_000,
  successfulProbesToClose: 2,
};

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures: number[] = [];
  private openedAt = 0;
  private successfulProbes = 0;

  public constructor(
    private readonly options: CircuitBreakerOptions = DEFAULT_CIRCUIT_BREAKER_OPTIONS,
  ) {}

  public snapshot(): CircuitState {
    return this.state;
  }

  public canExecute(now: number): boolean {
    if (this.state === 'open' && now - this.openedAt >= this.options.openDurationMs) {
      this.state = 'half_open';
      this.successfulProbes = 0;
    }
    return this.state !== 'open';
  }

  public recordFailure(now: number): void {
    if (this.state === 'half_open') {
      this.open(now);
      return;
    }
    this.failures = this.failures.filter(
      (timestamp) => now - timestamp <= this.options.failureWindowMs,
    );
    this.failures.push(now);
    if (this.failures.length >= this.options.failureThreshold) {
      this.open(now);
    }
  }

  public recordSuccess(): void {
    if (this.state !== 'half_open') {
      return;
    }
    this.successfulProbes += 1;
    if (this.successfulProbes >= this.options.successfulProbesToClose) {
      this.state = 'closed';
      this.failures = [];
      this.successfulProbes = 0;
    }
  }

  private open(now: number): void {
    this.state = 'open';
    this.openedAt = now;
    this.successfulProbes = 0;
  }
}
