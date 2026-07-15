import { normalizeActivity } from '@obscurpilot/domain/activity';
import { CommandLedger } from '@obscurpilot/domain/command-ledger';
import { EventBus } from '@obscurpilot/domain/event-bus';
import { SnapshotConsumer, SnapshotStore } from '@obscurpilot/domain/snapshot-store';
import { describe, expect, it, vi } from 'vitest';

describe('authoritative state utilities', () => {
  it('increments snapshots monotonically and forces resync on gaps', () => {
    const store = new SnapshotStore<{ ready: boolean }, { ready: boolean }>({ ready: false });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    expect(store.mutate({ ready: true }, [{ ready: true }]).snapshotVersion).toBe(1);
    expect(store.mutate({ ready: false }, [{ ready: false }]).snapshotVersion).toBe(2);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();

    const consumer = new SnapshotConsumer();
    expect(consumer.apply(1)).toBe('applied');
    expect(consumer.apply(1)).toBe('stale');
    expect(consumer.apply(3)).toBe('resync_required');
    consumer.replace(3);
    expect(consumer.apply(4)).toBe('applied');
  });

  it('executes concurrent and completed duplicate commands exactly once', async () => {
    const ledger = new CommandLedger(1_000);
    const operation = vi.fn(async () => ({ accepted: true }));
    const [first, second] = await Promise.all([
      ledger.executeOnce('obs:semantic-key', operation, 0),
      ledger.executeOnce('obs:semantic-key', operation, 0),
    ]);
    const third = await ledger.executeOnce('obs:semantic-key', operation, 1);
    expect(first).toEqual(second);
    expect(third).toEqual(first);
    expect(operation).toHaveBeenCalledOnce();
    ledger.prune(1_001);
    expect(ledger.size()).toBe(0);
  });

  it('removes event listeners exactly and bounds normalized activity', () => {
    interface Events {
      changed: { readonly value: number };
    }
    const bus = new EventBus<Events>();
    const listener = vi.fn();
    const unsubscribe = bus.subscribe('changed', listener);
    bus.publish('changed', { value: 1 });
    unsubscribe();
    unsubscribe();
    bus.publish('changed', { value: 2 });
    expect(listener).toHaveBeenCalledOnce();
    expect(bus.listenerCount('changed')).toBe(0);

    const activity = normalizeActivity({
      id: 'event-1',
      occurredAt: new Date(0).toISOString(),
      source: 's'.repeat(80),
      type: 'test',
      summary: 'x'.repeat(600),
      metadata: Object.fromEntries(
        Array.from({ length: 20 }, (_, index) => ['key-' + index, index]),
      ),
    });
    expect(activity.schemaVersion).toBe(1);
    expect(activity.source).toHaveLength(64);
    expect(activity.summary).toHaveLength(500);
    expect(Object.keys(activity.metadata)).toHaveLength(16);
  });
});
