# ADR-0003: Credential and Token Custody

- **Status:** Accepted
- **Date:** 2026-07-15
- **Owners:** Cloud/Security; Core Desktop

## Context

Anything distributed in a desktop or Vite renderer bundle is recoverable. Main-process storage reduces renderer exposure but cannot make an embedded application-wide secret unknowable.

## Decision

The renderer never receives Groq keys, OAuth refresh tokens, OBS passwords, Supabase service-role keys, Twitch client secrets, or long-lived bearer tokens.

- Groq V1 uses user-supplied credentials (BYOK), stored through the OS credential vault using Electron safeStorage or a vetted keychain adapter and held only in main memory while used.
- OBS passwords use the OS credential vault and opaque references.
- Twitch client secrets and token exchange/rotation remain in a narrowly scoped Supabase server function or vault-backed service. The desktop uses authorization code with PKCE and validates state.
- The Supabase public client key is treated as public; authorization depends on Auth and RLS. Service-role credentials remain server-side.
- Secrets are forbidden from Web Storage, renderer IndexedDB, Vite-exposed variables, logs, crash data, and diagnostic exports.

If secure OS storage is unavailable, persistence fails closed and requires re-entry. There is no plaintext fallback.

## Consequences

BYOK adds setup but avoids shipping a shared Groq secret. Cloud token custody adds a control-plane dependency while keeping local OBS independent.

## Verification

Stages 2, 6, 7, 8, and 12 scan source, bundles, storage, logs, IPC, crash fixtures, and diagnostics using canary secrets. OAuth tests cover state mismatch, replay, rotation, concurrent refresh, revocation, and account mismatch.
