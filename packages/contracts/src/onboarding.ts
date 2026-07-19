import { z } from 'zod';

export const OnboardingStepStatusSchema = z.enum(['complete', 'current', 'waiting', 'blocked']);
export type OnboardingStepStatus = z.infer<typeof OnboardingStepStatusSchema>;
export const OnboardingStepSchema = z
  .object({
    status: OnboardingStepStatusSchema,
    ready: z.boolean(),
    reasonCode: z.string().min(1).max(96),
  })
  .strict();

export const ObsPairingStepSchema = OnboardingStepSchema.extend({
  endpoint: z
    .string()
    .url()
    .regex(
      /^ws:\/\/(?:127\.0\.0\.1|localhost)(?::\d{1,5})?(?:\/[^?#]*)?$/u,
      'OBS pairing endpoint must be loopback WebSocket',
    ),
  passwordStored: z.boolean(),
  secureStorageAvailable: z.boolean(),
}).strict();

export const OnboardingProjectionSchema = z
  .object({
    schemaVersion: z.literal(1),
    complete: z.boolean(),
    nextStep: z.enum(['account', 'twitch', 'obs', 'complete']),
    account: OnboardingStepSchema,
    twitch: OnboardingStepSchema,
    obs: ObsPairingStepSchema,
  })
  .strict();
export type OnboardingProjection = z.infer<typeof OnboardingProjectionSchema>;

export const OnboardingEmptyPayloadSchema = z.object({}).strict();
export const PairObsPayloadSchema = z
  .object({
    password: z.string().max(256).optional(),
  })
  .strict();
export type PairObsPayload = z.infer<typeof PairObsPayloadSchema>;
