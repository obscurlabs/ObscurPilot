# Stage 13 — Reliability, Security, and Performance Hardening

Stage 13 converts the working desktop into a measurable hardened release candidate. It does not add creator features. It tightens the Electron/renderer boundary, rejects hostile IPC structures, redacts runtime diagnostics, proves provider recovery and duplicate suppression, records dependency provenance, enforces query/index contracts, and supplies one duration-configurable Electron soak harness.

## Evidence

- [Acceptance record](acceptance-record.md)
- [Security review](security-review.md)
- [Eight-hour soak runbook](soak-runbook.md)
- CycloneDX production SBOM: `artifacts/stage-13/sbom.cdx.json` after `npm run sbom`

## Commands

```powershell
npm run verify:stage13
npm run audit:stage13
npm run test:soak:smoke
npm run package:dir
npx playwright test tests/e2e/desktop.spec.ts --workers=1
npx playwright test tests/e2e/stage2-soak.spec.ts --workers=1
```

Run `npm run test:soak` only when the machine can remain dedicated for eight hours and the creator-observed conditions in the soak runbook are ready.
