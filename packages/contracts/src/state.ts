import { z } from 'zod';
import { createEventEnvelopeSchema, createRequestEnvelopeSchema } from './ipc.js';

export const ConnectionProviderSchema = z.enum(['obs', 'twitch', 'groq', 'supabase']);
export type ConnectionProvider = z.infer<typeof ConnectionProviderSchema>;

export const ConnectionPhaseSchema = z.enum([
  'idle',
  'connecting',
  'authenticating',
  'synchronizing',
  'ready',
  'backoff',
  'degraded',
  'reconnecting',
  'auth_required',
  'stopped',
]);
export type ConnectionPhase = z.infer<typeof ConnectionPhaseSchema>;

export const ConnectionProjectionSchema = z
  .object({
    provider: ConnectionProviderSchema,
    phase: ConnectionPhaseSchema,
    attempt: z.number().int().nonnegative(),
    changedAt: z.string().datetime({ offset: true }),
    reasonCode: z.string().min(1),
    correlationId: z.string().uuid(),
  })
  .strict();
export type ConnectionProjection = z.infer<typeof ConnectionProjectionSchema>;

export const AppSnapshotSchema = z
  .object({
    protocolVersion: z.literal(1),
    snapshotVersion: z.number().int().nonnegative(),
    generatedAt: z.string().datetime({ offset: true }),
    lifecycle: z.enum(['starting', 'ready', 'stopping']),
    connections: z.record(ConnectionProviderSchema, ConnectionProjectionSchema),
  })
  .strict();
export type AppSnapshot = z.infer<typeof AppSnapshotSchema>;

export const StatePatchSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('lifecycle'),
      value: AppSnapshotSchema.shape.lifecycle,
    })
    .strict(),
  z
    .object({
      kind: z.literal('connection'),
      provider: ConnectionProviderSchema,
      value: ConnectionProjectionSchema,
    })
    .strict(),
]);
export type StatePatch = z.infer<typeof StatePatchSchema>;

export const StateChangedSchema = z
  .object({
    snapshotVersion: z.number().int().positive(),
    patches: z.array(StatePatchSchema).min(1).max(32),
  })
  .strict();
export type StateChanged = z.infer<typeof StateChangedSchema>;
export const StateChangedEventSchema = createEventEnvelopeSchema(StateChangedSchema);

export const GetSnapshotPayloadSchema = z
  .object({
    afterVersion: z.number().int().nonnegative().optional(),
  })
  .strict();
export const GetSnapshotRequestSchema = createRequestEnvelopeSchema(GetSnapshotPayloadSchema);
