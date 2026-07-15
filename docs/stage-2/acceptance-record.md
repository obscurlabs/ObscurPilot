# Stage 2 Acceptance Record

Status: **accepted**

Accepted on: 2026-07-16

Scope: secure desktop shell and IPC spine. No provider connection or audio implementation is included.

## Gate evidence

| Requirement                            | Evidence                                                                                     | Result                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------- |
| Versioned IPC contracts                | Strict Zod request, result, event, error, bootstrap, and state schemas                       | Pass                                   |
| Closed channel surface                 | Frozen preload exposes only getBootstrap, getSnapshot, and onStateChanged                    | Pass                                   |
| Sender validation                      | Exact app host in production and exact loopback origin in development                        | Pass                                   |
| Malicious payload rejection            | Unknown fields, wrong versions, stale timestamps, oversized envelopes, and untrusted senders | Pass                                   |
| Safe public errors                     | Canonical codes and correlation IDs; no stack, SDK body, path, or secret                     | Pass                                   |
| Browser isolation                      | contextIsolation, sandbox, webSecurity, no Node integration                                  | Pass                                   |
| Renderer denial controls               | Navigation, popups, webviews, permissions, and production DevTools denied                    | Pass                                   |
| Response hardening                     | CSP, Permissions-Policy, referrer policy, nosniff, and frame denial                          | Pass                                   |
| Application protocol                   | GET-only bundle host with decoding and traversal rejection                                   | Pass                                   |
| Authoritative synchronization          | Monotonic snapshotVersion, bounded patches, and gap-triggered full resync                    | Pass                                   |
| Listener lifecycle                     | Exact wrapped-listener removal over 100 subscribe/unsubscribe cycles                         | Pass                                   |
| Renderer reload                        | Five production reloads retain only the narrow preload boundary                              | Pass                                   |
| Single-instance and shutdown lifecycle | Single-instance lock plus reverse-order idempotent disposal                                  | Pass                                   |
| Packaged lifecycle                     | 100 consecutive Windows artifact start/shutdown cycles                                       | Pass; every process exited with code 0 |

## Verification summary

- Static verification: pass
- Unit and contract suite: 11 files, 31 assertions, all pass
- Electron E2E suite: 3 tests, all pass
- Production dependency audit: 0 vulnerabilities
- Production license allowlist: pass
- Renderer secret, Node primitive, and raw IPC scan: pass
- Frontend dangerous-sink scan: pass

## Accepted artifact

- Path: artifacts/win-unpacked/ObscurPilot.exe
- Size: 225,485,824 bytes
- SHA-256: 6912D1763129242AC59AEE48B1B23E67FD125AD16DDAD52ADB55E316461EA0E7
- Status: unsigned internal smoke-test artifact; public signing and release distribution remain Stage 13.

## Boundary decision

The renderer remains disposable and untrusted. Electron main owns lifecycle and authoritative state. Preload contains no domain logic and cannot select arbitrary channels. Every request and response is schema-validated at both sides of the boundary.

Stage 2 is complete. Stage 4 must not begin until Stage 3 is also accepted.
