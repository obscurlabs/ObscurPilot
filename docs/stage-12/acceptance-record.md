# Stage 12 Acceptance Record

Status: **automated acceptance complete; creator-observed pairing gate pending**

Prepared on: 2026-07-19

## Delivered boundary

- Supabase account, Twitch OAuth, and local OBS are projected as an ordered first-run state machine.
- Twitch remains browser OAuth; no Twitch credential field exists in the renderer.
- OBS is fixed to a validated loopback WebSocket endpoint, normally 'ws://127.0.0.1:4455'.
- The optional OBS password crosses one schema-bounded invoke request into Electron main and is never returned.
- Electron tests the candidate with the real OBS handshake and synchronized snapshot before storing it.
- Accepted passwords are stored only in the Electron 'safeStorage'-encrypted settings file.
- Failed replacements compensate back to the prior working password and leave persisted state unchanged.
- Creators can forget or replace pairing without restarting ObscurPilot.
- The setup workspace is dismissible, keyboard accessible, responsive, reduced-motion safe, and uses inline announced feedback.

## Security invariants

1. The renderer cannot choose a remote OBS host, executable, process, or script.
2. Pairing payloads reject unknown fields and passwords over 256 characters.
3. Password-backed pairing is refused when operating-system encryption is unavailable.
4. Onboarding projections contain only readiness, reason codes, the loopback endpoint, and 'passwordStored'.
5. Twitch OAuth tokens remain in the encrypted cloud/desktop boundary established by Stage 7.
6. Environment-based OBS passwords remain a development migration fallback, not public onboarding.

## Automated acceptance

- TypeScript and ESLint: passed.
- Complete unit and contract suite: 37 files passed; 136 tests passed.
- Performance suite: 5/5 passed.
- Chaos suite: 1/1 passed.
- OBS integration: 6 passed; one explicitly real-OBS case skipped for creator observation.
- Production build: passed.
- Renderer secret-boundary scan: passed.
- Production dependency audit: zero vulnerabilities.
- Production license allowlist: passed.
- Source Electron UI/security/accessibility/reload test: passed.
- Deterministic Electron shutdown test: passed in 3.9 seconds.
- Final source and unpacked Windows Electron acceptance: 3/3 passed.
- Windows unpacked artifact rebuilt from the accepted source and started successfully.

## Creator-observed acceptance

1. Remove 'OBS_WEBSOCKET_PASSWORD' from the local development environment.
2. Start OBS with WebSocket enabled on loopback port 4455.
3. Start ObscurPilot and confirm the setup workspace selects the correct next incomplete step.
4. Sign in, select 'Connect with Twitch', approve in the browser, and confirm the application returns connected without token entry.
5. Enter the OBS WebSocket password once; confirm testing completes and OBS becomes ready.
6. Restart ObscurPilot; confirm OBS reconnects without asking for the password.
7. Select 'Forget password'; confirm the encrypted value is removed and an authenticated OBS instance returns to 'auth required'.
8. Enter an incorrect replacement; confirm it is rejected and the previous stored working password remains authoritative.

Do not mark the creator-observed gate accepted until all eight observations pass on the release account and local OBS instance.
