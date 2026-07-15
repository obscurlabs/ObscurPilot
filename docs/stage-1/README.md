# Stage 1: Monorepo and Quality Foundation

Status: complete as of 2026-07-16.

- [Acceptance record](acceptance-record.md)
- [Dependency baseline](dependency-baseline.md)

## Local setup

1. Install Node.js 24 or newer.
2. Run npm ci to install the exact lockfile.
3. Add local values to the ignored root .env file. Never add secrets to VITE-prefixed variables.
4. Run npm run dev for the Electron/Vite development shell.

Optional local commit checks can be enabled with:

    git config core.hooksPath .githooks

CI always enforces the same static and test gates even when local hooks are not enabled.

## Environment custody

- GROQ_API_KEY is BYOK and main-process-only. Production persistence moves to the OS vault.
- SUPABASE_ANON_KEY is public by design but still remains outside the renderer in V1.
- TWITCH_CLIENT_ID is public. A Twitch client secret is intentionally not accepted by the desktop.
- OBS_WEBSOCKET_PASSWORD is main-process-only and OBS_WEBSOCKET_URL is restricted to a credential-free loopback WS URL.
- .env is ignored. .env.example contains no usable credential.

## Stage boundary

This stage creates the runtime scaffold, contract package, adapter package boundaries, strict TypeScript configuration, tests, CI, and unsigned packaging. Provider connections, complete IPC routing, and native service lifecycles remain in later stages.
