# Stage 0 Acceptance Record

- **Stage:** 0 - Architecture and measurable contracts
- **Status:** Complete
- **Completed:** 2026-07-15
- **Next stage:** Stage 1 only after explicit user instruction

## Objective result

Product boundaries, decisions, V1 support, measurable budgets, trust boundaries, risks, and compatibility rules are frozen sufficiently for scaffolding. No unresolved decision requires an implementer to guess a security or ownership boundary.

## Definition of Done evidence

| Required result               | Evidence                                                                       | Result |
| ----------------------------- | ------------------------------------------------------------------------------ | ------ |
| Process isolation             | [ADR-0001](../adr/0001-electron-process-isolation.md)                          | Pass   |
| State ownership               | [ADR-0002](../adr/0002-authoritative-state-ownership.md)                       | Pass   |
| Credential custody            | [ADR-0003](../adr/0003-credential-and-token-custody.md)                        | Pass   |
| Tool authorization            | [ADR-0004](../adr/0004-tool-authorization.md)                                  | Pass   |
| Sync/conflicts                | [ADR-0005](../adr/0005-sync-and-conflict-resolution.md)                        | Pass   |
| Update strategy               | [ADR-0006](../adr/0006-release-and-update-strategy.md)                         | Pass   |
| Provider extensibility        | [ADR-0007](../adr/0007-platform-adapter-extensibility.md)                      | Pass   |
| Boundary versions             | [ADR-0008](../adr/0008-contract-versioning.md), [policy](versioning-policy.md) | Pass   |
| Environment/OBS support       | [support matrix](support-matrix.md)                                            | Pass   |
| Testable NFR/privacy budgets  | [quality attributes](quality-attributes.md)                                    | Pass   |
| Data-flow threat model        | [threat model](threat-model.md)                                                | Pass   |
| Owned/scored risks            | [risk register](risk-register.md)                                              | Pass   |
| Invariant owner/test/decision | [traceability](architecture-traceability.md)                                   | Pass   |

## Stage 1 inputs

Stage 1 must use npm workspaces, select current stable dependencies within the support policy, commit one lockfile, add strict TypeScript and contract-test foundations, and encode Stage 0 budgets as CI metadata/test placeholders. It cannot broaden platform support or change credential strategy without a superseding ADR.

## External facts validated

- Electron recommends sandboxing, context isolation, restricted navigation, sender validation, and a current version; it supports its latest three stable majors.
- OBS WebSocket 5.x is bundled with OBS 28+ and defaults to 4455; ObscurPilot chooses authenticated 5.x and OBS 30+.
- Twitch EventSub uses welcome/keepalive/reconnect/revocation messages, at-least-once delivery, and resubscription after unclean loss.
- Supabase RLS supports auth.uid tenant policies; bypass credentials remain server-side.
- Groq documents the selected STT model and local tool calling for both reasoning choices.

Provider facts must be revalidated at implementation and release because they can change.
