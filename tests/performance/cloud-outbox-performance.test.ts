import {
  BoundedDurableOutbox,
  type OutboxPersistence,
  type StoredOutboxEvent,
} from '@obscurpilot/domain/durable-outbox';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';

class MemoryPersistence implements OutboxPersistence {
  private events: StoredOutboxEvent[] = [];

  public async load(): Promise<readonly StoredOutboxEvent[]> {
    return structuredClone(this.events);
  }

  public async save(events: readonly StoredOutboxEvent[]): Promise<void> {
    this.events = structuredClone([...events]);
  }
}

describe('cloud outbox bound performance', () => {
  it('processes the maximum 512-event queue within the CI safety budget', async () => {
    const outbox = new BoundedDurableOutbox(
      new MemoryPersistence(),
      { deliver: async () => 'delivered' },
      { maxEvents: 512, maxSerializedBytes: 4 * 1024 * 1024 },
    );
    const startedAt = performance.now();
    for (let index = 0; index < 512; index += 1) {
      const id = index.toString(16).padStart(8, '0') + '-0000-4000-8000-000000000001';
      await outbox.enqueue({
        id,
        idempotencyKey: id,
        tenantId: '10000000-0000-4000-8000-000000000001',
        aggregateId: 'aggregate-' + index.toString(10),
        schemaVersion: 1,
        eventType: 'fixture',
        occurredAt: '2026-07-16T00:00:00.000Z',
        payload: { index },
      });
    }
    const result = await outbox.flush(new AbortController().signal);
    const durationMs = performance.now() - startedAt;

    expect(result).toMatchObject({ attempted: 512, delivered: 512, retained: 0 });
    expect(durationMs).toBeLessThan(15_000);
  });
});
