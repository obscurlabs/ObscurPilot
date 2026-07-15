# Supabase Data and Security Architecture

## 1. Identity model

`auth.users.id` is the global tenant identity. Public application tables reference it through `user_id uuid`. Provider account IDs are attributes, never tenant keys. Desktop devices receive unique IDs and are revocable. OAuth refresh/access tokens never enter public client-readable tables or renderer state.

## 2. Foundational schema

All tables have `created_at timestamptz not null default now()`. Mutable tables also have `updated_at`, `revision bigint not null default 1`, and a trigger that increments revision and updates time.

| Table                 | Important columns and constraints                                                                                                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profiles`            | `user_id uuid primary key references auth.users on delete cascade`, `display_name`, `locale`, `timezone`, `preferences jsonb`                                                                                                                            |
| `devices`             | `id uuid primary key`, `user_id`, `installation_public_id text unique`, `name`, `platform`, `app_version`, `last_seen_at`, `revoked_at`; unique `(user_id,id)`                                                                                           |
| `provider_accounts`   | `id uuid`, `user_id`, `provider text check in ('twitch')`, `provider_user_id text`, `login text`, `scopes text[]`, `token_secret_ref uuid`, `status`, `token_expires_at`; unique `(provider,provider_user_id)`, unique `(user_id,provider)` where active |
| `oauth_token_secrets` | `id uuid`, `user_id`, encrypted token material or vault reference, key version, rotation metadata; service-role access only                                                                                                                              |
| `obs_endpoints`       | `id uuid`, `user_id`, `device_id`, `name`, `host`, `port default 4455`, `tls`, encrypted password reference, `is_default`; unique default per device                                                                                                     |
| `control_profiles`    | `id uuid`, `user_id`, `name`, `schema_version`, `configuration jsonb`, `is_active`, `revision`; unique `(user_id,name)`                                                                                                                                  |
| `tool_grants`         | `id uuid`, `user_id`, `tool_name`, `tool_version`, `permission`, `constraints jsonb`; unique `(user_id,tool_name,tool_version)`                                                                                                                          |
| `event_subscriptions` | `id uuid`, `user_id`, `provider_account_id`, `subscription_type`, `condition jsonb`, `desired_status`; unique hash over account/type/condition                                                                                                           |
| `session_records`     | `id uuid`, `user_id`, `device_id`, `started_at`, `ended_at`, `app_version`, `status`, aggregate diagnostics                                                                                                                                              |
| `command_audit`       | `id uuid`, `user_id`, `session_id`, `command_id`, `idempotency_key`, `tool_name`, `tool_version`, redacted args/result, status, latency, correlation ID; unique `(user_id,command_id)`                                                                   |
| `activity_events`     | `id uuid`, `user_id`, `session_id`, `source`, `source_event_id`, `event_type`, redacted payload, `occurred_at`; unique `(user_id,source,source_event_id)` when source ID exists                                                                          |
| `feedback_records`    | `id uuid`, `user_id`, `session_id`, optional command/audit reference, rating, reason code, redacted note, policy/model/tool versions                                                                                                                     |
| `sync_outbox`         | server-side integration work only: aggregate ID/type, event type, payload, attempts, next attempt, processed time                                                                                                                                        |

Do not store raw audio by default. Transcript retention defaults off; when enabled it has explicit purpose, retention expiry, and deletion controls. JSONB columns have versioned schemas and size limits enforced in application and database checks.

## 3. Indexing

```sql
create index devices_user_seen_idx on devices(user_id, last_seen_at desc);
create index accounts_user_status_idx on provider_accounts(user_id, status);
create index sessions_user_started_idx on session_records(user_id, started_at desc);
create index audit_user_created_idx on command_audit(user_id, created_at desc);
create index audit_session_created_idx on command_audit(session_id, created_at desc);
create index activity_user_occurred_idx on activity_events(user_id, occurred_at desc);
create index feedback_user_created_idx on feedback_records(user_id, created_at desc);
create index outbox_pending_idx on sync_outbox(next_attempt_at)
  where processed_at is null;
```

Add GIN indexes only for proven JSONB query paths; prefer generated typed columns for frequently filtered values. Time-partition high-volume audit/activity tables when measured volume justifies it. Every tenant query begins with `user_id` so indexes preserve tenant locality.

## 4. RLS baseline

Enable and force RLS on every application table. Revoke broad grants, then grant only required operations to `authenticated`.

```sql
alter table profiles enable row level security;
alter table profiles force row level security;

create policy profiles_select_own on profiles
for select to authenticated
using (user_id = (select auth.uid()));

create policy profiles_update_own on profiles
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
```

Equivalent ownership policies apply to devices, profiles, grants, subscriptions, sessions, activity, feedback, and audits. Inserts require `user_id = auth.uid()` and foreign keys whose parent also belongs to the user. Sensitive token tables have no authenticated policies; only narrowly scoped server functions using service credentials may access them. The service-role key never ships in Electron.

Use security-definer functions only when necessary; set an explicit empty `search_path`, fully qualify objects, revoke public execution, grant named roles, validate `auth.uid()`, and return projections rather than token material.

## 5. Token pipeline

1. Electron initiates OAuth with authorization code plus PKCE and random `state`/nonce.
2. Callback state and verifier are validated in main or a controlled backend exchange endpoint.
3. A server-side function exchanges the code, encrypts tokens using managed secrets/vault capabilities, stores only ciphertext or a secret reference, and returns a redacted account projection.
4. Refresh occurs server-side under a per-account lock. Rotation replaces refresh tokens transactionally and increments key/token versions.
5. Electron receives short-lived delegated access only when required, held in main-process memory, never localStorage.
6. Disconnect revokes upstream authorization when possible, deletes secret material, marks the account revoked, terminates subscriptions, and invalidates cached access.

Local OBS passwords and installation secrets use the operating-system credential vault through Electron `safeStorage` or a vetted keychain adapter. If secure storage is unavailable, fail closed and require re-entry; never silently write plaintext.

## 6. Realtime and optimistic concurrency

Subscribe only to user-scoped tables required for cross-device changes. RLS applies to Realtime authorization. Clients update mutable records with both ID and expected `revision`; zero updated rows means `CONFLICT`, followed by refetch and explicit resolution. Presence is ephemeral and must not be used as durable state.

## 7. Security verification

- SQL tests run as anonymous, user A, user B, and service roles; cross-tenant reads/writes must return no rows or authorization errors.
- Static scans reject service keys and provider secrets in bundled renderer assets.
- IPC fuzz tests supply malformed, oversized, and prototype-polluting values.
- OAuth tests cover state mismatch, expired code, replay, refresh rotation, revocation, and concurrent refresh.
- Logs and diagnostic exports pass secret-pattern and fixture-canary scans.
