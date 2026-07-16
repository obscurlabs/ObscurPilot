import {
  encryptTokenBundle,
  exchangeAuthorizationCode,
  fetchTwitchDisplayName,
  HttpError,
  safeError,
  serviceClient,
  sha256Hex,
} from '../_shared/twitch.ts';

Deno.serve(async (request) => {
  if (request.method !== 'GET') return safeError(new HttpError(405, 'METHOD_NOT_ALLOWED'));
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (
      code === null ||
      !/^[A-Za-z0-9_-]{8,512}$/u.test(code) ||
      state === null ||
      !/^[A-Za-z0-9_-]{32,128}$/u.test(state)
    )
      throw new HttpError(400, 'INVALID_CALLBACK');

    const client = serviceClient();
    const claim = await client.rpc('stage7_claim_twitch_oauth_callback', {
      p_state_hash: await sha256Hex(state),
    });
    if (claim.error !== null || !Array.isArray(claim.data) || claim.data.length !== 1) {
      throw new HttpError(409, 'OAUTH_STATE_REJECTED');
    }
    const flow = claim.data[0] as { flow_id: string; user_id: string };
    const bundle = await exchangeAuthorizationCode(code);
    const displayName = await fetchTwitchDisplayName(bundle);
    const complete = await client.rpc('stage7_complete_twitch_oauth', {
      p_flow_id: flow.flow_id,
      p_user_id: flow.user_id,
      p_provider_user_id: bundle.userId,
      p_display_name: displayName,
      p_scopes: bundle.scopes,
      p_ciphertext: await encryptTokenBundle(bundle),
      p_key_version: 1,
      p_expires_at: bundle.expiresAt,
    });
    if (complete.error !== null) throw new HttpError(409, 'OAUTH_COMPLETION_FAILED');

    const completion = new URL(
      Deno.env.get('TWITCH_COMPLETION_URI') ?? 'obscurpilot://oauth/twitch/callback',
    );
    if (completion.protocol !== 'obscurpilot:' || completion.hostname !== 'oauth') {
      throw new Error('Invalid completion URI configuration');
    }
    completion.searchParams.set('flow_id', flow.flow_id);
    return Response.redirect(completion.href, 303);
  } catch (error: unknown) {
    return safeError(error);
  }
});
