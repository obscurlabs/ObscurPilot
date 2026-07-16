import {
  BoundedDurableOutbox,
  OutboxCapacityError,
  type OutboxDelivery,
  type OutboxEvent,
  type OutboxPersistence,
  type StoredOutboxEvent,
} from '@obscurpilot/domain/durable-outbox';
import { describe, expect, it } from 'vitest';

class MemoryPersistence implements OutboxPersistence {
  public events: StoredOutboxEvent[] = [];

  public async load(): Promise<readonly StoredOutboxEvent[]> {
    return structuredClone(this.events);
  }

  public async save(events: readonly StoredOutboxEvent[]): Promise<void> {
    this.events = structuredClone([...events]);
  }
}

function event(
  id: string,
  aggregateId = 'profile-1',
  occurredAt = '2026-07-16T00:00:00.000Z',
): OutboxEvent {
  return {
    id,
    idempotencyKey: id,
    tenantId: '10000000-0000-4000-8000-000000000001',
    aggregateId,
    schemaVersion: 1,
    eventType: 'profile.update',
    occurredAt,
    payload: { displayName: 'Creator' },
  };
}

describe('bounded durable outbox', () => {
  it('deduplicates enqueue and flushes an idempotency key once', async () => {
    const persistence = new MemoryPersistence();
    const delivered = new Set<string>();
    const delivery: OutboxDelivery = {
      deliver: async (candidate) => {
        if (delivered.has(candidate.idempotencyKey)) return 'duplicate';
        delivered.add(candidate.idempotencyKey);
        return 'delivered';
      },
    };
    const outbox = new BoundedDurableOutbox(persistence, delivery, {
      now: () => Date.parse('2026-07-16T00:00:00.000Z'),
    });
    await outbox.enqueue(event('mutation-1'));
    await outbox.enqueue(event('mutation-1'));

    await expect(outbox.flush(new AbortController().signal)).resolves.toEqual({
      attempted: 1,
      delivered: 1,
      deliveredIds: ['mutation-1'],
      deferred: 0,
      deferredIds: [],
      rejected: 0,
      rejectedIds: [],
      retained: 0,
    });
    await expect(outbox.flush(new AbortController().signal)).resolves.toEqual({
      attempted: 0,
      delivered: 0,
      deliveredIds: [],
      deferred: 0,
      deferredIds: [],
      rejected: 0,
      rejectedIds: [],
      retained: 0,
    });
    expect(delivered).toEqual(new Set(['mutation-1']));
  });

  it('survives restart and retries a retained mutation deterministically', async () => {
    const persistence = new MemoryPersistence();
    let now = Date.parse('2026-07-16T00:00:00.000Z');
    let offline = true;
    const delivery: OutboxDelivery = {
      deliver: async () => {
        if (offline) throw new Error('offline');
        return 'delivered';
      },
    };
    const first = new BoundedDurableOutbox(persistence, delivery, {
      now: () => now,
      random: () => 1,
    });
    await first.enqueue(event('mutation-2'));
    await expect(first.flush(new AbortController().signal)).resolves.toMatchObject({
      attempted: 1,
      retained: 1,
    });

    offline = false;
    now += 1_000;
    const afterRestart = new BoundedDurableOutbox(persistence, delivery, {
      now: () => now,
      random: () => 1,
    });
    await expect(afterRestart.flush(new AbortController().signal)).resolves.toEqual({
      attempted: 1,
      delivered: 1,
      deliveredIds: ['mutation-2'],
      deferred: 0,
      deferredIds: [],
      rejected: 0,
      rejectedIds: [],
      retained: 0,
    });
  });

  it('does not overtake a backed-off mutation in the same aggregate', async () => {
    const persistence = new MemoryPersistence();
    let now = Date.parse('2026-07-16T00:00:00.000Z');
    let offline = true;
    const attempted: string[] = [];
    const outbox = new BoundedDurableOutbox(
      persistence,
      {
        deliver: async (candidate) => {
          attempted.push(candidate.id);
          if (offline) throw new Error('offline');
          return 'delivered';
        },
      },
      { now: () => now, random: () => 1 },
    );
    await outbox.enqueue(event('first', 'profile-1', '2026-07-16T00:00:00.000Z'));
    await outbox.enqueue(event('second', 'profile-1', '2026-07-16T00:00:01.000Z'));

    await expect(outbox.flush(new AbortController().signal)).resolves.toMatchObject({
      attempted: 1,
      retained: 2,
      nextAttemptAt: '2026-07-16T00:00:01.000Z',
    });
    await expect(outbox.flush(new AbortController().signal)).resolves.toMatchObject({
      attempted: 0,
      retained: 2,
    });
    expect(attempted).toEqual(['first']);

    offline = false;
    now += 1_000;
    await expect(outbox.flush(new AbortController().signal)).resolves.toMatchObject({
      attempted: 2,
      deliveredIds: ['first', 'second'],
      retained: 0,
    });
  });

  it('removes a terminal rejection without blocking a later aggregate mutation', async () => {
    const persistence = new MemoryPersistence();
    const attempted: string[] = [];
    const outbox = new BoundedDurableOutbox(persistence, {
      deliver: async (candidate) => {
        attempted.push(candidate.id);
        return candidate.id === 'stale' ? 'rejected' : 'delivered';
      },
    });
    await outbox.enqueue(event('stale', 'profile-1', '2026-07-16T00:00:00.000Z'));
    await outbox.enqueue(event('current', 'profile-1', '2026-07-16T00:00:01.000Z'));

    await expect(outbox.flush(new AbortController().signal)).resolves.toEqual({
      attempted: 2,
      delivered: 1,
      deliveredIds: ['current'],
      deferred: 0,
      deferredIds: [],
      rejected: 1,
      rejectedIds: ['stale'],
      retained: 0,
    });
    expect(attempted).toEqual(['stale', 'current']);
  });

  it('retains another tenant mutation without scheduling a retry loop', async () => {
    const persistence = new MemoryPersistence();
    let tenantActive = false;
    const outbox = new BoundedDurableOutbox(persistence, {
      deliver: async () => (tenantActive ? 'delivered' : 'deferred'),
    });
    await outbox.enqueue(event('tenant-event'));

    await expect(outbox.flush(new AbortController().signal)).resolves.toEqual({
      attempted: 1,
      delivered: 0,
      deliveredIds: [],
      deferred: 1,
      deferredIds: ['tenant-event'],
      rejected: 0,
      rejectedIds: [],
      retained: 1,
    });

    tenantActive = true;
    await expect(outbox.flush(new AbortController().signal)).resolves.toMatchObject({
      deliveredIds: ['tenant-event'],
      retained: 0,
    });
  });

  it('enforces the configured queue bound', async () => {
    const persistence = new MemoryPersistence();
    const outbox = new BoundedDurableOutbox(
      persistence,
      { deliver: async () => 'delivered' },
      { maxEvents: 1 },
    );
    await outbox.enqueue(event('mutation-3'));
    await expect(outbox.enqueue(event('mutation-4'))).rejects.toBeInstanceOf(OutboxCapacityError);
  });
});
