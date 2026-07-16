import {
  authenticatedUserId,
  decryptTokenBundle,
  encryptTokenBundle,
  HttpError,
  json,
  publicToken,
  refreshTokenBundle,
  revokeAccessToken,
  safeError,
  serviceClient,
  sha256Hex,
} from '../_shared/twitch.ts';

interface AccountRow {
  provider_user_id: string;
  display_name: string;
  scopes: string[];
  token_expires_at: string | null;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405, { reasonCode: 'METHOD_NOT_ALLOWED' });
  try {
    const client = serviceClient();
    const userId = await authenticatedUserId(request, client);
    const body: unknown = await request.json();
    if (
      typeof body !== 'object' ||
      body === null ||
      typeof (body as Record<string, unknown>).action !== 'string'
    ) {
      throw new HttpError(400, 'INVALID_REQUEST');
    }
    const input = body as Record<string, unknown>;
    switch (input.action) {
      case 'begin':
        return await begin(client, userId, input);
      case 'finalize':
        return await finalize(client, userId, input);
      case 'status':
        return await status(client, userId);
      case 'token':
        return await token(client, userId, input.forceRefresh === true);
      case 'revoke':
        return await revoke(client, userId);
      default:
        throw new HttpError(400, 'INVALID_ACTION');
    }
  } catch (error: unknown) {
    return safeError(error);
  }
});

async function begin(
  client: ReturnType<typeof serviceClient>,
  userId: string,
  input: Record<string, unknown>,
) {
  const codeChallenge = input.codeChallenge;
  if (typeof codeChallenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(codeChallenge)) {
    throw new HttpError(400, 'INVALID_CODE_CHALLENGE');
  }
  const state = randomUrlToken(32);
  const result = await client.rpc('stage7_begin_twitch_oauth', {
    p_user_id: userId,
    p_state_hash: await sha256Hex(state),
    p_code_challenge: codeChallenge,
  });
  if (result.error !== null || !Array.isArray(result.data) || result.data.length !== 1) {
    throw new HttpError(409, 'OAUTH_FLOW_CREATE_FAILED');
  }
  const row = result.data[0] as { flow_id: string; expires_at: string };
  const authorization = new URL('https://id.twitch.tv/oauth2/authorize');
  authorization.searchParams.set('response_type', 'code');
  authorization.searchParams.set('client_id', requireConfiguration('TWITCH_CLIENT_ID'));
  authorization.searchParams.set('redirect_uri', requireConfiguration('TWITCH_REDIRECT_URI'));
  authorization.searchParams.set('state', state);
  const scopes = (Deno.env.get('TWITCH_SCOPES') ?? '')
    .split(/[ ,]+/u)
    .filter((scope) => /^[a-z0-9:_-]{1,128}$/u.test(scope));
  if (scopes.length > 0) authorization.searchParams.set('scope', [...new Set(scopes)].join(' '));
  return json(200, {
    flowId: row.flow_id,
    authorizationUrl: authorization.href,
    expiresAt: row.expires_at,
  });
}

async function finalize(
  client: ReturnType<typeof serviceClient>,
  userId: string,
  input: Record<string, unknown>,
) {
  const flowId = input.flowId;
  const verifier = input.codeVerifier;
  if (
    typeof flowId !== 'string' ||
    !isUuid(flowId) ||
    typeof verifier !== 'string' ||
    !/^[A-Za-z0-9_-]{43,128}$/u.test(verifier)
  )
    throw new HttpError(400, 'INVALID_FINALIZATION');
  const challenge = base64Url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  );
  const result = await client.rpc('stage7_finalize_twitch_oauth', {
    p_user_id: userId,
    p_flow_id: flowId,
    p_code_challenge: challenge,
  });
  if (result.error !== null || !Array.isArray(result.data) || result.data.length !== 1) {
    throw new HttpError(409, 'OAUTH_FINALIZATION_REJECTED');
  }
  return json(200, accountResponse(result.data[0] as AccountRow));
}

async function status(client: ReturnType<typeof serviceClient>, userId: string) {
  const result = await client.rpc('stage7_get_twitch_status', { p_user_id: userId });
  if (result.error !== null) throw new HttpError(502, 'TWITCH_STATUS_FAILED');
  if (!Array.isArray(result.data) || result.data.length === 0) {
    return json(200, { connected: false, reasonCode: 'NOT_CONNECTED' });
  }
  return json(200, accountResponse(result.data[0] as AccountRow));
}

async function token(
  client: ReturnType<typeof serviceClient>,
  userId: string,
  forceRefresh: boolean,
) {
  let row = await getTokenRow(client, userId);
  let bundle = await decryptTokenBundle(row.ciphertext);
  if (bundle.userId.length === 0) throw new HttpError(401, 'TWITCH_TOKEN_INVALID');
  if (forceRefresh || Date.parse(bundle.expiresAt) <= Date.now() + 90_000) {
    const leaseOwner = crypto.randomUUID();
    const claim = await client.rpc('stage7_claim_twitch_refresh', {
      p_user_id: userId,
      p_lease_owner: leaseOwner,
    });
    if (claim.error !== null) throw new HttpError(502, 'TWITCH_REFRESH_LEASE_FAILED');
    if (!Array.isArray(claim.data) || claim.data.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      row = await getTokenRow(client, userId);
      bundle = await decryptTokenBundle(row.ciphertext);
      if (Date.parse(bundle.expiresAt) <= Date.now() + 30_000)
        throw new HttpError(409, 'TWITCH_REFRESH_IN_PROGRESS');
    } else {
      const claimed = claim.data[0] as { ciphertext: string; token_revision: number };
      const refreshed = await refreshTokenBundle(await decryptTokenBundle(claimed.ciphertext));
      const complete = await client.rpc('stage7_complete_twitch_refresh', {
        p_user_id: userId,
        p_lease_owner: leaseOwner,
        p_expected_revision: claimed.token_revision,
        p_ciphertext: await encryptTokenBundle(refreshed),
        p_key_version: 1,
        p_expires_at: refreshed.expiresAt,
        p_scopes: refreshed.scopes,
      });
      if (complete.error !== null || complete.data !== true)
        throw new HttpError(409, 'TWITCH_REFRESH_CONFLICT');
      bundle = refreshed;
    }
  }
  return json(200, publicToken(bundle));
}

async function revoke(client: ReturnType<typeof serviceClient>, userId: string) {
  try {
    const row = await getTokenRow(client, userId);
    const bundle = await decryptTokenBundle(row.ciphertext);
    await revokeAccessToken(bundle.accessToken);
  } catch {
    // Local revocation remains mandatory even when Twitch is unavailable or already revoked.
  }
  const result = await client.rpc('stage7_revoke_twitch', { p_user_id: userId });
  if (result.error !== null) throw new HttpError(502, 'TWITCH_DISCONNECT_FAILED');
  return json(200, { connected: false, reasonCode: 'DISCONNECTED' });
}

async function getTokenRow(client: ReturnType<typeof serviceClient>, userId: string) {
  const result = await client.rpc('stage7_get_twitch_token', { p_user_id: userId });
  if (result.error !== null || !Array.isArray(result.data) || result.data.length !== 1) {
    throw new HttpError(401, 'TWITCH_AUTH_REQUIRED');
  }
  return result.data[0] as {
    ciphertext: string;
    token_revision: number;
    expires_at: string | null;
  };
}

function accountResponse(row: AccountRow): Record<string, unknown> {
  return {
    connected: true,
    reasonCode: 'CONNECTED',
    account: {
      providerUserId: row.provider_user_id,
      displayName: row.display_name,
      scopes: row.scopes,
      ...(row.token_expires_at === null ? {} : { tokenExpiresAt: row.token_expires_at }),
    },
  };
}

function randomUrlToken(bytes: number): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function base64Url(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function requireConfiguration(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (value === undefined || value.length === 0) throw new Error('Missing server configuration');
  return value;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
