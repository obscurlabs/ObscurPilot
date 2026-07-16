# Road to Achieve: Empty Repository to Production Release

Each stage is a hard gate. Work may be prepared in parallel, but no dependent stage is accepted until its prerequisites and Definition of Done pass in CI and on reference hardware.

## Stage 0 — Architecture and measurable contracts

**Status:** Complete (2026-07-15). Evidence: [Stage 0 acceptance record](stage-0/acceptance-record.md).

**Objective:** freeze product boundaries, decision records, supported environments, and measurable budgets.

**Prerequisites:** this documentation set.

**Tasks:**

1. Add ADRs for process isolation, state ownership, credential storage, tool authorization, sync conflicts, and update strategy.
2. Define supported OS/architecture matrix and minimum OBS WebSocket compatibility.
3. Convert latency, availability, privacy, and retention requirements into testable budgets.
4. Create threat model/data-flow diagrams and risk register.
5. Establish protocol, schema, and migration versioning rules.

**Definition of Done:** all architectural invariants have an owner, test method, and ADR; unresolved decisions block scaffolding.

## Stage 1 — Monorepo and quality foundation

**Objective:** create a reproducible, strict TypeScript workspace and CI gate.

**Prerequisites:** Stage 0.

**Status:** complete. See the [Stage 1 acceptance record](stage-1/acceptance-record.md).

**Tasks:** create npm workspaces and the layout in `01-system-architecture.md`; scaffold Electron/Vite/React; configure strict TypeScript project references; add ESLint, Prettier, Vitest, Playwright, dependency/license audit, commit checks, CI caching, artifact retention, and environment schema; add unit, integration, E2E, chaos, and performance test projects.

**Definition of Done:** clean checkout installs with the lockfile, type-checks, lints, tests, builds, and produces an unsigned smoke-test package in CI; renderer bundle contains no Node polyfills or secrets.

## Stage 2 — Secure desktop shell and IPC spine

**Objective:** establish the hardened process boundary and typed communication plane.

**Prerequisites:** Stage 1.

**Status:** complete. See the [Stage 2 acceptance record](stage-2/acceptance-record.md).

**Tasks:** implement `electron/main.ts`, `window-manager.ts`, `preload.ts`, IPC router, sender validation, Zod envelopes, public error mapping, bootstrap snapshot, single-instance lock, CSP, navigation/window/permission denial, lifecycle disposal, and renderer API type declaration; implement a diagnostic screen using shadcn primitives.

**Definition of Done:** malicious channel/payload tests are rejected; renderer cannot access Node/Electron/raw IPC; reloads do not leak listeners; packaged shell starts and shuts down cleanly 100 consecutive times.

## Stage 3 — Domain kernel and connection supervisor

**Objective:** implement SDK-independent state machines, tool contracts, and supervision.

**Prerequisites:** Stage 2.

**Status:** complete. See the [Stage 3 acceptance record](stage-3/acceptance-record.md).

**Tasks:** create connection FSM, retry/circuit-breaker utilities with injectable clock/randomness, event bus, monotonic snapshots, command ledger/idempotency, permission/risk policy, tool registry, bounded loop controller, activity normalizer, and durable-outbox interface.

**Definition of Done:** transition/property tests cover all legal/illegal paths; deterministic fake-clock tests prove backoff caps and cancellation; duplicate command fixtures execute once; snapshot gaps force resync.

## Stage 4 — Push-to-talk and local audio pipeline

**Objective:** reliably capture bounded audio from global shortcut to an encoded transcription payload.

**Prerequisites:** Stage 3.

**Tasks:** implement accelerator settings/registration, device selection, isolated capture adapter, ring buffer, silence/minimum/maximum duration rules, encoder, press/release/cancel FSM, <= 30 Hz level projection, audio resource disposal, interruption recovery, OS-secure settings storage, and the interaction projection defined in [experience architecture](07-experience-architecture.md).

**Definition of Done:** race, rapid-tap, stuck-key, device-loss, oversized-input, and shutdown-during-capture tests pass; 1,000 capture cycles show no growing handles or memory trend; dispatch overhead meets the local budget.

## Stage 5 — OBS local bridge

**Objective:** provide an authoritative, self-healing OBS state mirror and safe command boundary.

**Prerequisites:** Stages 3–4; compatible OBS test fixture.

**Tasks:** implement OBS config secret handling, adapter lifecycle, handshake/version check, event-intent selection, snapshot builder, synchronization buffer, reconnect reconciliation, normalized events, command preconditions/timeouts, uncertainty/non-replay policy, observe-only tool definition, and redacted IPC/health projections.

**Definition of Done:** integration suite against real OBS validates connect/auth failure/version mismatch, snapshot accuracy, event ordering, socket loss, OBS restart, command timeout, and reconciliation; uncertain queued commands never execute after reconnect without valid policy/preconditions.

## Stage 6 — Supabase identity and persistence

**Objective:** establish secure tenant identity, durable configuration, audits, and resilient sync.

**Prerequisites:** Stages 2–3; Supabase projects for local/test environments.

**Status:** implementation complete; local database execution is pending an installed Docker CLI/runtime. See the [Stage 6 acceptance record](stage-6/acceptance-record.md).

**Tasks:** add CLI configuration and migrations; create schema/indexes/triggers/RLS; implement Auth session handling in main; device registration; repositories; revision conflicts; local outbox with bounded encrypted persistence; Realtime resubscription/catch-up; retention and account deletion flows.

**Definition of Done:** clean/upgrade migration tests pass; user A cannot access user B under any CRUD operation; offline mutations flush exactly once; conflict fixtures are deterministic; service key is absent from desktop artifacts.

## Stage 7 — Twitch OAuth, Helix, and EventSub

**Objective:** ingest Twitch events and execute allowed API operations without exposing credentials.

**Prerequisites:** Stage 6; registered Twitch application and callback configuration.

**Tasks:** implement PKCE/state flow, backend exchange, encrypted storage, delegated access acquisition, serialized refresh/rotation, account identity verification, Twurple API adapter, EventSub WS lifecycle, desired subscription reconciliation, dedupe TTL/LRU, rate-limit scheduler, revocation handling, and normalized activity projection.

**Definition of Done:** sandbox/test-account suite proves login, replay rejection, expiry, concurrent refresh, revocation, welcome/reconnect, duplicate floods, rate limiting, and reconnection without duplicate effects; tokens never cross IPC or enter logs.

## Stage 8 — Groq transcription adapter

Status: **complete**. See the [Stage 8 acceptance record](stage-8/acceptance-record.md).

**Objective:** transform bounded audio into reliable, observable text using `whisper-large-v3-turbo`.

**Prerequisites:** Stage 4; secure Groq credential injection.

**Tasks:** create main-process Groq client factory; multipart transcription adapter; deadlines/abort; error translation; retry and circuit breaker; transcript normalization; privacy/retention controls; latency metrics and redacted diagnostics; publish transcribing interaction state without exposing audio or transcript content.

**Definition of Done:** recorded fixtures cover silence, accents, noise, maximum duration, timeout, 429, 5xx, malformed response, cancel, and credential failure; no audio/transcript leaks under default settings; local dispatch meets budget.

## Stage 9 — Reasoning and guarded tool ingestion

Status: **complete**. See the [Stage 9 acceptance record](stage-9/acceptance-record.md).

**Objective:** convert transcripts into deterministic, policy-controlled tool plans through Groq reasoning models.

**Prerequisites:** Stages 3, 5, 7, and 8.

**Tasks:** create model selection/fallback config; prompt and tool-schema registry with versions; OpenAI-compatible payload adapter; validate structured tool calls; build execution context from redacted snapshots; enforce grants, confirmation, limits, idempotency, stale-state preconditions, and bounded feedback turns; record model/tool/policy versions; publish typed reasoning/tool-active/confirmation states.

**Definition of Done:** adversarial corpus proves prompt injection cannot bypass tool catalog/grants; malformed or hallucinated calls fail closed; confirmations expire; loops terminate at every ceiling; golden intents remain stable across configured models; duplicate retries do not duplicate side effects.

## Stage 10 — Production control board

Status: **complete**. See the [Stage 10 acceptance record](stage-10/acceptance-record.md).

**Objective:** deliver a fast, accessible, state-driven desktop interaction surface.

**Prerequisites:** stable IPC projections from Stages 2–9.

**Tasks:** finalize the semantic dark tokens and shadcn primitives from [experience architecture](07-experience-architecture.md); implement adaptive health panels, push-to-talk states, pending confirmation, virtualized activity timeline, filter/pagination, settings, actionable error recovery, the shared AI presence for listening/transcribing/reasoning/tool/speaking states, reduced-motion alternatives, and `speechSynthesis` queue/cancel/fallback; batch high-frequency updates and pause nonessential motion while hidden.

**Definition of Done:** keyboard and screen-reader flows pass; reduced motion works; 10,000-event fixture stays within frame/memory budgets; reload reconstructs from snapshot; every error code has an actionable presentation; no authoritative mutation occurs solely in renderer state.

## Stage 11 — Live-session orchestration, chat intelligence, and moderation

**Objective:** execute a complete, policy-controlled Twitch and OBS stream lifecycle from one voice or UI request, while providing bounded chat analysis and explicit creator-controlled moderation.

**Prerequisites:** Stages 5, 7, 9, and 10; a dedicated Twitch acceptance account; OBS WebSocket on loopback; Twitch reauthorization for only the scopes enabled by the user.

**Tasks:**

1. Define versioned `LiveSessionProfileV1`, `LiveSessionPlanV1`, `LiveSessionProjection`, `ChatMessageProjection`, `ChatAnalysisProjection`, and `ModerationIntentV1` contracts. Profiles store data—not hard-coded game scripts—including Twitch title/category/tags, required OBS scenes/inputs, pre-live scene, live scene, recording preference, and verification timeouts.
2. Add an Electron-main `ObsProcessSupervisor` that detects an existing OBS process or launches one configured executable using `spawn(executable, args, { shell: false })`; validate the absolute path, never accept a voice-supplied path, enforce one supervised instance, and wait for a validated WebSocket handshake before proceeding. Opening a Twitch dashboard uses only an allowlisted HTTPS origin through `shell.openExternal` and is never required for API execution.
3. Extend Twitch OAuth through incremental reauthorization and exact scope reconciliation. Core scopes are `channel:manage:broadcast` for title/category/tags, `user:read:chat` for EventSub chat messages, `moderator:manage:banned_users` for timeout/ban/unban, and `moderator:manage:chat_messages` for message deletion. Optional personal block/unblock uses the separate `user:manage:blocked_users` scope; optional chat replies use `user:write:chat`. Missing or revoked scopes disable only their associated tools.
4. Extend the Twurple adapter with category search and immutable game-ID resolution, channel-information read/update, stream status verification, chat-message EventSub ingestion, chat delete, timeout, ban/unban, personal block/unblock, and optional send-message operations. Reconcile `channel.update`, `stream.online`, `stream.offline`, `channel.chat.message`, deletion, clear-user, and ban events after reconnect.
5. Add exact versioned tools: `twitch.channel.update`, `twitch.chat.send_message`, `twitch.chat.delete_message`, `twitch.moderation.timeout_user`, `twitch.moderation.ban_user`, `twitch.moderation.unban_user`, `twitch.user.block`, and `twitch.user.unblock`. Channel bans and personal blocks remain distinct. Resolve a spoken/display login to an immutable provider user ID, reject ambiguous targets, and show the final ID/login, action, duration, reason code, and evidence message before approval.
6. Implement a durable saga-style `LiveSessionCoordinator` with states `draft -> preflight -> awaiting_confirmation -> applying_twitch -> preparing_obs -> starting_output -> verifying_live -> live`, plus `rolling_back`, `failed`, `stopping`, and `stopped`. A request such as “prepare a Sekiro stream and go live” resolves a profile, validates Twitch scopes and category, validates OBS resources, computes a redacted plan, requests confirmation, applies metadata, prepares OBS, starts output, and waits for authoritative OBS plus Twitch readiness.
7. Give every workflow and provider mutation a command ID, semantic idempotency key, expected provider snapshot/revision, deadline, and compensation record. Before live confirmation, preflight is read-only. If metadata succeeds but OBS preparation fails, restore captured metadata where safe. If start outcome is uncertain, resnapshot OBS and Twitch instead of retrying blindly. Stop/abort is always available and supersedes queued non-safety work.
8. Normalize chat events into a bounded sliding window with EventSub message-ID deduplication, per-user burst control, Unicode normalization, link/mention metadata, and badge/role flags. Run cheap deterministic rules first and batch only suspicious or requested content for Groq analysis. Analysis produces reason codes, confidence, severity, and a suggested action; it never grants permission or performs moderation itself.
9. Require explicit confirmation for permanent ban, personal block, bulk-clear, public chat send, and any low-confidence target. Timeout and single-message deletion may use a user-configurable policy but default to confirmation. Automatic permanent sanctions are prohibited. Broadcaster, moderator, allowlisted, and protected accounts fail closed before any model-selected action.
10. Keep raw chat text memory-bounded and non-persistent by default. Persist only redacted analysis/audit metadata and provider message/user identifiers needed for a short moderation evidence window. Any opt-in raw-text retention has an explicit purpose, expiry, export, and deletion path.
11. Add the Stage 10 session console: preflight checklist, planned Twitch/OBS changes, one final Go-Live approval, authoritative live status, stop/abort recovery, chat velocity and analysis summaries, moderation review queue, target identity display, undo where the provider permits it, and clear differentiation between timeout, channel ban, and personal block.
12. Build local dry-run mode that performs real voice reasoning and OBS preparation but substitutes recording for streaming and uses a deterministic Twitch mutation simulator. Then run a dedicated-account acceptance gate for metadata, EventSub chat, timeout/ban/unban, delete, block/unblock, start/stop verification, revocation, rate limits, disconnects, and rollback before any creator account is used.

**Definition of Done:** a packaged desktop executes the complete profile-driven voice-to-preflight-to-confirmation workflow; local dry-run never broadcasts publicly; a dedicated Twitch account proves metadata changes, chat ingestion, creator-approved moderation, OBS start/stop coordination, and authoritative online/offline verification; target-user mismatch, unconfirmed permanent sanctions, duplicate provider effects, leaked chat/token content, and unreconciled uncertain starts are all zero across adversarial, reconnect, retry, and rollback suites.

## Stage 12 — Controlled learning and evaluation

**Objective:** improve personal relevance through explicit feedback without unsafe online self-modification.

**Prerequisites:** Stage 9 audit/version data, Stage 10 feedback UX, and Stage 11 workflow/moderation outcomes.

**Tasks:** implement preference facts with provenance/confidence/expiry; feedback capture; redaction; evaluation dataset builder; offline replay harness; candidate policy/prompt versioning; acceptance thresholds; shadow evaluation; rollback; opt-in and deletion controls.

**Definition of Done:** preferences cannot grant tools or weaken confirmation; poisoned/outlier feedback is bounded; candidates cannot activate without evaluation approval; rollback restores prior behavior; deletion removes retained learning data under policy.

## Stage 13 — Reliability, security, and performance hardening

**Objective:** prove the whole system under failure, load, and hostile input.

**Prerequisites:** Stages 1–12 feature-complete.

**Tasks:** run threat-model review; dependency/SBOM/signing scans; IPC and schema fuzzing; chaos proxy tests; OBS/Twitch/Groq/Supabase outage matrix; clock/network/device fault injection; long-session soak; renderer profiling; memory/handle leak detection; log-redaction canaries; database load/index analysis.

**Definition of Done:** no critical/high unresolved security findings; 8-hour reference soak meets memory/crash thresholds; all recovery objectives and performance budgets pass; zero duplicate side effects across the chaos matrix.

## Stage 14 — Packaging, free-tier deployment, and release operations

**Objective:** ship reproducible desktop artifacts and operate the cloud portion within supported free tiers for initial use.

**Prerequisites:** Stage 13 and release credentials.

**Tasks:** configure Electron packaging per OS, code signing/notarization when credentials exist, secure update metadata, channel/version strategy, CI release provenance/checksums/SBOM, Supabase production migrations and environment secrets, OAuth production callbacks, rate/usage budgets, backups, diagnostics, crash reporting with consent, update rollback and database compatibility window.

“Free deployment” means using available free service tiers and public release hosting where their current limits fit; it cannot guarantee permanent zero cost, provider availability, signing certificates, domain names, or usage beyond quotas.

**Definition of Done:** fresh install, upgrade, downgrade-within-window, offline start, revoked credential, and rollback drills pass; artifacts verify checksums/signatures where configured; production has no development keys; documented free-tier alerts prevent silent quota failure.

## Stage 15 — Release candidate and production acceptance

**Objective:** convert the hardened build into a supportable production release.

**Prerequisites:** Stage 14.

**Tasks:** execute full traceability matrix; closed beta with telemetry consent; triage defects by severity; freeze contracts/migrations; write user-safe recovery/runbooks; test account export/deletion; capture baseline SLOs; tag immutable release and archive evidence.

**Definition of Done:** no release-blocking defects; every requirement maps to passing evidence; beta crash-free and latency targets hold; restore/rollback/deletion are witnessed; release owner signs the go/no-go record. At this gate ObscurPilot is a fully developed, packaged, deployable product baseline rather than a prototype.
