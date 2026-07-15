# Stage 0 Risk Register

Likelihood and impact use 1-5; score is their product. 15-25 is high, 8-14 medium, and 1-7 low.

| ID   | Risk                                    |   L |   I | Score | Treatment                                                                   | Owner          | Residual |
| ---- | --------------------------------------- | --: | --: | ----: | --------------------------------------------------------------------------- | -------------- | -------: |
| R-01 | AI proposes unsafe/wrong effect         |   4 |   5 |    20 | Tool Gateway, confirmation, preconditions, adversarial tests                | Cloud/Security |        6 |
| R-02 | Embedded shared API secret extracted    |   5 |   4 |    20 | Groq BYOK/vault; server Twitch secrets; bundle scan                         | Cloud/Security |        4 |
| R-03 | Ambiguous failure duplicates execution  |   4 |   5 |    20 | ledger, idempotency, reconciliation, no blind replay                        | Stream/Event   |        5 |
| R-04 | Renderer compromise reaches native APIs |   3 |   5 |    15 | ADR-0001, current Electron, CSP, sender checks                              | Core Desktop   |        5 |
| R-05 | Cross-tenant cloud leakage              |   3 |   5 |    15 | forced RLS, ownership FKs, policy tests                                     | Cloud/Security |        3 |
| R-06 | Provider/model API changes              |   4 |   4 |    16 | adapters, capability probes, config fallback, contract tests                | Adapter owner  |        8 |
| R-07 | Event flood freezes UI                  |   4 |   4 |    16 | bounded queues, batching, virtualization, soak                              | UI/UX          |        6 |
| R-08 | Token refresh race invalidates account  |   3 |   4 |    12 | per-account lock and transactional rotation                                 | Cloud/Security |        4 |
| R-09 | OBS changes during snapshot/command     |   4 |   4 |    16 | sync buffer, versions, pause/resnapshot                                     | Stream/Event   |        6 |
| R-10 | Free-tier quota/price change            |   4 |   3 |    12 | usage budgets, alerts, graceful degradation; no permanent zero-cost promise | Cloud          |        8 |
| R-11 | Unsigned Windows artifact harms trust   |   4 |   4 |    16 | provenance/checksums; signing before broad GA when credentials exist        | Release        |        8 |
| R-12 | Audio/transcript privacy violation      |   3 |   5 |    15 | default-off persistence, consent, retention/deletion tests                  | Core/Cloud     |        4 |
| R-13 | Credential vault unavailable            |   3 |   3 |     9 | fail closed, reauthorize, no plaintext fallback                             | Core Desktop   |        4 |
| R-14 | Dependency supply-chain compromise      |   3 |   5 |    15 | lockfile, minimal deps, script review, audit/SBOM                           | Core Desktop   |        6 |
| R-15 | Cross-platform scope delays release     |   4 |   4 |    16 | Windows Tier 1; defer other OS claims                                       | Release        |        4 |
| R-16 | Preview model changes                   |   4 |   3 |    12 | feature flag, golden/safety evaluation, rollback                            | AI owner       |        6 |
| R-17 | Preference learning weakens safety      |   3 |   5 |    15 | allowlisted keys; no grant/risk influence; offline promotion                | Cloud/Security |        3 |
| R-18 | Realtime gaps diverge state             |   3 |   4 |    12 | Realtime only invalidates; revision/cursor catch-up                         | Cloud/Security |        4 |

## Escalation

- Untreated high risk blocks its dependent stage.
- A security bypass, cross-tenant read/write, secret leak, or duplicate side effect is release-blocking regardless of score.
- Risk acceptance requires an ADR with duration, owner, compensating control, and removal trigger.
