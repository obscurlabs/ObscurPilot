import { z } from 'zod';
import { PublicErrorSchema } from './errors.js';

export const IPC_PROTOCOL_VERSION = 1 as const;
export const MAX_IPC_ENVELOPE_BYTES = 64 * 1024;

export const IPC_CHANNELS = {
  getBootstrap: 'app:get-bootstrap:v1',
  getSnapshot: 'state:get-snapshot:v1',
  stateChanged: 'state:changed:v1',
  pttCommand: 'audio:ptt-command:v1',
  pttSetAccelerator: 'audio:set-accelerator:v1',
  audioListDevices: 'audio:list-devices:v1',
  audioSelectDevice: 'audio:select-device:v1',
  pttChanged: 'audio:ptt-changed:v1',
  handsFreeGetProjection: 'audio:hands-free-get:v1',
  handsFreeSetPreferences: 'audio:hands-free-set:v1',
  handsFreeSpeechFinished: 'audio:hands-free-speech-finished:v1',
  handsFreeChanged: 'audio:hands-free-changed:v1',
  agentGetProjection: 'agent:get-projection:v1',
  agentConfirmationDecision: 'agent:confirmation-decision:v1',
  agentInteractionChanged: 'agent:interaction-changed:v1',
  obsGetSnapshot: 'obs:get-snapshot:v1',
  obsReconnect: 'obs:reconnect:v1',
  cloudGetAuth: 'cloud:get-auth:v1',
  cloudSignIn: 'cloud:sign-in:v1',
  cloudSignUp: 'cloud:sign-up:v1',
  cloudResendConfirmation: 'cloud:resend-confirmation:v1',
  cloudSignOut: 'cloud:sign-out:v1',
  cloudRequestDeletion: 'cloud:request-deletion:v1',
  twitchGetProjection: 'twitch:get-projection:v1',
  twitchConnect: 'twitch:connect:v1',
  twitchDisconnect: 'twitch:disconnect:v1',
  twitchReconnect: 'twitch:reconnect:v1',
  twitchCategorySearch: 'twitch:category-search:v1',
  twitchActivity: 'twitch:activity:v1',
  liveSessionGetProjection: 'live-session:get-projection:v1',
  liveSessionGetProfiles: 'live-session:get-profiles:v1',
  liveSessionPrepare: 'live-session:prepare:v1',
  liveSessionDecision: 'live-session:decision:v1',
  liveSessionStop: 'live-session:stop:v1',
  liveSessionEmergencyStop: 'live-session:emergency-stop:v1',
  liveSessionChanged: 'live-session:changed:v1',
  moderationExecute: 'moderation:execute:v1',
  chatMessage: 'chat:message:v1',
  chatAnalysis: 'chat:analysis:v1',
  pilotOverlayGetPreferences: 'pilot-overlay:get-preferences:v1',
  pilotOverlaySetPreferences: 'pilot-overlay:set-preferences:v1',
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
