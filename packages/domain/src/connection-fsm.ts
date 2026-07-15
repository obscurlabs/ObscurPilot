import type {
  ConnectionPhase,
  ConnectionProjection,
  ConnectionProvider,
} from '@obscurpilot/contracts/state';

const LEGAL_TRANSITIONS: Readonly<Record<ConnectionPhase, ReadonlySet<ConnectionPhase>>> = {
  idle: new Set(['connecting', 'degraded', 'auth_required', 'stopped']),
  connecting: new Set(['authenticating', 'backoff', 'degraded', 'auth_required', 'stopped']),
  authenticating: new Set(['synchronizing', 'backoff', 'degraded', 'auth_required', 'stopped']),
  synchronizing: new Set(['ready', 'backoff', 'degraded', 'auth_required', 'stopped']),
  ready: new Set(['degraded', 'auth_required', 'stopped']),
  backoff: new Set(['connecting', 'reconnecting', 'degraded', 'auth_required', 'stopped']),
  degraded: new Set(['reconnecting', 'backoff', 'auth_required', 'stopped']),
  reconnecting: new Set([
    'authenticating',
    'synchronizing',
    'backoff',
    'degraded',
    'auth_required',
    'stopped',
  ]),
  auth_required: new Set(['connecting', 'stopped']),
  stopped: new Set(['idle']),
};

export interface TransitionMetadata {
  readonly attempt: number;
  readonly reasonCode: string;
  readonly correlationId: string;
  readonly changedAt?: string;
}

export interface ConnectionTransition extends ConnectionProjection {
  readonly previous: ConnectionPhase;
}

export function canTransition(previous: ConnectionPhase, current: ConnectionPhase): boolean {
  return LEGAL_TRANSITIONS[previous].has(current);
}

export class ConnectionStateMachine {
  private phase: ConnectionPhase;
  private projection: ConnectionProjection;

  public constructor(
    private readonly provider: ConnectionProvider,
    initial: ConnectionPhase = 'idle',
  ) {
    this.phase = initial;
    this.projection = {
      provider,
      phase: initial,
      attempt: 0,
      changedAt: new Date(0).toISOString(),
      reasonCode: 'INITIALIZED',
      correlationId: '00000000-0000-4000-8000-000000000000',
    };
  }

  public snapshot(): Readonly<ConnectionProjection> {
    return this.projection;
  }

  public transition(next: ConnectionPhase, metadata: TransitionMetadata): ConnectionTransition {
    if (!canTransition(this.phase, next)) {
      throw new Error('Illegal connection transition: ' + this.phase + ' -> ' + next);
    }
    if (!Number.isInteger(metadata.attempt) || metadata.attempt < 0) {
      throw new RangeError('attempt must be a non-negative integer');
    }
    const previous = this.phase;
    this.phase = next;
    this.projection = Object.freeze({
      provider: this.provider,
      phase: next,
      attempt: metadata.attempt,
      changedAt: metadata.changedAt ?? new Date().toISOString(),
      reasonCode: metadata.reasonCode,
      correlationId: metadata.correlationId,
    });
    return Object.freeze({ ...this.projection, previous });
  }
}
