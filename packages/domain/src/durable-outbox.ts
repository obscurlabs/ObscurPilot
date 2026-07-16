export interface OutboxEvent {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly tenantId: string;
  readonly aggregateId: string;
  readonly schemaVersion: number;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface StoredOutboxEvent extends OutboxEvent {
  readonly attempts: number;
  readonly nextAttemptAt: string;
}

export interface FlushResult {
  readonly attempted: number;
  readonly delivered: number;
  readonly deliveredIds: readonly string[];
  readonly deferred: number;
  readonly deferredIds: readonly string[];
  readonly rejected: number;
  readonly rejectedIds: readonly string[];
  readonly retained: number;
  readonly nextAttemptAt?: string;
}

export interface DurableOutbox {
  enqueue(event: OutboxEvent): Promise<void>;
  flush(signal: AbortSignal): Promise<FlushResult>;
}

export interface OutboxPersistence {
  load(): Promise<readonly StoredOutboxEvent[]>;
  save(events: readonly StoredOutboxEvent[]): Promise<void>;
}

export interface OutboxDelivery {
  deliver(
    event: Readonly<StoredOutboxEvent>,
    signal: AbortSignal,
  ): Promise<'delivered' | 'duplicate' | 'deferred' | 'rejected'>;
}

export interface DurableOutboxOptions {
  readonly maxEvents?: number;
  readonly maxSerializedBytes?: number;
  readonly now?: () => number;
  readonly random?: () => number;
}

const DEFAULT_MAX_EVENTS = 512;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

export class OutboxCapacityError extends Error {
  public constructor() {
    super('The durable outbox has reached its safety limit');
    this.name = 'OutboxCapacityError';
  }
}

export class BoundedDurableOutbox implements DurableOutbox {
  private events: StoredOutboxEvent[] | undefined;
  private operation: Promise<void> = Promise.resolve();
  private readonly maxEvents: number;
  private readonly maxSerializedBytes: number;
  private readonly now: () => number;
  private readonly random: () => number;

  public constructor(
    private readonly persistence: OutboxPersistence,
    private readonly delivery: OutboxDelivery,
    options: DurableOutboxOptions = {},
  ) {
    this.maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
    this.maxSerializedBytes = options.maxSerializedBytes ?? DEFAULT_MAX_BYTES;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  public enqueue(event: OutboxEvent): Promise<void> {
    return this.exclusive(async () => {
      const events = await this.load();
      validateEvent(event);
      if (events.some((candidate) => candidate.idempotencyKey === event.idempotencyKey)) return;
      const stored: StoredOutboxEvent = {
        ...event,
        attempts: 0,
        nextAttemptAt: new Date(this.now()).toISOString(),
      };
      const next = [...events, stored];
      if (
        next.length > this.maxEvents ||
        utf8ByteLength(JSON.stringify(next)) > this.maxSerializedBytes
      ) {
        throw new OutboxCapacityError();
      }
      await this.persistence.save(next);
      this.events = next;
    });
  }

  public flush(signal: AbortSignal): Promise<FlushResult> {
    let result: FlushResult = {
      attempted: 0,
      delivered: 0,
      deliveredIds: [],
      deferred: 0,
      deferredIds: [],
      rejected: 0,
      rejectedIds: [],
      retained: 0,
    };
    return this.exclusive(async () => {
      const events = await this.load();
      const blockedAggregates = new Set<string>();
      let attempted = 0;
      let delivered = 0;
      let deferred = 0;
      let rejected = 0;
      const deliveredIds: string[] = [];
      const deferredIds: string[] = [];
      const rejectedIds: string[] = [];
      const deferredAggregates = new Set<string>();

      for (const event of [...events]) {
        if (signal.aborted) break;
        if (blockedAggregates.has(event.aggregateId)) continue;
        if (Date.parse(event.nextAttemptAt) > this.now()) {
          blockedAggregates.add(event.aggregateId);
          continue;
        }
        attempted += 1;
        try {
          const outcome = await this.delivery.deliver(event, signal);
          if (outcome === 'deferred') {
            deferred += 1;
            deferredIds.push(event.id);
            deferredAggregates.add(event.aggregateId);
            blockedAggregates.add(event.aggregateId);
            continue;
          }
          const current = await this.load();
          const next = current.filter((candidate) => candidate.id !== event.id);
          await this.persistence.save(next);
          this.events = next;
          if (outcome === 'rejected') {
            rejected += 1;
            rejectedIds.push(event.id);
          } else {
            delivered += 1;
            deliveredIds.push(event.id);
          }
        } catch {
          if (signal.aborted) break;
          blockedAggregates.add(event.aggregateId);
          const current = await this.load();
          const next = current.map((candidate) =>
            candidate.id === event.id
              ? {
                  ...candidate,
                  attempts: candidate.attempts + 1,
                  nextAttemptAt: new Date(
                    this.now() + retryDelay(candidate.attempts + 1, this.random),
                  ).toISOString(),
                }
              : candidate,
          );
          await this.persistence.save(next);
          this.events = next;
        }
      }
      const retainedEvents = await this.load();
      const pendingAggregates = new Set<string>();
      const nextAttempt = retainedEvents
        .filter((event) => {
          if (pendingAggregates.has(event.aggregateId)) return false;
          pendingAggregates.add(event.aggregateId);
          return !deferredAggregates.has(event.aggregateId);
        })
        .map((event) => event.nextAttemptAt)
        .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
      result = {
        attempted,
        delivered,
        deliveredIds,
        deferred,
        deferredIds,
        rejected,
        rejectedIds,
        retained: retainedEvents.length,
        ...(nextAttempt === undefined ? {} : { nextAttemptAt: nextAttempt }),
      };
    }).then(() => result);
  }

  public async contains(eventId: string): Promise<boolean> {
    await this.operation;
    return (await this.load()).some((event) => event.id === eventId);
  }

  public async size(): Promise<number> {
    await this.operation;
    return (await this.load()).length;
  }

  private async load(): Promise<StoredOutboxEvent[]> {
    if (this.events !== undefined) return this.events;
    const loaded = [...(await this.persistence.load())];
    for (const event of loaded) validateStoredEvent(event);
    this.events = loaded.sort(
      (left, right) =>
        Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
        left.id.localeCompare(right.id),
    );
    return this.events;
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.operation.then(task, task);
    this.operation = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

function retryDelay(attempt: number, random: () => number): number {
  const ceiling = Math.min(5 * 60_000, 1_000 * 2 ** Math.min(attempt - 1, 8));
  return Math.floor(Math.max(0, Math.min(1, random())) * ceiling);
}

function validateStoredEvent(event: StoredOutboxEvent): void {
  validateEvent(event);
  if (!Number.isInteger(event.attempts) || event.attempts < 0) {
    throw new Error('Outbox attempts are invalid');
  }
  if (!Number.isFinite(Date.parse(event.nextAttemptAt))) {
    throw new Error('Outbox retry time is invalid');
  }
}

function validateEvent(event: OutboxEvent): void {
  if (
    event.id.length < 1 ||
    event.id.length > 128 ||
    event.idempotencyKey.length < 1 ||
    event.idempotencyKey.length > 128 ||
    event.tenantId.length < 1 ||
    event.tenantId.length > 128 ||
    event.aggregateId.length < 1 ||
    event.aggregateId.length > 128 ||
    event.eventType.length < 1 ||
    event.eventType.length > 96 ||
    !Number.isInteger(event.schemaVersion) ||
    event.schemaVersion < 1 ||
    !Number.isFinite(Date.parse(event.occurredAt))
  ) {
    throw new Error('Outbox event is invalid');
  }
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}
