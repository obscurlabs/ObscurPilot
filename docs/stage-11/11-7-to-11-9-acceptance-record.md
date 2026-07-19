# Stage 11.7–11.9 Acceptance Record

Status: **automated acceptance complete; dedicated-account live gate pending**

Prepared on: 2026-07-19

## Delivered boundary

| Stage | Delivered behavior                                                                                                                                                                |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11.7  | Free offline sherpa-onnx wake boundary, checksum-pinned model installer, bounded audio pre-roll, transcript fallback, fixed OBS process/window inspection, native packaging rules |
| 11.8  | Structured preflight evidence, Twitch metadata readback, OBS scene reconciliation, verified start/stop, compensation, per-step receipts, global emergency stop                    |
| 11.9  | Bounded reliability statistics, p50/p95 latency, recovery counters, failure-injection tests, 10,000-operation performance gate, accessible assurance UI                           |

## Non-negotiable invariants

- The wake engine requires no account, API key, or cloud request.
- A missing local model never disables push-to-talk or transcript wake fallback.
- The desktop supervisor can inspect/focus only the fixed 'obs64' process. Model or voice output cannot supply a process name or script.
- Twitch metadata is not complete until the channel information endpoint returns the requested title, category, language, and tags.
- OBS scene changes are not complete until the authoritative snapshot returns the requested program scene.
- Start is not complete until OBS reports active and Twitch reports live.
- Stop is not complete until OBS recording/streaming are inactive and Twitch reports offline.
- Reliability measurements are evidence, not a marketing claim. Four-nines is not asserted by this stage.

## Automated acceptance gates

| Gate                                    | Result                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------ |
| TypeScript, ESLint, repository Prettier | Passed                                                                   |
| Unit and contract suite                 | 34 files passed; 129 tests passed                                        |
| Performance suite                       | 5/5 passed, including the bounded 10,000-operation reliability gate      |
| Chaos suite                             | 1/1 passed                                                               |
| Integration suite                       | 5 passed; the explicitly real-OBS case remains creator-observed          |
| Renderer secret-boundary scan           | Passed                                                                   |
| Production dependency audit             | 0 vulnerabilities                                                        |
| Production license allowlist            | Passed                                                                   |
| Production renderer and Electron build  | Passed                                                                   |
| Offline native model smoke              | Passed: `SHERPA_WAKE_MODEL_READY`                                        |
| Source Electron acceptance              | 2/2 passed: reload/accessibility/boundary and deterministic shutdown     |
| Windows unpacked package                | Built with the offline model and native runtime; packaged startup passed |

The source lifecycle pair passed sequentially in 12.5 seconds; native-worker shutdown completed in 3.8 seconds. These measurements are local acceptance evidence, not a universal latency or availability guarantee.

## Creator-observed acceptance

1. Start OBS with WebSocket on loopback port 4455 and connect the dedicated Twitch account.
2. Leave the control board unfocused and say “Hi Obscur, set up Sekiro and start streaming now.”
3. Verify the local wake route is shown and the Pilot transitions to listening without push-to-talk.
4. Verify Twitch title/category/tags match the requested plan and all metadata/scene/start receipts show verified.
5. Interrupt the spoken response, issue one follow-up, and verify it executes once.
6. Use 'CommandOrControl+Shift+F12'; verify ObscurPilot reports stopped only after OBS and Twitch are authoritatively offline.
7. Disconnect OBS WebSocket and Twitch once each; verify recovery never duplicates a provider mutation.

Do not mark the creator-observed gate accepted until all seven observations pass on the dedicated account.
