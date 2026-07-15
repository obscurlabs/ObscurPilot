# Stage 1 Dependency Baseline

Recorded on 2026-07-16. Exact versions are locked by package-lock.json.

## Runtime and build

| Component            | Version |
| -------------------- | ------: |
| Node.js              | 24.12.0 |
| npm                  |  10.2.5 |
| Electron             |  43.1.1 |
| React / React DOM    |  19.2.7 |
| TypeScript           |   6.0.3 |
| Vite                 |   8.1.4 |
| Tailwind CSS         |   4.3.2 |
| @tailwindcss/vite    |   4.3.2 |
| @vitejs/plugin-react |   6.0.3 |
| esbuild              |  0.28.1 |
| Zod                  |   4.4.3 |
| electron-builder     | 26.15.3 |

TypeScript 6.0.3 is intentionally pinned below TypeScript 6.1 because the selected typescript-eslint 8.64.0 peer range requires TypeScript below 6.1.

## Verification

| Component                   | Version |
| --------------------------- | ------: |
| ESLint                      |  10.7.0 |
| Prettier                    |   3.9.5 |
| Vitest                      |  4.1.10 |
| Playwright                  |  1.61.1 |
| license-checker-rseidelsohn |   4.4.2 |

The license checker remains on 4.4.2 because its next major requires npm 11, while the reproducible Stage 1 toolchain is pinned to npm 10.

## Upgrade rule

Dependency upgrades require a dedicated pull request that reruns static verification, unit and contract tests, the production build, dependency and license audits, unsigned packaging, and both source and packaged Electron smoke tests. Provider SDKs are introduced only in their owning roadmap stage.
