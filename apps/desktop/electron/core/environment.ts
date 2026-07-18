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

const EnvironmentSchema = z.object({
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
