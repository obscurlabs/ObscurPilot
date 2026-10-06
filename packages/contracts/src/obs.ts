import { z } from 'zod';

export const ObsSceneSchema = z
  .object({ name: z.string().min(1).max(512), index: z.number().int().nonnegative() })
  .strict();
export const ObsInputSchema = z
  .object({ name: z.string().min(1).max(512), kind: z.string().min(1).max(256) })
  .strict();

export const ObsSnapshotSchema = z
  .object({
    snapshotVersion: z.number().int().nonnegative(),
    generation: z.number().int().nonnegative(),
    capturedAt: z.string().datetime({ offset: true }),
    obsVersion: z.string().min(1),
    webSocketVersion: z.string().min(1),
    rpcVersion: z.number().int().positive(),
    sceneCollectionName: z.string().max(512),
    currentProgramSceneName: z.string().max(512),
    currentPreviewSceneName: z.string().max(512).nullable(),
    studioModeEnabled: z.boolean(),
    streamActive: z.boolean(),
    recordActive: z.boolean(),
    scenes: z.array(ObsSceneSchema).max(1_000),
    inputs: z.array(ObsInputSchema).max(5_000),
  })
  .strict();
export type ObsSnapshot = z.infer<typeof ObsSnapshotSchema>;

export const ObsProjectionSchema = z
  .object({
    available: z.boolean(),
    snapshot: ObsSnapshotSchema.optional(),
    reasonCode: z.string().min(1),
  })
  .strict();
export type ObsProjection = z.infer<typeof ObsProjectionSchema>;

export const GetObsSnapshotPayloadSchema = z.object({}).strict();
export const ReconnectObsPayloadSchema = z.object({}).strict();

/** One-click OBS setup: each step the assistant took, so the UI can show what happened. */
export const ObsConnectStepSchema = z
  .object({
    label: z.string().min(1).max(80),
    status: z.enum(['done', 'failed', 'skipped']),
    detail: z.string().max(300).optional(),
  })
  .strict();
export type ObsConnectStep = z.infer<typeof ObsConnectStepSchema>;

export const ObsConnectResultSchema = z
  .object({ connected: z.boolean(), steps: z.array(ObsConnectStepSchema).max(8) })
  .strict();
export type ObsConnectResult = z.infer<typeof ObsConnectResultSchema>;
