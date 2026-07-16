import type { RealtimeChannel } from '@supabase/supabase-js';
import type { StagePilotSupabaseClient } from './client.js';
import type { CloudRepository, CatchUpCursor, CatchUpResult } from './repository.js';

export type RealtimeSyncState =
  'stopped' | 'connecting' | 'subscribed' | 'catching_up' | 'backoff' | 'degraded';

export interface RealtimeSyncCallbacks {
  readonly onState: (state: RealtimeSyncState, reasonCode: string, attempt: number) => void;
  readonly onCatchUp: (page: CatchUpResult) => void | Promise<void>;
  readonly onInvalidated: () => void;
}

interface SyncOptions {
  readonly random?: () => number;
  readonly setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

const INVALIDATION_TABLES = ['profiles', 'devices', 'control_profiles', 'tool_grants'] as const;

export class RealtimeSyncCoordinator {
  private channel: RealtimeChannel | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;
  private attempt = 0;
  private cursor: CatchUpCursor | undefined;
  private generation = 0;
  private catchUpGeneration: number | undefined;
  private readonly random: () => number;
  private readonly setTimer: NonNullable<SyncOptions['setTimer']>;
  private readonly clearTimer: NonNullable<SyncOptions['clearTimer']>;

  public constructor(
    private readonly client: StagePilotSupabaseClient,
    private readonly repository: CloudRepository,
    private readonly callbacks: RealtimeSyncCallbacks,
    options: SyncOptions = {},
  ) {
    this.random = options.random ?? Math.random;
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
  }

  public start(userId: string, cursor?: CatchUpCursor): void {
    this.stop();
    this.stopped = false;
    this.attempt = 0;
    this.cursor = cursor;
    const generation = ++this.generation;
    this.connect(userId, generation);
  }

  public stop(): void {
    this.stopped = true;
    this.generation += 1;
    this.catchUpGeneration = undefined;
    if (this.retryTimer !== undefined) this.clearTimer(this.retryTimer);
    this.retryTimer = undefined;
    if (this.channel !== undefined) void this.client.removeChannel(this.channel);
    this.channel = undefined;
    this.callbacks.onState('stopped', 'STOPPED', this.attempt);
  }

  private connect(userId: string, generation: number): void {
    if (!this.isActive(generation)) return;
    this.callbacks.onState('connecting', 'CONNECTING', this.attempt);
    let channel = this.client.channel('user:' + userId + ':sync');
    for (const table of INVALIDATION_TABLES) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: 'user_id=eq.' + userId },
        () => {
          if (this.isActive(generation)) this.callbacks.onInvalidated();
        },
      );
    }
    this.channel = channel.subscribe((status) => {
      if (!this.isActive(generation)) return;
      if (status === 'SUBSCRIBED') {
        void this.catchUp(userId, generation);
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        this.scheduleReconnect(userId, status, generation);
      }
    });
  }

  private async catchUp(userId: string, generation: number): Promise<void> {
    if (!this.isActive(generation) || this.catchUpGeneration === generation) return;
    this.catchUpGeneration = generation;
    this.callbacks.onState('catching_up', 'CATCH_UP', this.attempt);
    try {
      let hasMore = true;
      while (hasMore && this.isActive(generation)) {
        const page = await this.repository.catchUp(this.cursor);
        if (!this.isActive(generation)) return;
        await this.callbacks.onCatchUp(page);
        this.cursor = page.cursor;
        hasMore = page.hasMore;
      }
      if (this.isActive(generation)) {
        this.attempt = 0;
        this.callbacks.onState('subscribed', 'SYNCHRONIZED', 0);
      }
    } catch {
      if (this.isActive(generation)) {
        this.callbacks.onState('degraded', 'CATCH_UP_FAILED', this.attempt);
        this.scheduleReconnect(userId, 'CATCH_UP_FAILED', generation);
      }
    } finally {
      if (this.catchUpGeneration === generation) this.catchUpGeneration = undefined;
    }
  }

  private scheduleReconnect(userId: string, reasonCode: string, generation: number): void {
    if (!this.isActive(generation) || this.retryTimer !== undefined) return;
    const prior = this.channel;
    this.channel = undefined;
    if (prior !== undefined) void this.client.removeChannel(prior);
    const nextGeneration = ++this.generation;
    this.attempt += 1;
    const ceiling = Math.min(30_000, 500 * 2 ** Math.min(this.attempt - 1, 6));
    const delay = Math.floor(this.random() * ceiling);
    this.callbacks.onState('backoff', reasonCode, this.attempt);
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = undefined;
      this.connect(userId, nextGeneration);
    }, delay);
  }

  private isActive(generation: number): boolean {
    return !this.stopped && generation === this.generation;
  }
}
