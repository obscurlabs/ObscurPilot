import { CircuitBreaker } from '@obscurpilot/domain/circuit-breaker';
import { computeFullJitterDelay, sleepWithSignal } from '@obscurpilot/domain/retry';
import { GroqAdapterError, translateGroqError } from './errors.js';

export interface GroqResilienceOptions {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly random?: () => number;
  readonly now?: () => number;
  readonly circuitBreaker?: CircuitBreaker;
}

export class GroqResiliencePolicy {
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly circuit: CircuitBreaker;

  public constructor(options: GroqResilienceOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 200;
    this.maxDelayMs = options.maxDelayMs ?? 2_000;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.circuit = options.circuitBreaker ?? new CircuitBreaker();
  }

  public async execute<T>(
    operation: (attempt: number) => Promise<T>,
    signal: AbortSignal,
  ): Promise<{
    readonly value: T;
    readonly attempts: number;
  }> {
    if (!this.circuit.canExecute(this.now())) {
      throw new GroqAdapterError('CIRCUIT_OPEN', 'Groq circuit is temporarily open');
    }
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      if (signal.aborted) throw new GroqAdapterError('CANCELLED', 'Groq operation was cancelled');
      try {
        const value = await operation(attempt);
        this.circuit.recordSuccess();
        return { value, attempts: attempt };
      } catch (error: unknown) {
        const fault = translateGroqError(error, signal);
        if (fault.retryable) this.circuit.recordFailure(this.now());
        if (!fault.retryable || attempt >= this.maxAttempts) throw fault;
        const delayMs = computeFullJitterDelay(attempt - 1, this.random, {
          baseDelayMs: this.baseDelayMs,
          maxDelayMs: this.maxDelayMs,
          maxAttempts: this.maxAttempts,
        });
        await sleepWithSignal(delayMs, signal);
      }
    }
    throw new GroqAdapterError('UPSTREAM_UNAVAILABLE', 'Groq operation failed');
  }

  public state(): ReturnType<CircuitBreaker['snapshot']> {
    return this.circuit.snapshot();
  }
}
