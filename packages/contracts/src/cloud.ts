import { z } from 'zod';
import { createRequestEnvelopeSchema } from './ipc.js';

export const CloudAuthPhaseSchema = z.enum([
  'not_configured',
  'restoring',
  'signed_out',
  'authenticated',
  'degraded',
]);
export type CloudAuthPhase = z.infer<typeof CloudAuthPhaseSchema>;

export const CloudAuthProjectionSchema = z
  .object({
    configured: z.boolean(),
    phase: CloudAuthPhaseSchema,
    userId: z.string().uuid().optional(),
    expiresAt: z.string().datetime({ offset: true }).optional(),
    reasonCode: z.string().min(1).max(96),
  })
  .strict();
export type CloudAuthProjection = z.infer<typeof CloudAuthProjectionSchema>;

export const CloudCredentialPayloadSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    password: z.string().min(8).max(256),
  })
  .strict();
export type CloudCredentialPayload = z.infer<typeof CloudCredentialPayloadSchema>;

export const CloudConfirmationPayloadSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
  })
  .strict();
export type CloudConfirmationPayload = z.infer<typeof CloudConfirmationPayloadSchema>;

export const CloudSignOutPayloadSchema = z.object({ scope: z.literal('local') }).strict();
export const CloudGetAuthPayloadSchema = z.object({}).strict();

export const CloudGetAuthRequestSchema = createRequestEnvelopeSchema(CloudGetAuthPayloadSchema);
export const CloudSignInRequestSchema = createRequestEnvelopeSchema(CloudCredentialPayloadSchema);
export const CloudSignUpRequestSchema = createRequestEnvelopeSchema(CloudCredentialPayloadSchema);
export const CloudResendConfirmationRequestSchema = createRequestEnvelopeSchema(
  CloudConfirmationPayloadSchema,
);
export const CloudSignOutRequestSchema = createRequestEnvelopeSchema(CloudSignOutPayloadSchema);

export const CreatorProfileSchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    displayName: z.string().min(1).max(80),
    locale: z.string().min(2).max(35),
    timeZone: z.string().min(1).max(64),
    revision: z.number().int().positive(),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type CreatorProfile = z.infer<typeof CreatorProfileSchema>;

export const DeviceRegistrationSchema = z
  .object({
    id: z.string().uuid(),
    publicId: z.string().uuid(),
    revision: z.number().int().positive(),
    lastSeenAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type DeviceRegistration = z.infer<typeof DeviceRegistrationSchema>;

export const OperationReceiptSchema = z
  .object({
    mutationId: z.string().uuid(),
    status: z.enum(['delivered', 'queued']),
  })
  .strict();
export type OperationReceipt = z.infer<typeof OperationReceiptSchema>;
