# Stage 6 Acceptance Record

Status: **implementation accepted; live local-database gate blocked because the Docker CLI/runtime is not installed**

Recorded on: 2026-07-16

## Gate evidence

| Requirement             | Evidence                                                                            | Result                         |
| ----------------------- | ----------------------------------------------------------------------------------- | ------------------------------ |
| Client boundary         | Supabase JS 2.110.6 is composed only in Electron main                               | Pass                           |
| Session custody         | OS encryption, atomic writes, strict parsing, corruption quarantine                 | Pass                           |
| Device identity         | Stable encrypted public UUID and authenticated tenant upsert                        | Pass                           |
| Relational model        | 15 application/private tables with tenant-first indexes and composite FKs           | Pass                           |
| RLS                     | Forced RLS plus own-row policies; private tables have no authenticated grants       | Implemented; pgTAP pending     |
| Conflicts               | Expected revision produces zero-row conflict; deterministic fixture supplied        | Pass (contract); pgTAP pending |
| Idempotency             | Advisory transaction lock plus stored input hash/result by user and mutation UUID   | Pass (contract); pgTAP pending |
| Offline sync            | Ordered encrypted outbox; scheduled retry, lost-response, conflict, and bound tests | Pass                           |
| Realtime                | Cleanup, stale-callback rejection, catch-up-first readiness, reconnect on failure   | Pass                           |
| Retention               | Bounded purge RPC invoked by the daily server-only worker                           | Pass                           |
| Deletion                | Delayed request, atomic leased claims, retry backoff, and expired-lease recovery    | Pass (contract); pgTAP pending |
| Secret isolation        | Reproducible renderer scan plus packaged boundary smoke tests                       | Pass                           |
| Clean/upgrade migration | Baseline-to-Stage-6 and clean-replay CI gates; Docker unavailable locally           | Blocked externally             |

## Verification run

- Static verification: TypeScript, ESLint, and Prettier pass.
- Regression: 55 unit/contract tests pass across 17 files.
- Cloud chaos: lost-response-after-commit replay applies one side effect.
- Cloud performance: the maximum 512-entry outbox enqueues and drains in 1.43 seconds on this machine.
- Integration: 4 tests pass; 1 real-OBS fixture remains intentionally skipped when OBS is unavailable.
- Database: 90 RLS assertions plus idempotency and deletion-lease suites are authored; execution awaits Docker.
- Desktop: direct production and unsigned packaged smoke tests pass.
- Stability: 100 packaged startup/shutdown cycles pass.
- Production build and unsigned Windows directory package pass.
- Renderer secret-boundary scan passes.
- Packaged executable SHA-256: `2F649649DE146FFFDBAF189EE6DD1FF17F236A32FE305ACFF0395C20F3637879`.
- Lockfile SHA-256: `32E148D05B827BAFF5E1BEC5A6DACAF18BC02232A358D8D95E504BF9134E168E`.

The remaining gate is environment-only. Install Docker Desktop (or another Docker-compatible CLI/runtime), start it, and run `npm run supabase:start`, `npm run supabase:upgrade-test`, `npm run supabase:reset`, and `npm run supabase:test`. Stage 7 must not treat Stage 6 as fully database-accepted until those commands pass.
