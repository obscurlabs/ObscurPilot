import type { ConnectionPhase, ConnectionProvider } from '@obscurpilot/contracts/state';
import { ConnectionStateMachine, type ConnectionTransition } from './connection-fsm.js';
import {
  computeFullJitterDelay,
  DEFAULT_BACKOFF_POLICY,
  sleepWithSignal,
  systemClock,
  type BackoffPolicy,
  type Clock,
} from './retry.js';

export interface ConnectionDriver {
  connect(signal: AbortSignal): Promise<void>;
  authenticate(signal: AbortSignal): Promise<void>;
  synchronize(signal: AbortSignal): Promise<void>;
  disconnect(): Promise<void>;
}

export type FailureClassification = 'auth' | 'retryable' | 'terminal';

export interface ConnectionSupervisorOptions {
  readonly backoff?: BackoffPolicy;
  readonly clock?: Clock;
  readonly random?: () => number;
  readonly classifyError?: (error: unknown) => FailureClassification;
  readonly correlationId?: () => string;
  readonly onTransition?: (transition: ConnectionTransition) => void;
}

export class ConnectionSupervisor {
  private readonly machine: ConnectionStateMachine;
  private readonly backoff: BackoffPolicy;
  private readonly clock: Clock;
  private readonly random: () => number;
  private readonly classifyError: (error: unknown) => FailureClassification;
  private readonly correlationId: () => string;
  private generation = 0;
  private controller: AbortController | undefined;
  private active: Promise<void> | undefined;

  public constructor(
    provider: ConnectionProvider,
    private readonly driver: ConnectionDriver,
    private readonly options: ConnectionSupervisorOptions = {},
  ) {
    this.machine = new ConnectionStateMachine(provider);
    this.backoff = options.backoff ?? DEFAULT_BACKOFF_POLICY;
    this.clock = options.clock ?? systemClock;
    this.random = options.random ?? Math.random;
    this.classifyError = options.classifyError ?? (() => 'retryable');
    this.correlationId = options.correlationId ?? crypto.randomUUID;
  }

  public snapshot() {
    return this.machine.snapshot();
  }

  public start(): Promise<void> {
    if (this.active !== undefined) return this.active;
    if (this.machine.snapshot().phase === 'stopped') this.emit('idle', 0, 'RESTARTED');
    const generation = ++this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const run = this.run(generation, controller.signal).finally(() => {
      if (this.generation === generation) {
        this.active = undefined;
        this.controller = undefined;
      }
    });
    this.active = run;
    return run;
  }

  public async stop(): Promise<void> {
    this.generation += 1;
    this.controller?.abort(new DOMException('Connection stopped', 'AbortError'));
    try {
      await this.active;
    } catch (error: unknown) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) throw error;
    }
    await this.driver.disconnect();
    if (this.machine.snapshot().phase !== 'stopped') {
      this.emit('stopped', this.machine.snapshot().attempt, 'STOPPED');
    }
    this.active = undefined;
    this.controller = undefined;
  }

  private async run(generation: number, signal: AbortSignal): Promise<void> {
    for (let attempt = 0; attempt < this.backoff.maxAttempts; attempt += 1) {
      this.assertGeneration(generation, signal);
      this.emit('connecting', attempt, attempt === 0 ? 'CONNECT_REQUESTED' : 'RETRYING');
      try {
        await this.driver.connect(signal);
        this.assertGeneration(generation, signal);
        this.emit('authenticating', attempt, 'TRANSPORT_CONNECTED');
        await this.driver.authenticate(signal);
        this.assertGeneration(generation, signal);
        this.emit('synchronizing', attempt, 'AUTHENTICATED');
        await this.driver.synchronize(signal);
        this.assertGeneration(generation, signal);
        this.emit('ready', attempt, 'SYNCHRONIZED');
        return;
      } catch (error: unknown) {
        this.assertGeneration(generation, signal);
        const classification = this.classifyError(error);
        if (classification === 'auth') {
          this.emit('auth_required', attempt, 'AUTH_REQUIRED');
          return;
        }
        if (classification === 'terminal' || attempt + 1 >= this.backoff.maxAttempts) {
          this.emit('degraded', attempt, 'RETRY_EXHAUSTED');
          return;
        }
        this.emit('backoff', attempt, 'RETRYABLE_FAILURE');
        const delay = computeFullJitterDelay(attempt, this.random, this.backoff);
        await sleepWithSignal(delay, signal, this.clock);
      }
    }
  }

  private emit(phase: ConnectionPhase, attempt: number, reasonCode: string): void {
    const transition = this.machine.transition(phase, {
      attempt,
      reasonCode,
      correlationId: this.correlationId(),
      changedAt: new Date(this.clock.now()).toISOString(),
    });
    this.options.onTransition?.(transition);
  }

  private assertGeneration(generation: number, signal: AbortSignal): void {
    if (signal.aborted || generation !== this.generation) {
      throw signal.reason ?? new DOMException('Superseded connection attempt', 'AbortError');
    }
  }
}
