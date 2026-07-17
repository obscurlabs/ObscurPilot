# Stage 11 Acceptance Record

Status: **local implementation accepted; dedicated-account live gate pending**

Prepared on: 2026-07-17

## Implemented evidence

| Requirement           | Evidence                                                                                                                                            | Result |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Versioned contracts   | Live-session profile, plan, projection, chat, analysis, moderation, and overlay schemas                                                             | Pass   |
| Durable orchestration | Preflight, immutable 60-second plan, explicit approval, compensation, verification, stop, and emergency stop                                        | Pass   |
| Dry-run isolation     | Local recording replaces streaming and Twitch mutation                                                                                              | Pass   |
| OBS supervision       | Existing-process detection, allowlisted executable path, one process, handshake wait, and command IDs                                               | Pass   |
| Twitch transport      | Category search/ID validation, metadata read/write, online verification, EventSub chat, moderation, block, and chat send                            | Pass   |
| Voice tools           | Profile prepare/start/stop plus exact Stage 11 Twitch update, chat, moderation, block, and unblock tools                                            | Pass   |
| Chat boundary         | Message-ID deduplication, bounded memory, Unicode/control normalization, burst/link/mention rules, and redacted model targets                       | Pass   |
| Moderation safety     | Immutable ID/login reconciliation, evidence match, broadcaster protection, idempotency, and explicit confirmation                                   | Pass   |
| Control board         | Saved profiles, dry-run/live split, plan hash/checklist, authoritative state, abort controls, category resolver, review queue, and overlay settings | Pass   |
| Pilot overlay         | Transparent always-on-top click-through window, capture protection, state motion, reduced motion, and native speech feedback                        | Pass   |
| Hosted policy         | Migration 202607170001 deployed and Stage 11 grants applied to existing creator profiles                                                            | Pass   |

## Programmatic gates

| Gate                         | Result                                                  |
| ---------------------------- | ------------------------------------------------------- |
| TypeScript, ESLint, Prettier | Pass                                                    |
| Unit tests                   | 88/88 pass                                              |
| Stage 11 safety tests        | 4/4 pass                                                |
| Production build             | Pass; main renderer, audio capture, and overlay bundled |
| Electron preload boundary    | Pass                                                    |
| Hosted migration ledger      | Local and remote both record 202607170001               |

## Dedicated Twitch and OBS acceptance gate

This final gate is intentionally creator-observed because it changes real provider state.

1. Disconnect and reconnect Twitch once so the newly enabled scopes are present on the token.
2. Verify OBS WebSocket is enabled on loopback port 4455 and the profile scenes/inputs exist.
3. Create a profile and use **Resolve category ID** to select the exact Helix category.
4. Run **Dry run** first. Confirm OBS records, shows the starting scene/countdown, changes to the live scene, and never starts streaming or mutates Twitch.
5. Stop the recording and inspect it.
6. Change the same profile to **Live**, run preflight, verify the plan hash and planned metadata, then approve.
7. Verify OBS stream active and Twitch online are both authoritative before the UI reports **live**.
8. Send a test chat message from a dedicated viewer and verify ingestion plus creator-confirmed delete, timeout, unban, block, and unblock.
9. Stop through ObscurPilot and verify OBS and Twitch return offline.

Stage 11 becomes fully accepted only when all nine observations pass on the dedicated Twitch account. A creator account must not be used before that gate.
