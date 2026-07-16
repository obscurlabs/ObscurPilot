# Stage 9 Acceptance Record

Status: **implementation, hosted deployment, live model gate, and packaged desktop gate accepted**

Recorded on: 2026-07-16

## Gate evidence

| Requirement                 | Evidence                                                                                        | Result                           |
| --------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------- |
| Model configuration         | Strict primary/fallback enum for the two approved Groq reasoning models                         | Pass                             |
| Local tool calling          | Exact versioned catalog and OpenAI-compatible payload with sequential local calls               | Pass                             |
| Response validation         | Provider response, finish state, tool identity, argument size, and per-tool schema fail closed  | Pass                             |
| Prompt-injection resistance | Unregistered/hallucinated names, schema smuggling, and absent grants never execute              | Pass                             |
| Authorization               | Cloud-backed grants and required scopes are checked immediately before execution                | Pass                             |
| Consequential confirmation  | Stream/record operations require explicit approval; denial and 15-second expiry execute nothing | Pass                             |
| Stale-state defense         | Captured OBS snapshot version and generation are required by mutation wrappers                  | Pass                             |
| Loop bounds                 | Turn, call-count, argument-byte, and active-wall-time ceilings are independently tested         | Pass                             |
| Idempotency                 | Repeated model call IDs resolve through one command ledger effect                               | Pass                             |
| Audit privacy               | Model/prompt/tool/policy versions and hashed identities persist without arguments or transcript | Pass                             |
| Local latency               | 100 validated tool dispatches satisfy p95 <= 50 ms                                              | Pass                             |
| Hosted policy               | Migration `202607160005` applied and local/remote migration histories match                     | Pass                             |
| Live model                  | Configured `openai/gpt-oss-120b` returned the exact allowlisted acceptance tool call            | Pass, 590 ms provider round trip |

## Runtime interaction surface

The existing presence control now renders typed transcribing, reasoning, tool-active, confirmation, completed, and error states. Protected commands expose keyboard-accessible Approve and Deny buttons. No transcript or raw arguments are rendered. The larger Stage 10 visual redesign remains intentionally deferred.

## Final verification run

- Static verification passes: TypeScript, ESLint, and Prettier.
- Unit: 72 tests pass across 19 files.
- Contract: 18 tests pass across 7 files.
- Integration: 5 deterministic tests pass; the read-only real-OBS fixture is skipped because nothing is listening on local port 4455.
- Chaos: 1 test passes.
- Performance: all 3 budgets pass, including Groq dispatch and validated tool dispatch.
- Production build and renderer secret-boundary scan pass.
- Production dependency audit reports zero vulnerabilities; production license audit passes.
- Direct Electron smoke, unsigned packaged smoke, and 100 consecutive packaged startup/shutdown cycles pass.
- Unsigned packaged executable SHA-256: `804EA797AE17DF99BBC534E9D3A4B9B85FBA6E8ECF05DA03479D859B7940C24F`.
- Lockfile SHA-256: `D78AA73BC96A060C63BE3F78B730CDB8167304E9A5F25C762BEB895A55B09C39`.

The skipped real-OBS snapshot is an environment exercise, not a Stage 9 policy/tool-ingestion blocker. It is read-only and can be run later by starting OBS with WebSocket port 4455 and setting `OBSCURPILOT_OBS_INTEGRATION=1`.
