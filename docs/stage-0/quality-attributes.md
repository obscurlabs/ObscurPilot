# Quality Attributes and Measurable Budgets

Percentiles use at least 1,000 representative samples after warm-up on the performance reference class unless stated otherwise. Network totals are reported separately from ObscurPilot-controlled overhead.

| ID            | Requirement                            |                                                      V1 target | Measurement                                             | Owner           |
| ------------- | -------------------------------------- | -------------------------------------------------------------: | ------------------------------------------------------- | --------------- |
| NFR-LAT-001   | PTT release to STT HTTP dispatch       |                                   p95 <= 120 ms; p99 <= 200 ms | Monotonic capture-finalize/dispatch timestamps          | Core Desktop    |
| NFR-LAT-002   | Validated intent to OBS RPC dispatch   |                                    p95 <= 50 ms; p99 <= 100 ms | Fake-model and real-OBS local benchmark                 | Stream/Event    |
| NFR-LAT-003   | Main event receipt to visible timeline |                                                  p95 <= 150 ms | Correlated main/renderer trace                          | UI/UX           |
| NFR-UI-001    | Renderer long tasks                    |                               zero > 50 ms in event-burst test | Chromium trace with 10,000 events                       | UI/UX           |
| NFR-START-001 | Cold start to cached interactive shell |                                                     p95 <= 4 s | 30 cold starts; provider readiness separate             | Core Desktop    |
| NFR-REL-001   | Duplicate side effects                 |                                                           zero | Retry/reconnect/chaos assertions                        | Stream/Event    |
| NFR-REL-002   | Renderer recovery                      |                                        fresh projection <= 2 s | Kill and recreate renderer                              | Core Desktop    |
| NFR-REL-003   | Provider recovery                      |                 <= 60 s after healthy, excluding auth-required | Fault proxy and retry trace                             | Adapter owner   |
| NFR-REL-004   | Long-session stability                 |                  8 h; no crash; RSS growth <= 15% after hour 1 | Soak plus handles/listeners                             | All             |
| NFR-AVL-001   | Local OBS during cloud outage          |                           100% for authorized local operations | Block all cloud providers                               | Core and Stream |
| NFR-SEC-001   | Secret exposure                        |                                            zero canary matches | Scan renderer, IPC, logs, bundles, diagnostics, crashes | Cloud/Security  |
| NFR-SEC-002   | Cross-tenant access                    |                                zero unauthorized CRUD/Realtime | User A/B/anon/service matrix                            | Cloud/Security  |
| NFR-SEC-003   | Unauthorized model execution           |                                                           zero | Adversarial corpus                                      | Cloud/Security  |
| NFR-PRV-001   | Raw audio retention                    |                    off; cleanup <= 5 s after completion/cancel | Memory/temp inspection                                  | Core Desktop    |
| NFR-PRV-002   | Transcript retention                   |                    off by default; deletion <= 24 h on request | Storage/retention integration                           | Cloud/Security  |
| NFR-A11Y-001  | Accessibility                          |                                           WCAG 2.2 AA controls | axe, keyboard, contrast, screen reader, reduced motion  | UI/UX           |
| NFR-SYNC-001  | Outbox correctness                     | exactly-once observable result; p95 flush <= 30 s after online | Restart/duplicate/failure injection                     | Cloud/Security  |
| NFR-AUD-001   | Audit completeness                     |               100% attempted tools terminal or recovery-marked | Ledger-to-audit reconciliation                          | Cloud/Security  |

## Privacy and retention defaults

- Raw audio: memory or temporary storage only; no cloud persistence; lifecycle deletion.
- Transcript: ephemeral by default; feedback/evaluation retention requires separate opt-in.
- Redacted command audit: 90 days by default, configurable downward.
- Content-free operational metrics: 30 days by default.
- OAuth secrets: until disconnect/deletion, followed by immediate revocation/deletion workflow.
- Account deletion: application rows and secret references within 24 hours; backup expiry follows the selected Supabase plan.

## Measurement integrity

Every result records build, lock hash, OS, hardware, OBS version, network profile, fixture, warm-up, sample count, p50/p95/p99, failures, and raw artifact location. Failed samples cannot be deleted to waive a budget.
