import { z } from 'zod';

export const PUBLIC_ERROR_CODES = [
  'VALIDATION_FAILED',
  'AUTH_REQUIRED',
  'PERMISSION_DENIED',
  'RESOURCE_NOT_FOUND',
  'PRECONDITION_FAILED',
  'RATE_LIMITED',
  'UPSTREAM_UNAVAILABLE',
  'TIMEOUT',
  'CONFLICT',
  'CANCELLED',
  'POLICY_REJECTED',
  'INTERNAL',
] as const;

export const PublicErrorSchema = z
  .object({
    code: z.enum(PUBLIC_ERROR_CODES),
    message: z.string().min(1),
    retryable: z.boolean(),
    correlationId: z.string().uuid(),
    details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .strict();

export type PublicError = z.infer<typeof PublicErrorSchema>;
export type PublicErrorCode = PublicError['code'];
