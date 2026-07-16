# Stage 7 Acceptance Record

Status: **implementation, hosted deployment, and live provider-transport gate accepted**

Recorded on: 2026-07-16

## Gate evidence

| Requirement                    | Evidence                                                                      | Result                           |
| ------------------------------ | ----------------------------------------------------------------------------- | -------------------------------- |
| OAuth state and replay defense | Random state, SHA-256 at rest, atomic pending-to-exchanging claim             | Pass by contract; pgTAP authored |
| Desktop verifier proof         | OS-encrypted verifier and server-side challenge match before consume          | Pass by contract; pgTAP authored |
| Server-only exchange           | Client Secret read only by Edge Function shared module                        | Pass                             |
| Token encryption               | Versioned AES-256-GCM envelope; private forced-RLS table                      | Pass by contract; pgTAP authored |
| Identity verification          | Twitch `/validate`, Client ID match, Helix user match, Twurple identity check | Pass live                        |
| Refresh serialization          | 30-second lease, owner UUID, expected revision, transactional rotation        | Pass by fixture; pgTAP authored  |
| Renderer isolation             | Strict projection/activity schemas and narrow preload capabilities            | Pass                             |
| Twurple integration            | `@twurple/api`, `@twurple/auth`, and `@twurple/eventsub-ws` 8.1.4             | Pass                             |
| EventSub lifecycle             | Welcome/readiness, explicit reconnect, and subscription reconciliation        | Pass live                        |
| Duplicate control              | 10-minute TTL, 10,000-entry bounded LRU plus Twurple message dedupe           | Pass                             |
| Rate control                   | Serialized Helix scheduler plus Twurple upstream rate handling                | Pass                             |
| Revocation                     | Disconnect followed by hosted status showing no account and no ciphertext     | Pass live                        |
| Secret/log boundary            | No token fields in IPC; no callback logging; renderer scan gate               | Pass                             |

## Hosted deployment and provider evidence

- Hosted migrations are synchronized through `202607160004_fix_twitch_oauth_begin_ambiguity.sql`.
- `twitch-oauth` is active with JWT verification; `twitch-oauth-callback` is active without platform JWT verification and relies on the single-use state claim.
- A fresh browser authorization completed against Twitch and returned a redacted connected account projection.
- Twurple reached `EVENTSUB_READY`; an explicit reconnect returned to the same ready state.
- Disconnect revoked the provider authorization and the authenticated hosted status returned `connected: false` with no account.
- A final fresh authorization succeeded, and the rebuilt packaged application restored `authenticated / SYNCHRONIZED` plus `connected / EVENTSUB_READY` after a complete process restart.

No live channel action was generated during this gate. Stream-online, stream-offline, and channel-update delivery therefore remain an optional operational exercise. Denied/expired/replayed state, refresh contention, duplicate floods, and rate-limit paths remain covered by contracts, fixtures, and pgTAP rather than destructive live-provider execution.

## Local verification run

- Static verification: TypeScript, ESLint, and Prettier pass.
- Unit regression: 50 tests pass across 15 files.
- Contract regression: 15 tests pass across 5 files.
- Integration: 4 pass; the real OBS fixture remains intentionally skipped when OBS is unavailable.
- Chaos and performance projects pass.
- Production build, renderer secret-boundary scan, dependency audit, and production license audit pass.
- Direct and unsigned packaged Electron smoke tests pass.
- Packaged startup/shutdown soak passes 100 consecutive cycles.
- Final unsigned packaged executable SHA-256: `AEEC865DBB0D37A2E41CE73EB60F034B53824C6E855C4DB0AEA84CB9CD006584`.
- Stage 7 pgTAP suite is authored for GitHub Actions; it was not executed locally because this workstation intentionally has no Docker runtime.
