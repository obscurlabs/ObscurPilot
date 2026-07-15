import { z } from 'zod';
import { PublicErrorSchema } from './errors.js';

export const IPC_PROTOCOL_VERSION = 1 as const;
export const MAX_IPC_ENVELOPE_BYTES = 64 * 1024;

export const IPC_CHANNELS = {
  getBootstrap: 'app:get-bootstrap:v1',
  getSnapshot: 'state:get-snapshot:v1',
  stateChanged: 'state:changed:v1',
} as const;

const RequestMetadataSchema = z
  .object({
    protocolVersion: z.literal(IPC_PROTOCOL_VERSION),
    requestId: z.string().uuid(),
    sentAt: z.string().datetime({ offset: true }),
  })
  .strict();

export function createRequestEnvelopeSchema<T extends z.ZodType>(
  payloadSchema: T,
): z.ZodObject<{
  protocolVersion: z.ZodLiteral<typeof IPC_PROTOCOL_VERSION>;
  requestId: z.ZodString;
  sentAt: z.ZodString;
  payload: T;
}> {
  return RequestMetadataSchema.extend({ payload: payloadSchema }).strict();
}

export function createResultEnvelopeSchema<T extends z.ZodType>(dataSchema: T) {
  return z.discriminatedUnion('ok', [
    z
      .object({
        ok: z.literal(true),
        requestId: z.string().uuid(),
        data: dataSchema,
      })
      .strict(),
    z
      .object({
        ok: z.literal(false),
        requestId: z.string().uuid(),
        error: PublicErrorSchema,
      })
      .strict(),
  ]);
}

export function createEventEnvelopeSchema<T extends z.ZodType>(payloadSchema: T) {
  return z
    .object({
      protocolVersion: z.literal(IPC_PROTOCOL_VERSION),
      eventId: z.string().uuid(),
      emittedAt: z.string().datetime({ offset: true }),
      payload: payloadSchema,
    })
    .strict();
}

export type RequestEnvelope<T> = {
  readonly protocolVersion: typeof IPC_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly sentAt: string;
  readonly payload: T;
};

export type ResultEnvelope<T> =
  | { readonly ok: true; readonly requestId: string; readonly data: T }
  | {
      readonly ok: false;
      readonly requestId: string;
      readonly error: z.infer<typeof PublicErrorSchema>;
    };

export type EventEnvelope<T> = {
  readonly protocolVersion: typeof IPC_PROTOCOL_VERSION;
  readonly eventId: string;
  readonly emittedAt: string;
  readonly payload: T;
};
