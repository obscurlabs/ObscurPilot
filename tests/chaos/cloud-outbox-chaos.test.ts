import {
  BoundedDurableOutbox,
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

describe('cloud outbox failure recovery', () => {
  it('does not duplicate a side effect after the first response is lost', async () => {
    const persistence = new MemoryPersistence();
    const applied = new Set<string>();
    let now = Date.parse('2026-07-16T00:00:00.000Z');
    let loseResponse = true;
    const outbox = new BoundedDurableOutbox(
      persistence,
      {
        deliver: async (event) => {
          if (applied.has(event.idempotencyKey)) return 'duplicate';
          applied.add(event.idempotencyKey);
          if (loseResponse) {
            loseResponse = false;
            throw new Error('response lost after commit');
          }
          return 'delivered';
        },
      },
      { now: () => now, random: () => 1 },
    );
    await outbox.enqueue({
      id: '50000000-0000-4000-8000-000000000005',
      idempotencyKey: '50000000-0000-4000-8000-000000000005',
      tenantId: '10000000-0000-4000-8000-000000000001',
      aggregateId: 'profile',
      schemaVersion: 1,
      eventType: 'profile.update',
      occurredAt: new Date(now).toISOString(),
      payload: { displayName: 'Creator' },
    });

    await expect(outbox.flush(new AbortController().signal)).resolves.toMatchObject({
      delivered: 0,
      retained: 1,
    });
    now += 1_000;
    await expect(outbox.flush(new AbortController().signal)).resolves.toMatchObject({
      delivered: 1,
      retained: 0,
    });
    expect(applied).toEqual(new Set(['50000000-0000-4000-8000-000000000005']));
  });
});
