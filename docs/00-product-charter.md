# Product Charter

## 1. Mission

ObscurPilot provides one deterministic control plane over local production software, remote live-platform events, speech input, AI-assisted intent planning, and durable creator configuration. The primary optimization target is dependable command completion with minimal perceived latency, not unrestricted agent autonomy.

## 2. Product boundary

The platform contains only reusable infrastructure:

- push-to-talk audio acquisition and transcription;
- intent planning through a constrained tool catalog;
- policy-controlled local and remote command execution;
- OBS connectivity and state mirroring;
- Twitch authentication, Helix operations, and EventSub ingestion;
- profile-driven OBS/Twitch live-session preparation, confirmation, execution, verification, stop, and rollback;
- bounded Twitch chat ingestion/analysis plus explicit creator-controlled delete, timeout, ban/unban, and personal block/unblock operations;
- Supabase identity, persistence, synchronization, and audit data;
- desktop control surfaces, connection health, activity history, and feedback;
- packaging, diagnostics, release, rollback, and support tooling.

Specific creative routines, consumer scripts, and hard-coded production workflows are explicitly outside the core. They may later be expressed as data-driven profiles against stable tool contracts.

## 3. Success measures

| Measure                                                |                      Release target |
| ------------------------------------------------------ | ----------------------------------: |
| Push-to-talk release to transcription request dispatch |                       p95 <= 120 ms |
| Valid intent to local OBS RPC dispatch                 |                        p95 <= 50 ms |
| Renderer interaction response                          |                       p95 <= 100 ms |
| Activity timeline update after local event receipt     |                       p95 <= 150 ms |
| Cold application start on reference hardware           |                          p95 <= 4 s |
| Renderer long-task budget                              | no task > 50 ms during steady state |
| Crash-free desktop sessions                            |                            >= 99.5% |
| Duplicate execution under retry/reconnect testing      |                                   0 |
| Moderation action applied to the wrong provider user   |                                   0 |
| Permanent ban/personal block without explicit approval |                                   0 |
| Secret exposure in renderer/log fixtures               |                                   0 |

Network-dependent Groq and Twitch end-to-end latency is measured separately from local overhead.

## 4. Trust boundaries

1. **Renderer boundary:** displays projections and sends allowlisted requests; considered attacker-controlled.
2. **Preload boundary:** exposes a frozen, narrow, typed `window.obscurPilot` API through `contextBridge`.
3. **Main-process boundary:** owns credentials, native capabilities, service lifecycles, policy checks, and command execution.
4. **Local-network boundary:** OBS WebSocket is authenticated even on loopback and never exposed to the renderer.
5. **Internet boundary:** Groq, Twitch, and Supabase traffic uses TLS, strict timeouts, sanitized telemetry, and explicit retry policies.
6. **Cloud tenant boundary:** Supabase RLS derives ownership from `auth.uid()`; client-supplied user identifiers are never trusted for authorization.

## 5. Non-functional rules

- TypeScript uses `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`.
- Runtime schemas are defined once with Zod and shared by IPC, tool calls, persistence adapters, and tests.
- All timestamps use UTC ISO-8601 at boundaries and `timestamptz` in PostgreSQL.
- IDs are UUIDv7 where locally ordered IDs are useful; database-generated UUIDs are acceptable where ordering is irrelevant.
- Logs are structured JSON and redact credentials, audio, authorization headers, transcript content by default, and sensitive tool arguments.
- Domain code depends on interfaces; SDK-specific code remains in adapters.
- No cloud call occurs synchronously inside an OBS callback or renderer paint-critical path.
