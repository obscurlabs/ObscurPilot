# ADR-0008: Contract and Migration Versioning

- **Status:** Accepted
- **Date:** 2026-07-15
- **Owners:** All engineering roles

## Context

IPC, tools, events, persisted JSON, adapters, prompts, and SQL evolve at different rates. One application version cannot describe compatibility.

## Decision

Version each boundary independently:

- IPC: integer envelope version plus channel suffix such as state:get-snapshot:v1.
- Tool: stable name plus positive integer version.
- Normalized event: eventType plus schemaVersion.
- Persisted JSON: mandatory schemaVersion; readers migrate or quarantine unsupported data.
- Platform adapter: semantic package version plus capability contract version.
- Prompt/policy/evaluation: immutable release ID recorded in audit.
- Database: timestamped forward-only migrations and a compatibility table.
- Desktop: SemVer; it does not replace boundary versions.

Additive optional fields are backward-compatible. Removing or renaming fields, changing meaning, narrowing accepted values, or changing side-effect semantics requires a new contract version. Strict tool inputs reject unknown properties.

## Consequences

Multiple versions may coexist during migration. Every breaking change needs a compatibility plan and fixture.

## Verification

Stage 1 CI introduces schema snapshots and compatibility fixtures. Release gates reject unversioned persisted JSON, breaking changes without a new version, and migrations without upgrade/rollback-window evidence.
