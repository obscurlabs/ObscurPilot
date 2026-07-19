# Stage 11.2–11.6 Acceptance Record

Status: **automated and hosted handshake gates accepted; creator-observed live broadcast pending**

Prepared on: 2026-07-19

## Delivered boundary

| Stage | Delivered behavior                                                                                                                                                                                            |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11.2  | Main-process Deepgram WebSocket, strict Welcome/SettingsApplied handshake, continuous 16 kHz PCM input, 24 kHz PCM output, keep-alive, timeout, exponential reconnect, Groq fallback                          |
| 11.3  | Streamed playback, immediate barge-in cancellation, bounded reconnect context, natural follow-ups, transcript and latency projection                                                                          |
| 11.4  | Existing Tool Registry ingestion, exact name/version resolution, 90-second deadline, 128-entry duplicate receipt cache, correlated cloud success/failure audits                                               |
| 11.5  | One-call compound `live_session_auto_prepare_v1` route, zero countdown by default, Twitch category resolution, model-generated metadata, OBS provisioning, profile persistence, truthful coordinator response |
| 11.6  | Deepgram configuration tile, realtime route/task/latency telemetry, expanded corner Pilot states, reduced-motion-compatible state animation, protocol and projection tests                                    |

## Security and execution invariants

- `DEEPGRAM_API_KEY` is parsed only by Electron main and is never included in preload, IPC, bootstrap, logs, or renderer bundles.
- Microphone samples remain memory-only. The realtime path sends raw PCM only after `SettingsApplied`; the fallback path keeps the existing in-memory WAV zeroization.
- Deepgram receives model-facing descriptors, but all effects execute locally through the existing parsers, grants, OBS/Twitch adapters, immutable coordinator, and authoritative snapshots.
- A duplicate Deepgram function-call ID returns the cached correlated result and never repeats the provider effect.
- The creator's spoken command authorizes its exact requested action. It does not grant a wider tool scope or allow the model to invent success.
- Socket loss stops agent playback, disables realtime routing, restores Groq clip fallback, and retries at 500 ms exponential intervals capped at 10 seconds with jitter.

## Verification evidence

| Gate                                                   | Result                                            |
| ------------------------------------------------------ | ------------------------------------------------- |
| TypeScript project build                               | Pass                                              |
| ESLint, zero warnings                                  | Pass                                              |
| Focused realtime tests                                 | 8/8 pass                                          |
| Complete unit suite                                    | 104/104 pass                                      |
| Contract suite                                         | 18/18 pass                                        |
| Electron main/preload/audio bundles                    | Pass                                              |
| Vite control board/audio/overlay build                 | Pass                                              |
| Electron direct-build and unpacked-artifact E2E        | 3/3 pass                                          |
| Hosted Deepgram key and settings handshake             | `DEEPGRAM_SETTINGS_APPLIED_WS_8_21_1`             |
| Dependency production audit                            | Pass; 0 vulnerabilities after `ws` 8.21.1 upgrade |
| Production license allowlist                           | Pass                                              |
| Renderer secret-boundary scan                          | Pass                                              |
| Creator microphone, OBS, and dedicated Twitch live run | Pending; intentionally not automated              |

The repository-wide Prettier check currently reports ten pre-existing files outside this change set. Every Stage 11.2–11.6 file was formatted directly; TypeScript and ESLint passed across the full repository.

## Creator-observed acceptance command

With OBS WebSocket on `ws://127.0.0.1:4455`, Twitch showing Ready, and the Deepgram tile configured:

1. Start ObscurPilot and leave the corner Pilot visible.
2. Say: “Hi Obscur. Set up Sekiro, create the best title and tags, and start streaming now.”
3. Verify the Pilot transitions listening → thinking → applying task → speaking and never asks for a timer.
4. Verify Twitch category/title/tags and OBS scenes are prepared; the live scene starts without a countdown.
5. Interrupt the spoken response and verify playback stops immediately and the Pilot listens to the follow-up.
6. Say: “Stop the stream.” Verify OBS reports output offline and Twitch reconciles offline before completion is spoken.

Do not mark the final live gate accepted until those observations pass on the dedicated Twitch account.
