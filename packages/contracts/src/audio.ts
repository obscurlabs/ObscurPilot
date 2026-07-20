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
export type VoiceCaptureSource = 'ptt' | 'hands_free';

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

export const ShortcutBindingsSchema = z
  .object({
    holdToTalk: z.string().trim().max(64),
    toggleTalk: z.string().trim().max(64),
    terminate: z.string().trim().max(64),
    toggleWindow: z.string().trim().max(64),
  })
  .strict();
export type ShortcutBindings = z.infer<typeof ShortcutBindingsSchema>;
export type ShortcutAction = keyof ShortcutBindings;

export const DEFAULT_SHORTCUT_BINDINGS: ShortcutBindings = {
  holdToTalk: 'Alt+X',
  toggleTalk: '',
  terminate: 'Ctrl+Alt+End',
  toggleWindow: 'Alt+Shift+O',
};

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

export const HandsFreePreferencesSchema = z
  .object({
    enabled: z.boolean(),
    wakePhrase: z.string().trim().min(2).max(32),
    speechThreshold: z.number().min(0.005).max(0.25),
    silenceReleaseMs: z.number().int().min(350).max(3_000),
    conversationWindowMs: z.number().int().min(15_000).max(900_000),
  })
  .strict();
export type HandsFreePreferences = z.infer<typeof HandsFreePreferencesSchema>;

export const HandsFreePhaseSchema = z.enum([
  'disabled',
  'arming',
  'standby',
  'listening',
  'transcribing',
  'reasoning',
  'awaiting_confirmation',
  'speaking',
  'paused',
  'error',
]);
export const HandsFreeProjectionSchema = z
  .object({
    phase: HandsFreePhaseSchema,
    reasonCode: z.string().min(1).max(96),
    enabled: z.boolean(),
    wakePhrase: z.string().min(2).max(32),
    level: z.number().min(0).max(1),
    sessionActive: z.boolean(),
    sessionExpiresAt: z.string().datetime({ offset: true }).optional(),
    speech: z
      .object({ id: z.string().uuid(), text: z.string().trim().min(1).max(1_000) })
      .strict()
      .optional(),
  })
  .strict();
export type HandsFreeProjection = z.infer<typeof HandsFreeProjectionSchema>;
export const HandsFreeSetPreferencesPayloadSchema = HandsFreePreferencesSchema;
export const HandsFreeSpeechFinishedPayloadSchema = z
  .object({ speechId: z.string().uuid() })
  .strict();
export const HandsFreeChangedEventSchema = createEventEnvelopeSchema(HandsFreeProjectionSchema);
