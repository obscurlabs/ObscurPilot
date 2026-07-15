# Architecture Invariant Traceability

| Invariant                                 | Decision             | Owner          | Mandatory verification                 | Gate           |
| ----------------------------------------- | -------------------- | -------------- | -------------------------------------- | -------------- |
| Renderer has no native/secret authority   | ADR-0001, 0003       | Core Desktop   | sandbox/global/IPC/bundle/secret tests | 2, 12          |
| Boundary values are runtime-validated     | ADR-0001, 0004, 0008 | All            | schema contract and fuzz tests         | 2, 3, 9, 12    |
| Side effects are authorized and bounded   | ADR-0004             | Cloud/Security | adversarial policy/tool suite          | 3, 9, 12       |
| Ambiguous retries never duplicate effects | ADR-0002, 0005       | Stream/Event   | idempotency and chaos reconciliation   | 3, 5, 7, 9, 12 |
| Local OBS survives cloud loss             | ADR-0002             | Core/Stream    | cloud-blackhole integration            | 5, 12          |
| Durable data is tenant-isolated           | ADR-0003, 0005       | Cloud/Security | forced-RLS role matrix                 | 6, 12          |
| No plaintext/renderer credentials         | ADR-0003             | Core/Cloud     | canary scan across artifacts           | 2, 6-8, 12     |
| Caches reconcile to provider truth        | ADR-0002, 0005       | Adapter owner  | gap/reorder/restart comparison         | 3, 5, 7        |
| Learning cannot expand authority          | ADR-0004             | Cloud/Security | poisoned-feedback and preference suite | 11             |
| New providers do not rewrite core         | ADR-0007             | Stream/Event   | fake adapter/compliance suite          | 3, 7, future   |
| Upgrade and rollback remain compatible    | ADR-0006, 0008       | Release/Cloud  | contract diff, migration, update drill | 1, 6, 13-14    |
| Performance/privacy claims are measured   | Quality attributes   | Role owner     | retained benchmark/test artifact       | every stage    |

No invariant is accepted on document review alone. Its implementation gate must produce executable evidence.
