# ADR-0005: Synchronization and Conflict Resolution

- **Status:** Accepted
- **Date:** 2026-07-15
- **Owners:** Cloud/Security; Stream/Event

## Context

The desktop must work through cloud loss and may later synchronize multiple devices. Blind last-write-wins would overwrite newer configuration or replay effects.

## Decision

Mutable durable entities use revision bigint and server updated_at. Updates include the expected revision; zero affected rows returns CONFLICT. Append-only events use immutable IDs and unique source/idempotency keys. Only explicitly listed low-risk scalar preferences may use server-timestamp last-write-wins. Structured profiles and grants require refetch plus field-aware or user-visible resolution.

The local encrypted outbox stores bounded, schema-versioned mutation intents. Flush ordering is per aggregate; independent aggregates may flush concurrently. Idempotency keys survive retry. OBS commands and time-sensitive remote actions are not persisted for later replay. Realtime is an invalidation path, not proof of complete history; reconnect performs a cursor/revision catch-up query.

## Consequences

Offline configuration changes survive restart. Some conflicts require user choice. Realtime gaps cannot cause silent divergence.

## Verification

Stage 6 tests cover offline restart, duplicate flush, partial failure, out-of-order Realtime events, concurrent devices, revoked identity, schema upgrade, clock skew, and outbox corruption/quarantine.
