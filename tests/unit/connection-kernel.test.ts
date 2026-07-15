import { ConnectionPhaseSchema } from '@obscurpilot/contracts/state';
import { CircuitBreaker } from '@obscurpilot/domain/circuit-breaker';
import { canTransition, ConnectionStateMachine } from '@obscurpilot/domain/connection-fsm';
import {
  ConnectionSupervisor,
  type ConnectionDriver,
} from '@obscurpilot/domain/connection-supervisor';
import { computeFullJitterDelay, sleepWithSignal, type Clock } from '@obscurpilot/domain/retry';
import { describe, expect, it, vi } from 'vitest';

const correlationId = '10000000-0000-4000-8000-000000000001';

class FakeClock implements Clock {
  private nextHandle = 0;
  private readonly callbacks = new Map<number, () => void>();
  public time = 0;

  public now(): number {
    return this.time;
  }

  public setTimeout(callback: () => void): unknown {
    const handle = ++this.nextHandle;
    this.callbacks.set(handle, callback);
    return handle;
  }

  public clearTimeout(handle: unknown): void {
    if (typeof handle === 'number') this.callbacks.delete(handle);
  }

  public tick(): void {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of callbacks) callback();
  }

  public pending(): number {
    return this.callbacks.size;
  }
}

describe('connection state and resilience kernel', () => {
  it('exhaustively accepts legal transitions and rejects every illegal pair', () => {
    for (const previous of ConnectionPhaseSchema.options) {
      for (const next of ConnectionPhaseSchema.options) {
        const machine = new ConnectionStateMachine('obs', previous);
        const transition = () =>
          machine.transition(next, {
            attempt: 0,
            reasonCode: 'PROPERTY_TEST',
            correlationId,
            changedAt: new Date(0).toISOString(),
          });
        if (canTransition(previous, next)) {
          expect(transition()).toMatchObject({ previous, phase: next });
        } else {
          expect(transition).toThrow('Illegal connection transition');
        }
      }
    }
  });

  it('proves full-jitter caps and abortable timer cancellation with a fake clock', async () => {
    expect(computeFullJitterDelay(0, () => 0.999_999)).toBe(500);
    expect(computeFullJitterDelay(1, () => 0.999_999)).toBe(1_000);
    expect(computeFullJitterDelay(20, () => 0.999_999)).toBe(30_000);
    expect(computeFullJitterDelay(7, () => 0)).toBe(0);

    const clock = new FakeClock();
    const controller = new AbortController();
    const sleeping = sleepWithSignal(30_000, controller.signal, clock);
    expect(clock.pending()).toBe(1);
    controller.abort(new DOMException('cancelled', 'AbortError'));
    await expect(sleeping).rejects.toMatchObject({ name: 'AbortError' });
    expect(clock.pending()).toBe(0);
  });

  it('opens after five qualifying failures and closes after two successful probes', () => {
    const breaker = new CircuitBreaker();
    for (let failure = 0; failure < 5; failure += 1) breaker.recordFailure(failure * 100);
    expect(breaker.snapshot()).toBe('open');
    expect(breaker.canExecute(19_999)).toBe(false);
    expect(breaker.canExecute(20_400)).toBe(true);
    expect(breaker.snapshot()).toBe('half_open');
    breaker.recordSuccess();
    breaker.recordSuccess();
    expect(breaker.snapshot()).toBe('closed');
  });

  it('runs one supervised handshake through ready and disconnects cleanly', async () => {
    const calls: string[] = [];
    const driver: ConnectionDriver = {
      connect: async () => {
        calls.push('connect');
      },
      authenticate: async () => {
        calls.push('authenticate');
      },
      synchronize: async () => {
        calls.push('synchronize');
      },
      disconnect: async () => {
        calls.push('disconnect');
      },
    };
    const transitions: string[] = [];
    const supervisor = new ConnectionSupervisor('obs', driver, {
      correlationId: () => correlationId,
      onTransition: (transition) => transitions.push(transition.phase),
    });
    const first = supervisor.start();
    expect(supervisor.start()).toBe(first);
    await first;
    expect(supervisor.snapshot().phase).toBe('ready');
    expect(transitions).toEqual(['connecting', 'authenticating', 'synchronizing', 'ready']);
    await supervisor.stop();
    expect(calls).toEqual(['connect', 'authenticate', 'synchronize', 'disconnect']);
    expect(supervisor.snapshot().phase).toBe('stopped');
  });

  it('classifies authentication failures without scheduling retries', async () => {
    const connect = vi.fn(async () => {
      throw new Error('credential rejected');
    });
    const driver: ConnectionDriver = {
      connect,
      authenticate: vi.fn(),
      synchronize: vi.fn(),
      disconnect: vi.fn(),
    };
    const supervisor = new ConnectionSupervisor('twitch', driver, {
      classifyError: () => 'auth',
      correlationId: () => correlationId,
    });
    await supervisor.start();
    expect(connect).toHaveBeenCalledOnce();
    expect(supervisor.snapshot().phase).toBe('auth_required');
  });

  it('aborts and discards an in-flight generation during shutdown', async () => {
    let aborted = false;
    const driver: ConnectionDriver = {
      connect: (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              reject(signal.reason);
            },
            { once: true },
          );
        }),
      authenticate: vi.fn(),
      synchronize: vi.fn(),
      disconnect: vi.fn(),
    };
    const supervisor = new ConnectionSupervisor('supabase', driver, {
      correlationId: () => correlationId,
    });
    const running = supervisor.start();
    await Promise.resolve();
    const stopping = supervisor.stop();
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    await stopping;
    expect(aborted).toBe(true);
    expect(supervisor.snapshot().phase).toBe('stopped');
  });
});
