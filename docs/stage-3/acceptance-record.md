# Stage 3 Acceptance Record

Status: **accepted**

Accepted on: 2026-07-16

Scope: SDK-independent domain kernel and connection supervision. OBS, Twitch, Supabase, and Groq SDK behavior remains in later stages.

## Gate evidence

| Requirement                    | Evidence                                                                     | Result |
| ------------------------------ | ---------------------------------------------------------------------------- | ------ |
| Legal connection transitions   | Exhaustive property-style matrix over every phase pair                       | Pass   |
| Illegal connection transitions | Every non-allowlisted phase pair throws before mutation                      | Pass   |
| Single-flight supervision      | Concurrent start calls share one active handshake                            | Pass   |
| Handshake sequencing           | connect, authenticate, synchronize, ready order asserted                     | Pass   |
| Authentication classification  | Auth failure enters auth_required without retry                              | Pass   |
| Generation cancellation        | Shutdown aborts and discards the active generation                           | Pass   |
| Full-jitter backoff            | Fake-random tests prove 500 ms base and 30 second cap                        | Pass   |
| Timer cancellation             | Fake-clock test proves abort removes the pending timer                       | Pass   |
| Circuit breaker                | Five failures in 30 seconds open; 20-second probe delay; two successes close | Pass   |
| Monotonic snapshots            | Every mutation increments exactly once                                       | Pass   |
| Gap synchronization            | Missing version returns resync_required; stale versions are ignored          | Pass   |
| Command idempotency            | Concurrent and completed duplicates execute one operation                    | Pass   |
| Event lifecycle                | Exact unsubscribe and zero remaining listener count                          | Pass   |
| Authorization policy           | Grant, expiry, scope, risk, and confirmation enforced                        | Pass   |
| Compiled tool registry         | Exact name/version lookup, strict parsing, authorization before execution    | Pass   |
| Bounded reasoning loop         | Turn, call, wall-clock, and argument-byte ceilings asserted                  | Pass   |
| Activity normalization         | Field lengths and metadata cardinality bounded                               | Pass   |
| Durable persistence boundary   | Abortable durable-outbox interface compiled                                  | Pass   |

## Kernel defaults

- Backoff: 500 ms base, 30 second cap, 8 attempts, full jitter
- Circuit breaker: 5 qualifying failures in 30 seconds, 20-second open interval, 2 successful probes
- Command ledger: 24-hour TTL, 10,000 entries
- Tool loop: 4 turns, 6 calls, 15 seconds, 32 KiB arguments
- Activity metadata: 16 entries; source/type 64 characters; summary 500 characters

## Architectural decision

The domain package imports contracts but does not import Electron or provider SDKs. State machines, retry timing, policies, idempotency, and tool limits are deterministic and injectable, allowing later adapters to be tested without network access.

Stages 2 and 3 are complete. The repository must remain at this boundary until the user explicitly authorizes Stage 4.
