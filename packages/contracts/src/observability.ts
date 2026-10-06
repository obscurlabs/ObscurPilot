import { z } from 'zod';
import { createEventEnvelopeSchema } from './ipc.js';

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

export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
export type LogLevel = z.infer<typeof LogLevelSchema>;

/** One human-readable line for the Logs page and the terminal. Never carries secrets. */
export const LogEntrySchema = z
  .object({
    id: z.number().int().positive(),
    timestamp: z.string().datetime({ offset: true }),
    level: LogLevelSchema,
    source: z.string().min(1).max(32),
    message: z.string().min(1).max(500),
    detail: z.string().max(1_000).optional(),
  })
  .strict();
export type LogEntry = z.infer<typeof LogEntrySchema>;

export const LogsProjectionSchema = z
  .object({ entries: z.array(LogEntrySchema).max(1_000) })
  .strict();
export type LogsProjection = z.infer<typeof LogsProjectionSchema>;
export const LogsEmptyPayloadSchema = z.object({}).strict();
export const LogEntryEventSchema = createEventEnvelopeSchema(LogEntrySchema);
