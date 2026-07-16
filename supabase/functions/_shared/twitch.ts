import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
} as const;

export interface TwitchTokenBundle {
  accessToken: string;
  refreshToken: string;
  scopes: string[];
  expiresAt: string;
  userId: string;
}

export function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export function serviceClient(): SupabaseClient {
  const url = requireEnv('SUPABASE_URL');
  return createClient(url, resolveServerKey(), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export async function authenticatedUserId(
  request: Request,
  client: SupabaseClient,
): Promise<string> {
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/u.exec(authorization);
  if (match === null) throw new HttpError(401, 'AUTH_REQUIRED');
  const result = await client.auth.getUser(match[1]);
  if (result.error !== null || result.data.user === null) throw new HttpError(401, 'AUTH_REQUIRED');
  return result.data.user.id;
}

export function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (value === undefined || value.length === 0)
    throw new Error('Missing server configuration: ' + name);
  return value;
}

function resolveServerKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (legacy !== undefined && legacy.length > 0) return legacy;
  const encoded = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (encoded !== undefined) {
    const parsed: unknown = JSON.parse(encoded);
    if (typeof parsed === 'object' && parsed !== null) {
      const key = Object.values(parsed).find(
        (value): value is string => typeof value === 'string' && value.startsWith('sb_secret_'),
      );
      if (key !== undefined) return key;
    }
  }
  throw new Error('No Supabase server key is available');
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return toHex(new Uint8Array(digest));
}

export async function encryptTokenBundle(bundle: TwitchTokenBundle): Promise<string> {
  validateTokenBundle(bundle);
  const key = await encryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(bundle));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, plaintext),
  );
  const envelope = new Uint8Array(1 + iv.length + encrypted.length);
  envelope[0] = 1;
  envelope.set(iv, 1);
  envelope.set(encrypted, 13);
  return '\\x' + toHex(envelope);
}

export async function decryptTokenBundle(ciphertext: string): Promise<TwitchTokenBundle> {
  const bytes = fromHex(ciphertext.replace(/^\\x/u, ''));
  if (bytes.length < 30 || bytes[0] !== 1) throw new Error('Unsupported token envelope');
  const key = await encryptionKey();
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(1, 13), tagLength: 128 },
    key,
    bytes.slice(13),
  );
  const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext));
  validateTokenBundle(parsed);
  return parsed;
}

async function encryptionKey(): Promise<CryptoKey> {
  const bytes = decodeBase64(requireEnv('TWITCH_TOKEN_ENCRYPTION_KEY'));
  if (bytes.length !== 32) throw new Error('TWITCH_TOKEN_ENCRYPTION_KEY must decode to 32 bytes');
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function exchangeAuthorizationCode(code: string): Promise<TwitchTokenBundle> {
  const clientId = requireEnv('TWITCH_CLIENT_ID');
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: requireEnv('TWITCH_CLIENT_SECRET'),
    code,
    grant_type: 'authorization_code',
    redirect_uri: requireEnv('TWITCH_REDIRECT_URI'),
  });
  const response = await fetchWithDeadline('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) throw new HttpError(502, 'TWITCH_EXCHANGE_FAILED');
  return validateAndProjectToken(await response.json(), clientId);
}

export async function refreshTokenBundle(bundle: TwitchTokenBundle): Promise<TwitchTokenBundle> {
  const clientId = requireEnv('TWITCH_CLIENT_ID');
  const response = await fetchWithDeadline('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: requireEnv('TWITCH_CLIENT_SECRET'),
      grant_type: 'refresh_token',
      refresh_token: bundle.refreshToken,
    }),
  });
  if (!response.ok)
    throw new HttpError(response.status === 400 ? 401 : 502, 'TWITCH_REFRESH_FAILED');
  return validateAndProjectToken(await response.json(), clientId);
}

async function validateAndProjectToken(raw: unknown, clientId: string): Promise<TwitchTokenBundle> {
  if (typeof raw !== 'object' || raw === null) throw new HttpError(502, 'TWITCH_TOKEN_INVALID');
  const value = raw as Record<string, unknown>;
  const accessToken = value.access_token;
  const refreshToken = value.refresh_token;
  const expiresIn = value.expires_in;
  const scopes = value.scope ?? [];
  if (
    typeof accessToken !== 'string' ||
    typeof refreshToken !== 'string' ||
    typeof expiresIn !== 'number' ||
    !Array.isArray(scopes) ||
    !scopes.every((scope) => typeof scope === 'string')
  )
    throw new HttpError(502, 'TWITCH_TOKEN_INVALID');

  const validation = await fetchWithDeadline('https://id.twitch.tv/oauth2/validate', {
    headers: { Authorization: 'OAuth ' + accessToken },
  });
  if (!validation.ok) throw new HttpError(502, 'TWITCH_TOKEN_INVALID');
  const identity = (await validation.json()) as Record<string, unknown>;
  if (identity.client_id !== clientId || typeof identity.user_id !== 'string') {
    throw new HttpError(502, 'TWITCH_IDENTITY_MISMATCH');
  }
  return {
    accessToken,
    refreshToken,
    scopes: [...new Set(scopes as string[])].sort(),
    expiresAt: new Date(Date.now() + Math.max(1, expiresIn) * 1000).toISOString(),
    userId: identity.user_id,
  };
}

export async function fetchTwitchDisplayName(bundle: TwitchTokenBundle): Promise<string> {
  const response = await fetchWithDeadline('https://api.twitch.tv/helix/users', {
    headers: {
      Authorization: 'Bearer ' + bundle.accessToken,
      'Client-Id': requireEnv('TWITCH_CLIENT_ID'),
    },
  });
  if (!response.ok) throw new HttpError(502, 'TWITCH_IDENTITY_LOOKUP_FAILED');
  const body = (await response.json()) as { data?: Array<{ id?: string; display_name?: string }> };
  const user = body.data?.[0];
  if (user?.id !== bundle.userId || typeof user.display_name !== 'string') {
    throw new HttpError(502, 'TWITCH_IDENTITY_MISMATCH');
  }
  return user.display_name.slice(0, 80);
}

export async function revokeAccessToken(accessToken: string): Promise<void> {
  await fetchWithDeadline('https://id.twitch.tv/oauth2/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: requireEnv('TWITCH_CLIENT_ID'), token: accessToken }),
  });
}

export function publicToken(bundle: TwitchTokenBundle): Record<string, unknown> {
  return {
    accessToken: bundle.accessToken,
    userId: bundle.userId,
    scopes: bundle.scopes,
    expiresAt: bundle.expiresAt,
  };
}

export class HttpError extends Error {
  public constructor(
    public readonly status: number,
    public readonly reasonCode: string,
  ) {
    super(reasonCode);
  }
}

export function safeError(error: unknown): Response {
  if (error instanceof HttpError) return json(error.status, { reasonCode: error.reasonCode });
  return json(500, { reasonCode: 'INTERNAL' });
}

async function fetchWithDeadline(input: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(input, { ...init, signal: controller.signal, redirect: 'error' });
  } finally {
    clearTimeout(timer);
  }
}

function validateTokenBundle(value: unknown): asserts value is TwitchTokenBundle {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid token bundle');
  const bundle = value as Partial<TwitchTokenBundle>;
  if (
    typeof bundle.accessToken !== 'string' ||
    bundle.accessToken.length < 16 ||
    bundle.accessToken.length > 256 ||
    typeof bundle.refreshToken !== 'string' ||
    bundle.refreshToken.length < 16 ||
    bundle.refreshToken.length > 512 ||
    typeof bundle.userId !== 'string' ||
    !/^\d{1,32}$/u.test(bundle.userId) ||
    typeof bundle.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(bundle.expiresAt)) ||
    !Array.isArray(bundle.scopes) ||
    bundle.scopes.length > 64 ||
    !bundle.scopes.every(
      (scope) => typeof scope === 'string' && /^[a-z0-9:_-]{1,128}$/u.test(scope),
    )
  )
    throw new Error('Invalid token bundle');
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toHex(value: Uint8Array): string {
  return [...value].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(value: string): Uint8Array {
  if (!/^[a-f0-9]+$/iu.test(value) || value.length % 2 !== 0) throw new Error('Invalid ciphertext');
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16));
}
