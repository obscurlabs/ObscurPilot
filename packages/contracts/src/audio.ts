import { z } from 'zod';
import { createEventEnvelopeSchema } from './ipc.js';

export const PttPhaseSchema = z.enum([
  'idle',
  'arming',
  'capturing',
  'encoding',
  'ready',
  'rejected',
  'error',
]);
export type PttPhase = z.infer<typeof PttPhaseSchema>;

export const PttProjectionSchema = z
  .object({
    phase: PttPhaseSchema,
    sessionId: z.string().uuid().optional(),
    elapsedMs: z.number().int().nonnegative(),
    level: z.number().min(0).max(1),
    reasonCode: z.string().min(1),
    clip: z
      .object({
        clipId: z.string().uuid(),
        durationMs: z.number().int().positive(),
        bytes: z.number().int().positive(),
        mimeType: z.literal('audio/wav'),
        truncated: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type PttProjection = z.infer<typeof PttProjectionSchema>;

export const PttCommandPayloadSchema = z
  .object({ action: z.enum(['press', 'release', 'cancel']) })
  .strict();
export type PttCommandPayload = z.infer<typeof PttCommandPayloadSchema>;

export const SetPttAcceleratorPayloadSchema = z
  .object({ accelerator: z.string().trim().min(1).max(64) })
  .strict();

export const AudioDeviceSchema = z
  .object({
    deviceId: z.string().min(1).max(512),
    label: z.string().max(256),
    isDefault: z.boolean(),
  })
  .strict();
export type AudioDevice = z.infer<typeof AudioDeviceSchema>;

export const AudioDeviceListSchema = z
  .object({ devices: z.array(AudioDeviceSchema).max(64) })
  .strict();
export const SelectAudioDevicePayloadSchema = z
  .object({ deviceId: z.string().min(1).max(512) })
  .strict();
export const EmptyPayloadSchema = z.object({}).strict();
export const OperationAcceptedSchema = z.object({ accepted: z.literal(true) }).strict();
export const PttChangedEventSchema = createEventEnvelopeSchema(PttProjectionSchema);
