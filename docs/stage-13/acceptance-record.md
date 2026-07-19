# Stage 13 Acceptance Record

Status: **automated hardening complete; eight-hour live soak and credential rotation pending**

Prepared on: 2026-07-19

## Delivered boundary

- Central, depth/size-bounded diagnostic redaction for headers, JWTs, provider keys, OAuth query values, environment assignments, sensitive object fields, errors, cycles, and control characters.
- IPC rejects unsafe prototypes, accessors, cycles, excessive nesting, prototype-control keys, stale/future timestamps, unknown fields, non-contract payloads, and envelopes above 64 KiB before any handler side effect.
- Deterministic 10,000-envelope hostile-input corpus with zero accepted mutation.
- OBS/Twitch/Groq/Supabase transport and authentication outage matrix with full handshake recovery and fail-closed auth behavior.
- Electron duration harness with crash, snapshot, RSS, heap, active-resource, and window-count budgets.
- Database query/index drift contracts and pgTAP coverage for creator reads, cursors, retention, outbox delivery, and deletion leasing.
- CycloneDX SBOM generator and combined dependency/license/renderer-boundary audit command.
- Control-board release marker updated to `Stage 13 · Hardened runtime`.
- Corner Pilot renderer loading is gated behind registration of its hands-free, agent, and live-session IPC handlers, eliminating startup invoke races.

## Verified results

- `npm run verify:stage13`: passed.
- TypeScript, ESLint, Prettier: passed.
- Unit and contract: 40 files, 147 tests passed.
- Integration: 6 passed; one real-OBS case intentionally skipped for creator observation.
- Chaos: 2 files, 10 tests passed.
- Performance: 6 files, 6 budgets passed.
- Security fuzz: 10,000 malformed envelopes plus sender-boundary case passed.
- Production dependency audit: zero vulnerabilities.
- Production license allowlist: passed.
- Renderer secret-boundary scan: passed.
- CycloneDX SBOM: 56 production components generated.
- Electron bounded soak smoke: passed in 20.8 seconds with zero crash/snapshot/budget failure.
- Production renderer/accessibility, overlay IPC ordering, lifecycle, and unpacked-artifact E2E: 4/4 passed.
- Packaged startup/shutdown stress: 100/100 consecutive cycles passed in 5.7 minutes.
- Windows unpacked artifact rebuilt at `artifacts/win-unpacked/ObscurPilot.exe`.

## Security disposition

The fuzz suite discovered one High IPC object-shape weakness and the review found one Medium first-party logging weakness; both are fixed and regression-tested. No Critical or High code finding remains open. The full disposition is in [security-review.md](security-review.md).

## Pending acceptance

1. Run and witness the full eight-hour connected reference soak in [soak-runbook.md](soak-runbook.md).
2. Execute the real OBS integration case with `OBSCURPILOT_OBS_INTEGRATION=1` on the release OBS instance.
3. Run the new pgTAP index suite against the release database or a compatible local Supabase stack; the static index drift contract already passes.
4. Rotate every privileged development credential previously disclosed in plaintext and record provider-side revocation evidence without copying secret values into this file.
5. Confirm the eight-hour run contains zero duplicate OBS/Twitch side effects and every outage returns to authoritative synchronized state.

Stage 13 must not be marked unconditionally complete until all five pending items are witnessed. Stage 14 implementation may continue locally, but no artifact may be publicly distributed while credential rotation or the eight-hour gate remains open.
