# ADR-0006: Release and Update Strategy

- **Status:** Accepted
- **Date:** 2026-07-15
- **Owners:** Core Desktop; Cloud/Security

## Context

Electron security depends on timely framework updates. Desktop rollback must remain compatible with forward-only cloud migrations.

## Decision

Releases use immutable semantic versions and stable, beta, and nightly channels. Production artifacts originate only from protected CI tags and include checksums, SBOM, provenance, and signatures when platform credentials are available. Update metadata is signed and channel-scoped. The user controls installation timing during active production sessions; forced restart is prohibited.

Electron must remain within its latest three supported stable major lines, with security patches prioritized. Stage 1 selects and pins one current stable line; upgrades are tested at least monthly. Reference: <https://www.electronjs.org/docs/latest/tutorial/electron-timelines>.

Database migrations are forward-only and expand/migrate/contract. A desktop release remains compatible with current and immediately previous public API/schema contracts during the rollback window. Destructive contraction waits until old clients leave the supported window.

## Consequences

Free artifact hosting does not remove code-signing cost or reputation warnings. Emergency rollback may revert desktop behavior but never down-migrate production data.

## Verification

Stages 13-14 test fresh install, signed metadata validation, interrupted update, channel isolation, upgrade, supported downgrade, offline start, bad-release rollback, and database compatibility.
