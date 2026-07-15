# Stage 5 Acceptance Record

Status: **implementation accepted; real-OBS fixture recorded separately**

Accepted on: 2026-07-16

## Gate evidence

| Requirement    | Evidence                                                                 | Result             |
| -------------- | ------------------------------------------------------------------------ | ------------------ |
| SDK boundary   | Pinned obs-websocket-js 5.0.7 inside adapter package                     | Pass               |
| Handshake      | RPC 1 and OBS 30+ validation; mismatch fails degraded                    | Pass               |
| Authentication | Password/auth errors stop in auth_required                               | Pass               |
| Snapshot       | Parallel normalized scene, input, output, studio, collection snapshot    | Pass               |
| Ordering       | Events during sync mark dirty and force another authoritative snapshot   | Pass               |
| Reconciliation | Disconnect invalidates generation; reconnect rebuilds monotonic snapshot | Pass               |
| Command safety | Version/generation/stability preconditions before dispatch               | Pass               |
| Idempotency    | Successful command IDs return one result without duplicate RPC           | Pass               |
| Uncertainty    | Timed-out/disconnected command IDs are rejected from replay              | Pass               |
| Tool boundary  | obs.read_snapshot version 1 is observe-only; no renderer generic RPC     | Pass               |
| Real OBS       | OBS ran, but port 4455 had no listener on 2026-07-16                     | Blocked externally |

The real fixture never performs production mutations. It validates connection and snapshot against the configured loopback endpoint on port 4455.

To close the final environment gate, enable and start the OBS WebSocket server, then run the opt-in real integration suite. The deterministic adapter suite and packaged application remain valid while OBS is offline and demonstrate the intended reconnecting state.

## Verification run

- Static gate: TypeScript, ESLint, and Prettier pass.
- Deterministic integration: four OBS lifecycle/safety tests pass.
- Production build and unsigned Windows directory package pass.
- Direct and packaged dashboard E2E pass; 100 packaged startup/shutdown cycles pass.
- Visual QA artifact: artifacts/stage-5-dashboard.png.
