# Stage 13 Security Review

Reviewed on: 2026-07-19

Scope: Electron main/preload/renderer boundaries, IPC, navigation, credential custody, Supabase client storage, runtime logging, production bundle, dependency tree, and release operations visible in this repository.

## Threat-surface result

| Surface            | Enforced control                                                                               | Evidence                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Renderer privilege | Context isolation, sandbox, no Node integration, narrow preload                                | `apps/desktop/electron/window-manager.ts:17-21`                                                 |
| Navigation         | New windows and renderer navigation denied                                                     | `apps/desktop/electron/window-manager.ts:26-32`                                                 |
| Browser capability | Default-deny permissions; isolated audio window receives only media                            | `apps/desktop/electron/security.ts:61-69`, `window-manager.ts:94-100`                           |
| Injection          | Production CSP has no `unsafe-inline` or `unsafe-eval`; no raw-HTML/eval sinks found in source | `apps/desktop/electron/security.ts:3-14`                                                        |
| IPC                | Exact sender origin, 64 KiB bound, strict schemas, timestamp window, plain-data check          | `apps/desktop/electron/ipc-router.ts:49-72`                                                     |
| Cloud tokens       | Encrypted main-process storage; service-role JWTs rejected                                     | `apps/desktop/electron/cloud-bridge.ts:37-83`, `packages/adapters-supabase/src/client.ts:80-96` |
| OBS password       | Electron `safeStorage`; never returned through projections                                     | `apps/desktop/electron/secure-settings.ts:43-64`                                                |
| Twitch navigation  | HTTPS Twitch authorization URL is allowlisted before external open                             | `apps/desktop/electron/twitch-bridge.ts:367-380`                                                |
| Diagnostics        | Structured depth/size-bounded redaction before first-party error logs                          | `apps/desktop/electron/redaction.ts:1-85`                                                       |
| Supply chain       | Lockfile, zero production advisories, license allowlist, 56-component CycloneDX SBOM           | `package.json` Stage 13 scripts                                                                 |

## Findings

### S13-IPC-001

- Rule ID: JS object-shape/prototype-pollution boundary
- Severity: High
- Location: `apps/desktop/electron/ipc-router.ts`, secure invoke path
- Evidence: deterministic fuzzing showed an own `__proto__` property from JSON could pass the strict Zod envelope and reach a valid handler.
- Impact: accepting non-plain or prototype-control keys at a privileged IPC boundary can enable unsafe downstream object merging or authorization confusion.
- Fix: resolved. The router now recursively rejects accessors, cycles, excessive depth, non-plain prototypes, `__proto__`, `prototype`, and `constructor` before serialization or schema parsing.
- Mitigation: the payload and result schemas remain strict and the sender origin remains mandatory.
- False positive notes: none; the original test reproduced handler execution and the repaired 10,000-case corpus proves zero execution.

### S13-LOG-001

- Rule ID: secret-bearing runtime diagnostics
- Severity: Medium
- Location: first-party Electron error logging in `main.ts` and `window-manager.ts`
- Evidence: provider callback/startup failures were logged as raw error messages or URLs.
- Impact: an upstream error containing an OAuth code, authorization header, JWT, password, or key assignment could persist in terminal or collected logs.
- Fix: resolved. All first-party Electron error sites route through bounded structured redaction; canary tests cover headers, JWTs, Supabase keys, environment assignments, callback codes, nested fields, errors, and cycles.
- Mitigation: renderer bundle scanning separately blocks known secret markers.
- False positive notes: third-party library internals can still write their own diagnostics; production debug logging must remain disabled and release collection must pass through an external scrubber.

### S13-OPS-001

- Rule ID: credential lifecycle after disclosure
- Severity: High
- Location: external development communication/history; no secret value is repeated in this report
- Evidence: privileged Supabase development credentials were previously shared outside the encrypted runtime boundary.
- Impact: any still-active disclosed credential may permit unauthorized cloud access at its granted role.
- Fix: unresolved operational release blocker. Rotate the Supabase secret/service-role key and database password, then replace only the local/hosted secrets that require them. Rotate any other credential previously disclosed in plaintext.
- Mitigation: `.env` remains ignored, the renderer scan passes, and the desktop rejects service-role credentials.
- False positive notes: if all disclosed values have already been revoked, record provider-side revocation timestamps in the Stage 14 release evidence.

### S13-SIGN-001

- Rule ID: artifact authenticity
- Severity: Medium
- Location: Windows unpacked artifact configuration
- Evidence: the accepted executable is an unpacked development artifact and no publisher certificate identity is configured in the repository.
- Impact: users cannot establish publisher provenance for a distributed installer.
- Fix: deferred by roadmap to Stage 14, where signing credentials, checksums, update metadata, and release provenance are required.
- Mitigation: use the artifact only for local acceptance; do not distribute it as a production installer.
- False positive notes: a machine-level certificate may exist outside the repository; verify the final signature with `Get-AuthenticodeSignature` during Stage 14.

## Gate conclusion

No Critical or High code finding remains open. `S13-OPS-001` is a High operational release blocker and must be closed before Stage 13 can receive unconditional acceptance or Stage 14 may publish an artifact. Development-only CSP uses Vite-required inline support; the production policy does not.
