import type { ConnectionProvider } from '@obscurpilot/contracts/state';
import {
  ConnectionSupervisor,
  type ConnectionDriver,
} from '@obscurpilot/domain/connection-supervisor';
import type { Clock } from '@obscurpilot/domain/retry';
import { describe, expect, it, vi } from 'vitest';

const PROVIDERS: readonly ConnectionProvider[] = ['obs', 'twitch', 'groq', 'supabase'];
const CORRELATION_ID = '10000000-0000-4000-8000-000000000001';

class AdvancingClock implements Clock {
  public time = Date.parse('2026-07-19T06:30:00.000Z');
  private cancelled = new Set<number>();
  private handle = 0;

  public now(): number {
    return this.time;
  }

  public setTimeout(callback: () => void, delayMs: number): unknown {
    const handle = ++this.handle;
    this.time += delayMs;
    queueMicrotask(() => {
      if (!this.cancelled.has(handle)) callback();
    });
    return handle;
  }

  public clearTimeout(handle: unknown): void {
    if (typeof handle === 'number') this.cancelled.add(handle);
  }
}

describe('Stage 13 provider outage matrix', () => {
  it.each(PROVIDERS)(
    '%s recovers from a transport flicker through a fresh handshake',
    async (provider) => {
      const calls: string[] = [];
      let firstAttempt = true;
      const driver: ConnectionDriver = {
        connect: async () => {
          calls.push('connect');
          if (firstAttempt) {
            firstAttempt = false;
            throw new Error('injected network outage');
          }
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
      const supervisor = new ConnectionSupervisor(provider, driver, {
        clock: new AdvancingClock(),
        random: () => 0,
        correlationId: () => CORRELATION_ID,
        onTransition: (transition) => transitions.push(transition.phase),
      });
      await supervisor.start();
      expect(supervisor.snapshot()).toMatchObject({ phase: 'ready', attempt: 1 });
      expect(calls).toEqual(['connect', 'connect', 'authenticate', 'synchronize']);
      expect(transitions).toEqual([
        'connecting',
        'backoff',
        'connecting',
        'authenticating',
        'synchronizing',
        'ready',
      ]);
      await supervisor.stop();
      expect(calls.at(-1)).toBe('disconnect');
    },
  );

  it.each(PROVIDERS)(
    '%s fails closed on an authentication outage without retrying',
    async (provider) => {
      const connect = vi.fn(async () => undefined);
      const authenticate = vi.fn(async () => {
        throw new Error('injected credential rejection');
      });
      const supervisor = new ConnectionSupervisor(
        provider,
        { connect, authenticate, synchronize: vi.fn(), disconnect: vi.fn() },
        {
          classifyError: () => 'auth',
          correlationId: () => CORRELATION_ID,
        },
      );
      await supervisor.start();
      expect(supervisor.snapshot()).toMatchObject({ phase: 'auth_required', attempt: 0 });
      expect(connect).toHaveBeenCalledOnce();
      expect(authenticate).toHaveBeenCalledOnce();
    },
  );

  it('keeps timestamps valid when the system clock moves backward', async () => {
    const clock = new AdvancingClock();
    clock.time = Date.parse('2026-07-19T06:30:00.000Z');
    const supervisor = new ConnectionSupervisor(
      'obs',
      {
        connect: async () => {
          clock.time -= 60 * 60_000;
        },
        authenticate: async () => undefined,
        synchronize: async () => undefined,
        disconnect: async () => undefined,
      },
      { clock, correlationId: () => CORRELATION_ID },
    );
    await supervisor.start();
    expect(Number.isNaN(Date.parse(supervisor.snapshot().changedAt))).toBe(false);
    expect(supervisor.snapshot().phase).toBe('ready');
  });
});
