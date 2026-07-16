import {
  RealtimeSyncCoordinator,
  type CatchUpResult,
  type CloudRepository,
  type StagePilotSupabaseClient,
} from '@obscurpilot/adapters-supabase/boundary';
import { describe, expect, it, vi } from 'vitest';

class FakeChannel {
  private statusListener: ((status: string) => void) | undefined;

  public on(): this {
    return this;
  }

  public subscribe(listener: (status: string) => void): this {
    this.statusListener = listener;
    return this;
  }

  public emit(status: string): void {
    this.statusListener?.(status);
  }
}

const emptyPage: CatchUpResult = {
  events: [],
  cursor: undefined,
  hasMore: false,
};

function harness(catchUp: () => Promise<CatchUpResult>) {
  const channels: FakeChannel[] = [];
  const client = {
    channel: vi.fn(() => {
      const channel = new FakeChannel();
      channels.push(channel);
      return channel;
    }),
    removeChannel: vi.fn(async () => 'ok'),
  } as unknown as StagePilotSupabaseClient;
  const repository = { catchUp: vi.fn(catchUp) } as unknown as CloudRepository;
  const onState = vi.fn();
  const onCatchUp = vi.fn();
  const onInvalidated = vi.fn();
  return {
    channels,
    client,
    repository,
    onState,
    coordinator: new RealtimeSyncCoordinator(client, repository, {
      onState,
      onCatchUp,
      onInvalidated,
    }),
  };
}

describe('realtime sync coordinator', () => {
  it('declares synchronization only after ordered catch-up completes', async () => {
    const subject = harness(async () => emptyPage);
    subject.coordinator.start('10000000-0000-4000-8000-000000000001');
    subject.channels[0]?.emit('SUBSCRIBED');

    await vi.waitFor(() => {
      expect(subject.onState).toHaveBeenLastCalledWith('subscribed', 'SYNCHRONIZED', 0);
    });
    expect(subject.repository.catchUp).toHaveBeenCalledOnce();
  });

  it('reconnects after a catch-up failure instead of remaining degraded', async () => {
    const timers: (() => void)[] = [];
    const subject = harness(async () => {
      throw new Error('offline');
    });
    const coordinator = new RealtimeSyncCoordinator(
      subject.client,
      subject.repository,
      {
        onState: subject.onState,
        onCatchUp: vi.fn(),
        onInvalidated: vi.fn(),
      },
      {
        random: () => 1,
        setTimer: (callback) => {
          timers.push(callback);
          return 1 as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimer: vi.fn(),
      },
    );
    coordinator.start('10000000-0000-4000-8000-000000000001');
    subject.channels[0]?.emit('SUBSCRIBED');

    await vi.waitFor(() => {
      expect(subject.onState).toHaveBeenCalledWith('backoff', 'CATCH_UP_FAILED', 1);
    });
    expect(timers).toHaveLength(1);
    timers[0]?.();
    expect(subject.client.channel).toHaveBeenCalledTimes(2);
  });

  it('ignores stale channel callbacks after stop', () => {
    const subject = harness(async () => emptyPage);
    subject.coordinator.start('10000000-0000-4000-8000-000000000001');
    const channel = subject.channels[0];
    subject.coordinator.stop();
    channel?.emit('CHANNEL_ERROR');

    expect(subject.onState).toHaveBeenLastCalledWith('stopped', 'STOPPED', 0);
  });
});
