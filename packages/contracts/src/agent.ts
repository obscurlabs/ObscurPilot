import { z } from 'zod';
import { createEventEnvelopeSchema } from './ipc.js';

export const GroqSttModelSchema = z.literal('whisper-large-v3-turbo');
export type GroqSttModel = z.infer<typeof GroqSttModelSchema>;

export const GroqReasoningModelSchema = z.enum(['openai/gpt-oss-120b', 'qwen/qwen3.6-27b']);
export type GroqReasoningModel = z.infer<typeof GroqReasoningModelSchema>;

export const AgentInteractionPhaseSchema = z.enum([
  'idle',
  'transcribing',
  'reasoning',
  'tool_active',
  'awaiting_confirmation',
  'completed',
  'error',
]);
export type AgentInteractionPhase = z.infer<typeof AgentInteractionPhaseSchema>;

const ToolIdentitySchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_.-]{2,63}$/u),
    version: z.number().int().positive(),
  })
  .strict();

export const AgentConfirmationSchema = z
  .object({
    confirmationId: z.string().uuid(),
    tool: ToolIdentitySchema,
    expiresAt: z.string().datetime({ offset: true }),
    summaryCode: z.string().min(1).max(96),
  })
  .strict();
export type AgentConfirmation = z.infer<typeof AgentConfirmationSchema>;

export const AgentInteractionProjectionSchema = z
  .object({
    phase: AgentInteractionPhaseSchema,
    reasonCode: z.string().min(1).max(96),
    elapsedMs: z.number().int().nonnegative(),
    correlationId: z.string().uuid().optional(),
    model: GroqReasoningModelSchema.optional(),
    tool: ToolIdentitySchema.optional(),
    confirmation: AgentConfirmationSchema.optional(),
  })
  .strict();
export type AgentInteractionProjection = z.infer<typeof AgentInteractionProjectionSchema>;

export const AgentEmptyPayloadSchema = z.object({}).strict();
export const AgentConfirmationDecisionPayloadSchema = z
  .object({
    confirmationId: z.string().uuid(),
    decision: z.enum(['approve', 'deny']),
  })
  .strict();
export type AgentConfirmationDecisionPayload = z.infer<
  typeof AgentConfirmationDecisionPayloadSchema
>;

export const AgentInteractionChangedEventSchema = createEventEnvelopeSchema(
  AgentInteractionProjectionSchema,
);
