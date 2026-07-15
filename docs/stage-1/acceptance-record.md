# Stage 1 Acceptance Record

Status: **accepted**

Accepted on: 2026-07-16

Scope: monorepo and quality foundation only. Stage 2 has not started.

## Gate evidence

| Requirement                            | Verification                            | Result                                                                             |
| -------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------- |
| Exact workspace dependency graph       | npm ci                                  | Pass; 585 packages installed from package-lock.json and 0 vulnerabilities reported |
| Strict TypeScript project references   | npm run typecheck                       | Pass                                                                               |
| Zero-warning lint policy               | npm run lint                            | Pass                                                                               |
| Deterministic formatting               | npm run format:check                    | Pass                                                                               |
| Unit and contract behavior             | npm test                                | Pass; 3 files and 9 assertions                                                     |
| Integration runner                     | npm run test:integration                | Pass; runner ready, provider suites begin in later stages                          |
| Chaos runner                           | npm run test:chaos                      | Pass; runner ready, fault suites begin with supervised services                    |
| Performance runner                     | npm run test:performance                | Pass; runner ready, budgets begin with implemented data paths                      |
| Production Electron and renderer build | npm run build                           | Pass                                                                               |
| Production dependency audit            | npm run audit:dependencies              | Pass; 0 vulnerabilities                                                            |
| Production license allowlist           | npm run audit:licenses                  | Pass                                                                               |
| Unsigned Windows packaging             | npm run package:dir                     | Pass                                                                               |
| Source desktop boundary smoke test     | npm run test:e2e                        | Pass                                                                               |
| Packaged desktop boundary smoke test   | npm run test:e2e                        | Pass                                                                               |
| Renderer secret and Node-boundary scan | Forbidden-token scan over dist-renderer | Pass; no secret names, process.env, ipcRenderer, or nodeIntegration                |
| Environment custody                    | Git ignore and schema checks            | Pass; .env ignored and .env.example tracked                                        |

## Accepted artifact

This checksum identifies the artifact at the Stage 1 gate. The working artifact path has since been superseded by accepted Stage 2/3 builds.

- Path: artifacts/win-unpacked/ObscurPilot.exe
- Size: 225,485,824 bytes
- SHA-256: 46726A9410531B9BAB1F5C3DE11E3F2BEB04A17132B681BE2014B72362556C0E
- Purpose: local and CI smoke testing only; signing, branded icons, installers, and release distribution remain Stage 13 responsibilities.

## Security boundary accepted in this stage

- Environment parsing occurs only in Electron main.
- No environment object, credential, raw Electron module, or unrestricted IPC surface is exposed to React.
- The preload bridge exposes one frozen, validated bootstrap method.
- Browser windows use context isolation, sandboxing, web security, denied navigation, and denied popup creation.
- IPC handlers validate the sender URL and return only a Zod-validated non-secret projection.
- The production renderer is served through the registered app protocol with a restrictive content security policy.
- The renderer diagnostic view displays only configured/not-configured booleans.

## Structural foundation accepted

- npm workspaces separate the desktop, domain, contracts, observability, and provider adapter boundaries.
- Explicit package subpath exports avoid broad barrel imports and make bundle boundaries statically analyzable.
- Strict TypeScript, ESLint, Prettier, Vitest, Playwright, dependency auditing, license auditing, and Windows CI are mandatory gates.
- Integration, chaos, and performance test projects exist now so later stages add evidence without restructuring the repository.
- The adapter contract is versioned so future social-platform integrations can be added without coupling them to the desktop renderer.

## Non-blocking Stage 1 limitations

- The package uses Electron's default icon.
- The unpacked artifact is not a public release installer.
- Provider SDKs, OAuth, token vaulting, full IPC routing, service supervisors, and live connections are intentionally absent until their owning roadmap stages.
- Real integration, chaos, and performance cases are intentionally empty because Stage 1 contains no provider data path or supervised connection to exercise.

## Decision

Every Stage 1 Definition of Done condition has executable or inspectable evidence. Stage 1 is complete and the repository must remain at this boundary until the user explicitly authorizes Stage 2.
