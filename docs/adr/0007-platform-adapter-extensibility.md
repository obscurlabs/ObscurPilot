# ADR-0007: Versioned Platform Adapter Extensibility

- **Status:** Accepted
- **Date:** 2026-07-15
- **Owners:** Stream/Event; Cloud/Security

## Context

V1 requires Twitch, but later ObscurPilot versions may add other live or social platforms. Provider semantics must not contaminate the domain kernel.

## Decision

Every remote platform is an adapter package implementing a versioned PlatformAdapter capability contract. It exposes lifecycle, health, authenticated account projection, capability discovery, normalized events, bounded action execution, rate information, and reconciliation. SDK objects and raw payloads never cross the boundary.

Provider identifiers are registered through a controlled platform_providers catalog, not a permanent Twitch-only database constraint. Each account owns independent OAuth scopes, encrypted secret reference, health, rate limiter, dedupe namespace, and subscription specifications. Generic tools target capabilities; a provider binding resolves them only when advertised. Provider-only behavior uses a namespaced versioned extension.

New adapters require no changes to Electron isolation, the Tool Gateway, command ledger, renderer event model, or existing provider tables beyond additive migrations and registration.

## Consequences

V1 still implements only Twitch. Social-media management remains a later version, but adding it becomes an adapter/capability exercise rather than a core rewrite.

## Verification

Stage 3 supplies an in-memory fake adapter contract suite. Stage 7 requires Twitch to pass it. Every later provider must pass the same lifecycle, auth isolation, rate, dedupe, reconciliation, audit, and chaos suites.
