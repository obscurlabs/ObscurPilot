import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { config as loadDotEnv } from 'dotenv';
import { z } from 'zod';

const emptyToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);
const optionalSecret = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());
const optionalAbsolutePath = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .refine((value) => isAbsolute(value), 'Path must be absolute')
    .optional(),
);
const loopbackWebSocketUrl = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .url()
    .default('ws://127.0.0.1:4455')
    .refine((value) => {
      const url = new URL(value);
      const isLoopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
      return url.protocol === 'ws:' && isLoopback && url.username === '' && url.password === '';
    }, 'OBS_WEBSOCKET_URL must be a loopback WS URL without embedded credentials'),
);
const optionalNumber = (minimum: number, maximum: number, fallback: number) =>
  z.preprocess(
    emptyToUndefined,
    z.coerce.number().finite().min(minimum).max(maximum).default(fallback),
  );

const EnvironmentSchema = z.object({
  WAKE_WORD_ENGINE: z.preprocess(
    emptyToUndefined,
    z
      .enum(['sherpa_onnx', 'sherpa-onnx', 'transcript'])
      .default('sherpa_onnx')
      .transform((value) => (value === 'sherpa-onnx' ? 'sherpa_onnx' : value)),
  ),
  WAKE_WORD_PHRASE: z.preprocess(emptyToUndefined, z.literal('hi obscur').default('hi obscur')),
  WAKE_WORD_MODEL_DIR: optionalAbsolutePath,
  WAKE_WORD_SCORE: optionalNumber(0.1, 10, 1.5),
  WAKE_WORD_THRESHOLD: optionalNumber(0.05, 0.95, 0.35),
  WAKE_WORD_COOLDOWN_MS: optionalNumber(250, 10_000, 2_000),
  VOICE_AGENT_PROVIDER: z.preprocess(
    emptyToUndefined,
    z.enum(['deepgram', 'groq']).default('deepgram'),
  ),
  DEEPGRAM_API_KEY: optionalSecret,
  DEEPGRAM_AGENT_URL: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .url()
      .default('wss://agent.deepgram.com/v1/agent/converse')
      .refine((value) => new URL(value).protocol === 'wss:', 'Deepgram agent URL must use WSS'),
  ),
  DEEPGRAM_LISTEN_MODEL: z.preprocess(
    emptyToUndefined,
    z.enum(['flux-general-en', 'flux-general-multi', 'nova-3']).default('flux-general-en'),
  ),
  DEEPGRAM_THINK_MODEL: z.preprocess(
    emptyToUndefined,
    z.string().trim().min(1).max(128).default('gpt-4o-mini'),
  ),
  DEEPGRAM_VOICE_MODEL: z.preprocess(
    emptyToUndefined,
    z.string().trim().min(1).max(128).default('aura-2-thalia-en'),
  ),
  GROQ_API_KEY: optionalSecret,
  GROQ_STT_MODEL: z.preprocess(
    emptyToUndefined,
    z.literal('whisper-large-v3-turbo').default('whisper-large-v3-turbo'),
  ),
  GROQ_REASONING_MODEL: z.preprocess(
    emptyToUndefined,
    z.enum(['openai/gpt-oss-120b', 'qwen/qwen3.6-27b']).default('openai/gpt-oss-120b'),
  ),
  GROQ_REASONING_FALLBACK_MODEL: z.preprocess(
    emptyToUndefined,
    z.enum(['openai/gpt-oss-120b', 'qwen/qwen3.6-27b']).optional(),
  ),
  SUPABASE_URL: optionalUrl,
  SUPABASE_ANON_KEY: optionalSecret,
  TWITCH_CLIENT_ID: optionalSecret,
  TWITCH_REDIRECT_URI: optionalUrl,
  OBS_WEBSOCKET_URL: loopbackWebSocketUrl,
  OBS_WEBSOCKET_PASSWORD: optionalSecret,
  OBS_EXECUTABLE_PATH: optionalAbsolutePath,
  OBSCURPILOT_LOG_LEVEL: z
    .preprocess(emptyToUndefined, z.enum(['debug', 'info', 'warn', 'error']).optional())
    .default('info'),
  OBSCURPILOT_DEV_SERVER_URL: optionalUrl,
});

export type Environment = z.infer<typeof EnvironmentSchema>;

export function loadDevelopmentEnvironment(appPath: string, isPackaged: boolean): void {
  if (isPackaged) {
    return;
  }

  const explicitPath = process.env.OBSCURPILOT_ENV_FILE;
  const candidates = [
    explicitPath,
    resolve(appPath, '../../.env'),
    resolve(process.cwd(), '.env'),
  ].filter((candidate): candidate is string => candidate !== undefined);

  const envPath = candidates.find((candidate) => existsSync(candidate));
  if (envPath !== undefined) {
    loadDotEnv({ path: envPath, override: false, quiet: true });
  }
}

export function parseEnvironment(source: NodeJS.ProcessEnv): Environment {
  const result = EnvironmentSchema.safeParse(source);
  if (result.success) {
    return result.data;
  }

  const invalidFields = result.error.issues
    .map((issue) => issue.path.join('.'))
    .filter((field) => field.length > 0)
    .join(', ');

  throw new Error('Invalid ObscurPilot environment fields: ' + invalidFields);
}

export function getDevelopmentServerUrl(environment: Environment): URL {
  const url = new URL(environment.OBSCURPILOT_DEV_SERVER_URL ?? 'http://127.0.0.1:5173');
  const isLoopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';

  if (url.protocol !== 'http:' || !isLoopback || url.username !== '' || url.password !== '') {
    throw new Error('OBSCURPILOT_DEV_SERVER_URL must be a loopback HTTP URL');
  }

  return url;
}
