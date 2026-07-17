import { z } from 'zod';
import { createEventEnvelopeSchema } from './ipc.js';

export const TwitchAccountSchema = z
  .object({
    providerUserId: z.string().min(1).max(128),
    displayName: z.string().min(1).max(80),
    scopes: z.array(z.string().min(1).max(128)).max(64),
    tokenExpiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export type TwitchAccount = z.infer<typeof TwitchAccountSchema>;

export const TwitchProjectionSchema = z
  .object({
    configured: z.boolean(),
    phase: z.enum([
      'not_configured',
      'signed_out',
      'authorizing',
      'connecting',
      'connected',
      'backoff',
      'degraded',
    ]),
    account: TwitchAccountSchema.optional(),
    reasonCode: z.string().min(1).max(96),
  })
  .strict();
export type TwitchProjection = z.infer<typeof TwitchProjectionSchema>;

export const TwitchActivitySchema = z
  .object({
    id: z.string().min(1).max(256),
    type: z.enum([
      'stream.online',
      'stream.offline',
      'channel.update',
      'channel.chat.message_delete',
      'channel.chat.clear_user',
      'channel.ban',
    ]),
    occurredAt: z.string().datetime({ offset: true }),
    summary: z.string().min(1).max(500),
    metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  })
  .strict();
export type TwitchActivity = z.infer<typeof TwitchActivitySchema>;

export const TwitchCategorySchema = z
  .object({ id: z.string().regex(/^\d{1,32}$/u), name: z.string().min(1).max(120) })
  .strict();
export type TwitchCategory = z.infer<typeof TwitchCategorySchema>;
export const TwitchCategorySearchPayloadSchema = z
  .object({ query: z.string().trim().min(1).max(120) })
  .strict();
export const TwitchCategorySearchResultSchema = z
  .object({ categories: z.array(TwitchCategorySchema).max(10) })
  .strict();

export const TwitchEmptyPayloadSchema = z.object({}).strict();
export const TwitchOperationAcceptedSchema = z.object({ accepted: z.literal(true) }).strict();
export const TwitchActivityEventSchema = createEventEnvelopeSchema(TwitchActivitySchema);
