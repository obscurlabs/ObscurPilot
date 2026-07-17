# Stage 7: Twitch OAuth, Helix, and EventSub

Status: implementation, hosted Supabase deployment, and Twitch provider-transport acceptance complete.

- [Acceptance record](acceptance-record.md)

## Delivered boundary

- Electron initiates authorization but never receives the Twitch Client Secret or refresh token.
- `twitch-oauth-callback` performs the authorization-code exchange on hosted Supabase, validates the returned token against Twitch, resolves the Twitch identity, encrypts the token bundle with AES-256-GCM, and stores only ciphertext in `private.oauth_token_secrets`.
- A random OAuth `state` is hashed at rest and can be claimed only once. Electron additionally holds a random verifier in an OS-encrypted file; the callback result cannot be finalized without its SHA-256 challenge match.
- `twitch-oauth` requires a valid Supabase user JWT for begin, finalize, status, delegated-token, and revoke operations. Its service-only SQL functions are revoked from `public`, `anon`, and `authenticated`.
- Refresh rotation uses a 30-second database lease plus an expected token revision. Concurrent callers cannot refresh the same account simultaneously.
- Electron receives only a short-lived access token in main-process memory. A custom Twurple `AuthProvider` never exposes a refresh token and coalesces concurrent credential acquisition.
- `ApiClient` verifies the connected Twitch identity. `EventSubWsListener` owns the WebSocket lifecycle and reconciles baseline provider-level subscriptions after reconnect.
- Activity is normalized through strict Zod contracts, bounded before IPC, and protected by a 10-minute/10,000-entry TTL/LRU dedupe cache.
- Renderer APIs expose only redacted account state, connect/disconnect/reconnect commands, and normalized activity. Raw EventSub payloads and credentials cannot cross IPC.

## Hosted configuration

Root desktop `.env`:

```env
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=sb_publishable_...
TWITCH_CLIENT_ID=...
TWITCH_REDIRECT_URI=https://PROJECT_REF.supabase.co/functions/v1/twitch-oauth-callback
```

Hosted Supabase Edge Function secrets/configuration:

```env
TWITCH_CLIENT_ID=...
TWITCH_CLIENT_SECRET=...
TWITCH_REDIRECT_URI=https://PROJECT_REF.supabase.co/functions/v1/twitch-oauth-callback
TWITCH_COMPLETION_URI=obscurpilot://oauth/twitch/callback
TWITCH_TOKEN_ENCRYPTION_KEY=<base64-encoded 32 random bytes>
TWITCH_SCOPES=channel:manage:broadcast channel:moderate moderator:manage:banned_users moderator:manage:chat_messages user:manage:blocked_users user:read:chat user:write:chat
```

Never place the Client Secret, encryption key, service-role key, access token, or refresh token in the root desktop `.env`.

## Hosted deployment sequence

1. Register the exact HTTPS callback in the Twitch Developer Console.
2. `npx supabase link --project-ref <project-ref>`
3. `npx supabase db push --dry-run`
4. `npx supabase db push`
5. Add the Stage 7 values through Supabase Dashboard Edge Function secrets or `npx supabase secrets set --env-file <private-file>`.
6. `npx supabase functions deploy twitch-oauth`
7. `npx supabase functions deploy twitch-oauth-callback --no-verify-jwt`
8. Sign into ObscurPilot's Supabase account, connect a dedicated Twitch test account, and execute the live acceptance matrix.

The callback is intentionally the only function deployed without platform JWT verification. It authorizes requests using a single-use, expiring, hashed state before making any Twitch exchange. All other Twitch function actions require Supabase authentication.

## Hosted acceptance result

On 2026-07-16, the hosted project accepted a fresh Twitch authorization, validated the Twitch identity, established Twurple EventSub readiness, survived an explicit reconnect, revoked and removed the hosted token ciphertext on disconnect, and reconnected through a new authorization. A rebuilt packaged desktop then restored its OS-encrypted Supabase and Twitch state after a complete process restart as `authenticated / SYNCHRONIZED` and `connected / EVENTSUB_READY` without another login prompt.

This proves the hosted OAuth and EventSub transport boundary. No stream-online, stream-offline, or channel-update action was generated during the gate, so delivery of a real channel event remains a separate operational exercise rather than a Stage 7 transport blocker.

## Verification commands

```powershell
npm run verify:static
npm run test:unit
npm run test:contract
npm run test:integration
npm run test:chaos
npm run test:performance
npm run build
npm run verify:renderer-boundary
```

The GitHub Actions Supabase job applies both Stage 6 and Stage 7 migrations and runs `stage7_twitch_oauth.test.sql` without requiring Docker on the developer workstation.
