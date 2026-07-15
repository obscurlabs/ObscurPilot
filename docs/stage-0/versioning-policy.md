# Versioning and Change Policy

ADR-0008 is authoritative. This document defines the operating procedure.

| Artifact         | Example                               | Compatible change                          | Breaking response                                |
| ---------------- | ------------------------------------- | ------------------------------------------ | ------------------------------------------------ |
| Desktop          | 1.4.2                                 | SemVer patch/minor                         | major and migration notes                        |
| IPC              | protocolVersion 1; settings:update:v1 | optional output field with tolerant reader | new v2 and dual-support window                   |
| Tool             | obs.resource.set at version 1         | non-semantic fix                           | version 2; explicit grant migration              |
| Event            | platform.activity at version 1        | documented optional metadata               | new schema and consumer fixture                  |
| Persisted JSON   | schemaVersion 3                       | additive field with default                | migration and quarantine fallback                |
| Platform adapter | adapterContract 1                     | optional capability                        | new contract/compliance suite                    |
| Prompt/policy    | immutable release ID                  | none; content immutable                    | new ID and evaluation report                     |
| Database         | timestamped SQL file                  | new forward migration                      | expand/migrate/contract; never edit applied file |

## Database protocol

1. **Expand:** add nullable structures, indexes, policies, and functions without removing old readers.
2. **Migrate:** backfill in bounded, observable, restart-safe batches.
3. **Switch:** deploy clients/server using the new representation; dual-read/write only when documented.
4. **Contract:** remove legacy structures after the compatibility window and backup/restore check.

Each migration includes purpose, lock/runtime assessment, forward-repair behavior, RLS/grant delta, validation query, and clean plus prior-release upgrade tests.

## Change control

- Schemas and generated types are committed together.
- CI compares contract snapshots and rejects breaking changes without new versions.
- Provider SDK updates run adapter and recorded-fixture suites.
- Model/prompt changes require golden, safety, latency, and cost evaluation.
- Production model aliases are prohibited when a stable explicit ID exists.
- Security controls cannot be weakened by minor configuration; exceptions require a superseding ADR.
