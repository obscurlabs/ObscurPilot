# Engineering Roles and Acceptance Boundaries

## 1. Core Desktop Engineer

**Owns:** Electron main/preload bootstrap, window policy, single-instance control, OS hotkeys, audio lifecycle/buffering, secure configuration parsing, local credential storage, IPC registration, shutdown interlocks, packaging primitives.

**May not own:** React business components, direct Supabase schema decisions, OBS/Twitch domain behavior, or renderer-side secrets.

**Required patterns:** dependency-injected services; abortable lifecycles; bounded buffers; one typed IPC handler per allowlisted channel; Zod validation; atomic state transitions; `safeStorage`/keychain-backed secrets; environment validation at startup; no synchronous filesystem work in latency paths.

**Validation:** shortcut collision and unregister tests; press/release/cancel race tests; audio duration/size boundary tests; crash/relaunch cleanup; sender validation; navigation and permission denial tests; packaged-app smoke tests on supported OS targets.

## 2. Stream and Event Ingestion Engineer

**Owns:** `obs-websocket-js` adapter, OBS snapshot/reconciliation, Twurple API/EventSub adapters, desired subscription registry, rate-limit scheduling, token refresh coordination interface, event normalization, dedupe cache, provider health state.

**May not own:** raw token persistence, generic UI state, model prompts, or bypasses around Tool Gateway policy.

**Required patterns:** SDK isolation behind domain interfaces; one in-flight connection/refresh; full-jitter retries; server-directed reconnect handling; provider error translation; bounded TTL/LRU caches; authoritative resnapshot after uncertain gaps; command preconditions and idempotency.

**Validation:** mocked JSON-RPC contract tests; real OBS compatibility matrix; forced socket loss during commands; EventSub welcome/reconnect/revocation fixtures; duplicate message floods; Helix rate-limit exhaustion; expired/concurrently refreshed tokens; zero duplicated side effects.

## 3. Cloud and Security Engineer

**Owns:** Supabase migrations, Auth, RLS, OAuth exchange/refresh/revocation, encrypted secret storage, revisioned persistence, Realtime subscriptions, retention/deletion, outbox persistence, backups and recovery documentation.

**May not own:** renderer token handling, local OBS command execution, or security-definer functions without reviewed grants and tests.

**Required patterns:** forward-only migrations with rollback notes; tenant-leading indexes; forced RLS; least privilege; server-only service role; PKCE; transactional rotation; expected-revision updates; append-only audits; sanitized payloads; key-versioned encryption.

**Validation:** cross-tenant SQL matrix; migration from clean and previous release; OAuth replay/rotation tests; Realtime tenant isolation; deletion/retention jobs; restore drill; bundled-secret scan.

## 4. UI/UX Interaction Engineer

**Owns:** React control board, shadcn components, Tailwind tokens, accessible keyboard/pointer behavior, connection health, activity virtualization, command confirmation, push-to-talk presentation, Groq reaction orb, local speech synthesis, renderer stores and error recovery.

**May not own:** SDK clients, credentials, raw IPC, command authorization, authoritative connection state, or renderer-triggered arbitrary tool names.

**Required patterns:** preload API only; selectors to constrain rerenders; virtualized/paginated timelines; reduced-motion compliance; semantic color plus text/icon status; `aria-live` sparingly; animation through compositor-friendly transforms; speech cancellation and voice fallback; render batching.

**Validation:** axe accessibility checks; keyboard-only flows; screen-reader announcements; reduced-motion and high-contrast tests; 10,000-event timeline performance; IPC disconnection/reload recovery; no sensitive values in DOM, browser storage, or renderer logs.

## 5. Cross-role contract governance

- Changes to `packages/contracts` require representatives of every affected owner and compatibility tests.
- Tool schemas are versioned. Breaking changes introduce a new version and migration path.
- Database migrations require Cloud/Security approval plus consumer contract tests.
- Adapter errors must map to the shared taxonomy before reaching domain/UI code.
- No role closes work using unit tests alone when its boundary touches a real process, provider protocol, database policy, or packaged binary.
