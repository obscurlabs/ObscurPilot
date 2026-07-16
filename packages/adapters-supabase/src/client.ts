import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.js';

export interface AsyncAuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface SupabaseClientConfig {
  readonly url: string;
  readonly publishableKey: string;
  readonly storage: AsyncAuthStorage;
  readonly appVersion: string;
}

export type StagePilotSupabaseClient = SupabaseClient<Database>;

export function createStagePilotSupabaseClient(
  config: SupabaseClientConfig,
): StagePilotSupabaseClient {
  assertAllowedEndpoint(config.url);
  assertPublishableKey(config.publishableKey);

  return createClient<Database>(config.url, config.publishableKey, {
    auth: {
      storage: config.storage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
    global: {
      fetch: deadlineFetch,
      headers: {
        'X-Client-Info': 'obscurpilot-desktop/' + config.appVersion,
      },
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
      reconnectAfterMs: (attempt: number) => Math.min(30_000, 500 * 2 ** Math.min(attempt, 6)),
    },
  });
}

const NETWORK_DEADLINE_MS = 15_000;

async function deadlineFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(init?.signal?.reason);
  if (init?.signal?.aborted === true) onAbort();
  else init?.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error('Cloud request timed out')),
    NETWORK_DEADLINE_MS,
  );
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener('abort', onAbort);
  }
}

function assertAllowedEndpoint(value: string): void {
  const url = new URL(value);
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (
    url.username !== '' ||
    url.password !== '' ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
  ) {
    throw new Error('Supabase URL must be HTTPS or a loopback development URL');
  }
}

function assertPublishableKey(value: string): void {
  if (value.startsWith('sb_secret_') || value.length > 8192) {
    throw new Error('A Supabase publishable/anonymous key is required');
  }
  const parts = value.split('.');
  if (parts.length !== 3) return;
  try {
    const encoded = (parts[1] ?? '').replaceAll('-', '+').replaceAll('_', '/');
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    const payload = JSON.parse(globalThis.atob(padded)) as {
      role?: unknown;
    };
    if (payload.role === 'service_role' || payload.role === 'supabase_admin') {
      throw new Error('A Supabase service key cannot be used by the desktop runtime');
    }
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('service key')) throw error;
  }
}
