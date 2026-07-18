export interface OperationalEvent {
  readonly timestamp: string;
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly service: string;
  readonly event: string;
  readonly correlationId?: string;
  readonly durationMs?: number;
  readonly outcome?: 'success' | 'failure' | 'cancelled';
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}
