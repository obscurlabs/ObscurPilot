# Stage 6: Supabase Identity and Persistence

Status: implementation complete; local database verification awaits an installed and running Docker CLI/runtime.

- [Acceptance record](acceptance-record.md)

## Delivered boundaries

- Supabase Auth runs only in Electron main through a pinned `@supabase/supabase-js` client.
- Refresh/session material uses Electron `safeStorage`, atomic encrypted files, strict schemas, and corruption quarantine. Linux fails closed when Electron selects `basic_text` or an unknown password-store backend.
- The preload exposes typed auth operations and projections; it never exposes a Supabase client, session, JWT, or raw IPC.
- Device identity is a stable OS-encrypted UUID. Cloud registration is an authenticated tenant-scoped upsert.
- Realtime is an invalidation signal. Every subscribe/reconnect runs ordered catch-up reads using `(occurred_at, id)`.
- Local mutations use a 512-entry/4 MiB OS-encrypted outbox, tenant binding, per-aggregate ordering, scheduled full-jitter retry, terminal-conflict rejection, exact mutation receipts, and server idempotency keys.
- Account deletion is a seven-day request followed by a leased, retryable server-only Edge Function worker. The same daily worker drains bounded retention batches. The desktop never receives a service-role key.

## Database layout

The migration creates tenant-first profiles, devices, provider accounts, OBS metadata, control profiles, tool grants, event subscriptions, session records, command audits, activity events, feedback, and deletion requests. OAuth ciphertext, client idempotency receipts, and server work queues live in the non-exposed `private` schema.

Every application table enables and forces RLS. Mutable rows use `revision` and `updated_at` triggers. Composite `(user_id, id)` foreign keys prevent cross-tenant relationships even when a caller guesses another UUID.

## Local verification

Install Docker Desktop (or another Docker-compatible CLI/runtime), verify the `docker` command is available, start the runtime, then run:

1. `npm ci`
2. `npm run supabase:start`
3. `npm run supabase:upgrade-test`
4. `npm run supabase:reset`
5. `npm run supabase:test`

The upgrade command resets to the pre-Stage-6 baseline, applies the Stage-6 migration incrementally, and runs pgTAP. The clean reset then proves replay from an empty database. The pgTAP suites contain a 90-assertion cross-user CRUD matrix plus private token custody, forced RLS, deterministic revision conflicts, device upsert, idempotent mutation replay, and deletion-lease recovery.

## Free Supabase deployment

Create a Supabase free project, then:

1. `npx supabase login`
2. `npx supabase link --project-ref <project-ref>`
3. `npx supabase db push --dry-run`
4. `npx supabase db push`
5. Generate a random 32-byte-or-longer job secret and set it with `npx supabase secrets set OBSCURPILOT_DELETION_JOB_SECRET=<secret>`.
6. `npx supabase functions deploy process-account-deletions`
7. Configure Supabase Cron to invoke the function daily with a service JWT and the `x-obscurpilot-job-secret` header. This invocation performs both retention maintenance and due account deletions.

Put only `SUPABASE_URL` and the public/anonymous key in the root desktop `.env`. The service role and deletion job secret belong only in hosted Edge Function secrets; never copy `supabase/functions/.env.example` into the desktop root.
