import { z } from 'zod';
import { createRequestEnvelopeSchema, IPC_CHANNELS } from './ipc.js';

export const APP_GET_BOOTSTRAP_CHANNEL = IPC_CHANNELS.getBootstrap;
export const GetBootstrapPayloadSchema = z.object({}).strict();
export const GetBootstrapRequestSchema = createRequestEnvelopeSchema(GetBootstrapPayloadSchema);

export const BootstrapProjectionSchema = z
  .object({
    protocolVersion: z.literal(1),
    app: z
      .object({
        name: z.literal('ObscurPilot'),
        version: z.string().min(1),
      })
      .strict(),
    runtime: z
      .object({
        platform: z.enum(['win32', 'darwin', 'linux']),
        electron: z.string().min(1),
        chrome: z.string().min(1),
        node: z.string().min(1),
      })
      .strict(),
    configuration: z
      .object({
        groqConfigured: z.boolean(),
        supabaseConfigured: z.boolean(),
        twitchConfigured: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type BootstrapProjection = z.infer<typeof BootstrapProjectionSchema>;
