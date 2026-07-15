export interface OutboxEvent {
  readonly id: string;
  readonly schemaVersion: number;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface FlushResult {
  readonly attempted: number;
  readonly delivered: number;
  readonly retained: number;
}

export interface DurableOutbox {
  enqueue(event: OutboxEvent): Promise<void>;
  flush(signal: AbortSignal): Promise<FlushResult>;
}
