import { z } from 'zod';
import { createEventEnvelopeSchema } from './ipc.js';

export const LiveSessionModeSchema = z.enum(['dry_run', 'live']);
export type LiveSessionMode = z.infer<typeof LiveSessionModeSchema>;

export const LiveSessionProfileV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    profileId: z.string().uuid(),
    revision: z.number().int().positive(),
    name: z.string().trim().min(1).max(80),
    twitch: z
      .object({
        title: z.string().trim().min(1).max(140),
        categoryId: z.string().regex(/^\d{1,32}$/u),
        categoryName: z.string().trim().min(1).max(120),
        tags: z.array(z.string().trim().min(1).max(25)).max(10),
        language: z.string().regex(/^[a-z]{2}$/u),
      })
      .strict(),
    obs: z
      .object({
        sceneCollectionName: z.string().trim().min(1).max(512),
        preLiveSceneName: z.string().trim().min(1).max(512),
        liveSceneName: z.string().trim().min(1).max(512),
        requiredInputs: z.array(z.string().trim().min(1).max(512)).max(100),
        countdownSeconds: z.number().int().min(0).max(3_600),
        countdownInputName: z.string().trim().min(1).max(512).optional(),
        recording: z.enum(['off', 'on']),
      })
      .strict(),
    verification: z
      .object({
        obsReadyTimeoutMs: z.number().int().min(1_000).max(60_000),
        twitchLiveTimeoutMs: z.number().int().min(5_000).max(180_000),
      })
      .strict(),
  })
  .strict();
export type LiveSessionProfileV1 = z.infer<typeof LiveSessionProfileV1Schema>;

export const LiveSessionStepSchema = z.enum([
  'preflight',
  'apply_twitch',
  'prepare_obs',
  'start_output',
  'verify_live',
]);
export type LiveSessionStep = z.infer<typeof LiveSessionStepSchema>;

export const TwitchMetadataSchema = z
  .object({
    title: z.string().max(140),
    categoryId: z.string().max(32),
    categoryName: z.string().max(120),
    tags: z.array(z.string().max(25)).max(10),
    language: z.string().max(16),
  })
  .strict();
export type TwitchMetadata = z.infer<typeof TwitchMetadataSchema>;

export const LiveSessionPlanV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    planId: z.string().uuid(),
    planHash: z.string().regex(/^[a-f0-9]{64}$/u),
    mode: LiveSessionModeSchema,
    profileId: z.string().uuid(),
    profileRevision: z.number().int().positive(),
    profileName: z.string().min(1).max(80),
    createdAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    expectedObsSnapshotVersion: z.number().int().nonnegative(),
    expectedObsGeneration: z.number().int().nonnegative(),
    previousTwitch: TwitchMetadataSchema,
    plannedTwitch: TwitchMetadataSchema,
    preLiveSceneName: z.string().min(1).max(512),
    liveSceneName: z.string().min(1).max(512),
    countdownSeconds: z.number().int().min(0).max(3_600),
    recording: z.enum(['off', 'on']),
    requiredScopes: z.array(z.string().min(1).max(128)).max(16),
    steps: z.array(LiveSessionStepSchema).length(5),
  })
  .strict();
export type LiveSessionPlanV1 = z.infer<typeof LiveSessionPlanV1Schema>;

export const LiveSessionPhaseSchema = z.enum([
  'draft',
  'preflight',
  'awaiting_confirmation',
  'applying_twitch',
  'preparing_obs',
  'starting_output',
  'verifying_live',
  'live',
  'rolling_back',
  'failed',
  'stopping',
  'stopped',
]);
export type LiveSessionPhase = z.infer<typeof LiveSessionPhaseSchema>;

export const LiveSessionPreflightCheckSchema = z
  .object({
    id: z.enum([
      'desktop.obs_process',
      'obs.connection',
      'obs.scene_collection',
      'obs.pre_live_scene',
      'obs.live_scene',
      'obs.required_inputs',
      'obs.output_idle',
      'twitch.connection',
      'twitch.category',
      'twitch.scopes',
    ]),
    status: z.enum(['passed', 'failed', 'warning']),
    critical: z.boolean(),
    reasonCode: z.string().min(1).max(96),
    checkedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type LiveSessionPreflightCheck = z.infer<typeof LiveSessionPreflightCheckSchema>;

export const LiveSessionExecutionReceiptSchema = z
  .object({
    receiptId: z.string().uuid(),
    step: LiveSessionStepSchema,
    status: z.enum(['running', 'verified', 'failed', 'compensated']),
    verification: z.enum(['local', 'obs', 'twitch', 'obs_and_twitch']),
    reasonCode: z.string().min(1).max(96),
    attempt: z.number().int().positive().max(10),
    startedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }).optional(),
    durationMs: z.number().int().nonnegative().max(300_000).optional(),
  })
  .strict();
export type LiveSessionExecutionReceipt = z.infer<typeof LiveSessionExecutionReceiptSchema>;

export const LiveSessionReliabilitySchema = z
  .object({
    operations: z.number().int().nonnegative(),
    verified: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    recoveries: z.number().int().nonnegative(),
    duplicatesPrevented: z.number().int().nonnegative(),
    successRate: z.number().min(0).max(1),
    p50LatencyMs: z.number().int().nonnegative(),
    p95LatencyMs: z.number().int().nonnegative(),
  })
  .strict();
export type LiveSessionReliability = z.infer<typeof LiveSessionReliabilitySchema>;

export const LiveSessionProjectionSchema = z
  .object({
    phase: LiveSessionPhaseSchema,
    reasonCode: z.string().min(1).max(96),
    updatedAt: z.string().datetime({ offset: true }),
    plan: LiveSessionPlanV1Schema.optional(),
    activeStep: LiveSessionStepSchema.optional(),
    completedSteps: z.array(LiveSessionStepSchema).max(5),
    countdownRemainingSeconds: z.number().int().nonnegative().optional(),
    obsStreamActive: z.boolean(),
    twitchLive: z.boolean(),
    liveVerified: z.boolean(),
    preflightChecks: z.array(LiveSessionPreflightCheckSchema).max(16).optional(),
    executionReceipts: z.array(LiveSessionExecutionReceiptSchema).max(32).optional(),
    reliability: LiveSessionReliabilitySchema.optional(),
  })
  .strict();
export type LiveSessionProjection = z.infer<typeof LiveSessionProjectionSchema>;

export const ChatMessageProjectionSchema = z
  .object({
    messageId: z.string().min(1).max(256),
    broadcasterId: z.string().min(1).max(128),
    userId: z.string().min(1).max(128),
    userLogin: z.string().min(1).max(80),
    userDisplayName: z.string().min(1).max(80),
    text: z.string().max(500),
    occurredAt: z.string().datetime({ offset: true }),
    roles: z
      .object({ broadcaster: z.boolean(), moderator: z.boolean(), subscriber: z.boolean() })
      .strict(),
    links: z.number().int().nonnegative().max(32),
    mentions: z.number().int().nonnegative().max(64),
  })
  .strict();
export type ChatMessageProjection = z.infer<typeof ChatMessageProjectionSchema>;

export const ChatAnalysisProjectionSchema = z
  .object({
    messageId: z.string().min(1).max(256),
    reasonCodes: z.array(z.string().min(1).max(96)).max(16),
    confidence: z.number().min(0).max(1),
    severity: z.enum(['none', 'low', 'medium', 'high']),
    suggestedAction: z.enum(['none', 'delete', 'timeout', 'ban', 'block']),
    analyzedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type ChatAnalysisProjection = z.infer<typeof ChatAnalysisProjectionSchema>;

export const ModerationIntentV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    intentId: z.string().uuid(),
    action: z.enum([
      'delete_message',
      'timeout_user',
      'ban_user',
      'unban_user',
      'block_user',
      'unblock_user',
    ]),
    targetUserId: z.string().min(1).max(128),
    targetLogin: z.string().min(1).max(80),
    messageId: z.string().min(1).max(256).optional(),
    durationSeconds: z.number().int().min(1).max(1_209_600).optional(),
    reason: z.string().trim().min(1).max(500),
    evidenceMessageId: z.string().min(1).max(256).optional(),
  })
  .strict();
export type ModerationIntentV1 = z.infer<typeof ModerationIntentV1Schema>;

export const PilotOverlayPreferencesSchema = z
  .object({
    visible: z.boolean(),
    corner: z.enum(['top_left', 'top_right', 'bottom_left', 'bottom_right']),
    scale: z.number().min(0.75).max(1.5),
    clickThrough: z.boolean(),
  })
  .strict();
export type PilotOverlayPreferences = z.infer<typeof PilotOverlayPreferencesSchema>;

export const PrepareLiveSessionPayloadSchema = z
  .object({ profile: LiveSessionProfileV1Schema, mode: LiveSessionModeSchema })
  .strict();
export const LiveSessionDecisionPayloadSchema = z
  .object({ planId: z.string().uuid(), decision: z.enum(['approve', 'deny']) })
  .strict();
export type LiveSessionDecisionPayload = z.infer<typeof LiveSessionDecisionPayloadSchema>;
export const LiveSessionEmptyPayloadSchema = z.object({}).strict();
export const LiveSessionProfilesProjectionSchema = z
  .object({
    profiles: z.array(LiveSessionProfileV1Schema).max(20),
    activeProfileId: z.string().uuid().optional(),
  })
  .strict();
export type LiveSessionProfilesProjection = z.infer<typeof LiveSessionProfilesProjectionSchema>;
export const LiveSessionOperationAcceptedSchema = z.object({ accepted: z.literal(true) }).strict();
export const ModerationCommandPayloadSchema = z
  .object({ intent: ModerationIntentV1Schema, confirmed: z.boolean() })
  .strict();
export const LiveSessionChangedEventSchema = createEventEnvelopeSchema(LiveSessionProjectionSchema);
export const ChatMessageEventSchema = createEventEnvelopeSchema(ChatMessageProjectionSchema);
export const ChatAnalysisEventSchema = createEventEnvelopeSchema(ChatAnalysisProjectionSchema);
