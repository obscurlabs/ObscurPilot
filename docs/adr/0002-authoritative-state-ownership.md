# ADR-0002: Authoritative State Ownership

- **Status:** Accepted
- **Date:** 2026-07-15
- **Owners:** Core Desktop; Stream/Event; Cloud/Security

## Context

OBS, Twitch, Supabase, Electron main, and React each expose state. Treating every cache as truth creates stale commands and reconnect races.

## Decision

- OBS is authoritative for current OBS runtime state.
- Twitch is authoritative for Twitch resources and EventSub facts.
- Supabase is authoritative for durable identity, configuration, grants, preferences, and audits.
- Electron main is authoritative for device/session state, provider health, voice capture, pending confirmation, command ledger, and local outbox.
- React owns presentation-only state and disposable projections.

Main publishes a monotonic snapshotVersion. Every state event carries the version it produces. A consumer detecting a gap requests or rebuilds an authoritative snapshot. Commands carry expected versions or preconditions; stale commands fail with PRECONDITION_FAILED and are never silently replayed.

## Consequences

Cloud loss does not block local OBS operation. Reconnection requires reconciliation instead of trusting cached continuity. UI optimism is allowed only as a labeled pending projection.

## Verification

Stage 3 property tests inject event loss, reordering, duplicate delivery, renderer reload, and process/provider restart. Resulting state must match a fresh authoritative snapshot with no duplicate side effects.
