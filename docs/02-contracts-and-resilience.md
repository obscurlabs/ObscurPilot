# IPC Contracts and Self-Healing Resilience

## 1. Envelope

Every request and event uses a versioned envelope:

```ts
type RequestEnvelope<T> = {
  protocolVersion: 1;
  requestId: string;
  sentAt: string;
  payload: T;
};

type ResultEnvelope<T> =
  { ok: true; requestId: string; data: T } | { ok: false; requestId: string; error: PublicError };

type PublicError = {
  code: string;
  message: string;
  retryable: boolean;
  correlationId: string;
  details?: Record<string, string | number | boolean>;
};
```

No stack trace, SDK response body, token, raw transcript, or filesystem path crosses IPC. Main verifies the sender frame and validates every payload with Zod before any side effect.

## 2. IPC channel registry

| Channel                   | Direction        | Payload/result                                         |
| ------------------------- | ---------------- | ------------------------------------------------------ |
| `app:get-bootstrap:v1`    | renderer -> main | `{}` -> `BootstrapProjection`                          |
| `state:get-snapshot:v1`   | renderer -> main | `{ afterVersion?: number }` -> `AppSnapshot`           |
| `state:changed:v1`        | main -> renderer | `{ snapshotVersion, patches: StatePatch[] }`           |
| `ptt:set-accelerator:v1`  | renderer -> main | `{ accelerator }` -> `{ registered }`                  |
| `ptt:command:v1`          | renderer -> main | `{ action: 'press'                                     | 'release'    | 'cancel' }`->`PttProjection` |
| `ptt:state:v1`            | main -> renderer | `{ sessionId?, phase, elapsedMs, level? }`             |
| `intent:approve:v1`       | renderer -> main | `{ pendingIntentId, decision }` -> `IntentProjection`  |
| `intent:state:v1`         | main -> renderer | redacted intent/tool-loop phase                        |
| `connection:command:v1`   | renderer -> main | `{ provider, action: 'connect'                         | 'disconnect' | 'retry' }`                   |
| `connection:state:v1`     | main -> renderer | `ConnectionProjection`                                 |
| `obs:get-snapshot:v1`     | renderer -> main | `{}` -> redacted `ObsProjection`                       |
| `twitch:begin-auth:v1`    | renderer -> main | `{}` -> `{ authorizationUrl, flowId }`                 |
| `twitch:complete-auth:v1` | renderer -> main | `{ flowId, callbackUrl }` -> account projection        |
| `live-session:command:v1` | renderer -> main | bounded prepare/start/stop/abort command -> projection |
| `live-session:state:v1`   | main -> renderer | redacted saga phase, checklist, effects, and recovery  |
| `chat:list:v1`            | renderer -> main | cursor/limit/filter -> bounded normalized chat page    |
| `chat:analysis:v1`        | main -> renderer | redacted aggregate/suggestion projection               |
| `moderation:command:v1`   | renderer -> main | typed target/action/evidence -> pending intent         |
| `moderation:state:v1`     | main -> renderer | redacted pending/result projection                     |
| `timeline:list:v1`        | renderer -> main | `{ cursor?, limit, filters? }` -> cursor page          |
| `timeline:append:v1`      | main -> renderer | `TimelineProjection`                                   |
| `settings:get:v1`         | renderer -> main | `{}` -> `SettingsProjection`                           |
| `settings:update:v1`      | renderer -> main | `{ revision, patch }` -> updated settings              |
| `feedback:submit:v1`      | renderer -> main | bounded `FeedbackInput` -> receipt                     |
| `diagnostics:export:v1`   | renderer -> main | `{ includeSensitive: false }` -> save-dialog result    |

Event subscription APIs must register exactly one IPC listener per callback and remove that same wrapped listener. Tests assert mount/unmount cycles leave listener counts unchanged.

## 3. Connection state machine

All providers implement:

```text
idle -> connecting -> authenticating -> synchronizing -> ready
                 \-> backoff <---------------------------/
any -> degraded -> reconnecting -> synchronizing -> ready
any -> auth_required
any -> stopped
```

Each transition includes `{provider, previous, current, attempt, changedAt, reasonCode, correlationId}`. Illegal transitions throw in development and emit a sanitized invariant violation in production.

### Backoff

Use full jitter:

```text
cap(attempt) = min(maxDelay, baseDelay * 2^attempt)
delay = random(0, cap(attempt))
```

Defaults: base 500 ms, max 30 s, maximum 8 automatic attempts per burst. Stable readiness for 60 seconds resets the attempt count. Online/offline signals may wake a timer but never bypass validation. Authentication and permission failures do not retry; they enter `auth_required`. Rate-limit responses honor provider reset/retry metadata before local backoff.

Only one connection attempt may exist per provider. Generation counters discard results from superseded attempts. All timers and SDK calls are abortable and disposed on shutdown.

## 4. Provider handshake and resynchronization

### OBS

1. Connect to configured `ws://127.0.0.1:4455` or explicit local address with password.
2. Complete OBS WebSocket identification and verify negotiated RPC compatibility.
3. Call `GetVersion`; reject unsupported protocol/version combinations.
4. Fetch an authoritative snapshot: version, studio mode, current program/preview scene, scene collection, scene list, inputs relevant to registered tool resources, and streaming/recording output status.
5. Subscribe to required event intents before declaring ready.
6. Buffer events received during the snapshot. Apply only events newer than the snapshot boundary where ordering can be established; otherwise refetch the affected resource.
7. On reconnect, replace the cached snapshot rather than replaying stale assumptions. Commands queued across disconnect expire; they are not automatically executed unless explicitly marked safe and their preconditions still hold.

### Twitch

1. Load the encrypted credential reference and validate token metadata.
2. Refresh before expiry through the controlled token service; serialize refreshes per account.
3. Query the authenticated Helix identity and verify it matches the stored broadcaster/user IDs.
4. Establish EventSub WebSocket through Twurple and await welcome/session readiness.
5. Recreate the desired subscription set idempotently from durable subscription specifications.
6. During server-directed reconnect, connect to the supplied reconnect URL and preserve continuity. After unclean loss, reconcile subscriptions and fetch state needed to close event gaps.
7. Do not persist raw EventSub session secrets in logs.

### Groq REST

Groq interactions are request/response, not treated as a persistent socket. The adapter tracks health as `unknown | ready | throttled | degraded | auth_required`. Each request has a timeout, abort signal, idempotent retry classification, and correlation ID. Retry only connect failures, 408, 429, and eligible 5xx responses. Transcription uploads and model calls retry at most twice when safe; malformed payloads, authentication errors, and policy rejections never retry. A circuit breaker opens after 5 qualifying failures in 30 seconds, probes after 20 seconds, and closes after 2 successful probes.

### Supabase

Realtime loss does not block local execution. Reconnect, reauthenticate the channel, reload rows updated after the last server cursor, then apply realtime events. Conflict rules use entity revision plus server `updated_at`: reject stale user edits, use last-writer-wins only for explicitly declared scalar preferences, and merge append-only event/audit data by ID.

## 5. Deduplication and rate limiting

- Incoming Twitch events use `provider + subscriptionType + messageId` as the dedupe key in a TTL cache. Default TTL is 15 minutes and maximum entries 10,000; persist keys only for workflows that can cause durable side effects.
- Commands use a client-generated `commandId` and semantic idempotency key. Completed keys are cached for 24 hours locally and recorded in audit storage where durable effects occur.
- Apply token buckets per provider, account, operation class, and tool. Twitch headers remain authoritative. Interactive work has priority over background reconciliation but cannot exceed upstream limits.
- Timeline rendering receives batches at most every 100 ms and retains a bounded in-memory window; older records are cursor-paged.

## 6. Error taxonomy

Canonical codes include `VALIDATION_FAILED`, `AUTH_REQUIRED`, `PERMISSION_DENIED`, `RESOURCE_NOT_FOUND`, `PRECONDITION_FAILED`, `RATE_LIMITED`, `UPSTREAM_UNAVAILABLE`, `TIMEOUT`, `CONFLICT`, `CANCELLED`, `POLICY_REJECTED`, and `INTERNAL`. Adapters translate SDK errors once at their boundary. UI behavior depends on code and retryability, never string matching.

## 7. Stage 11 Twitch capability and tool contract

The OAuth scope set is derived from enabled capabilities and compared with the validated token on every connection. The application never requests a union of every possible Twitch scope.

| Capability                 | Versioned tool                                  | Required scope                   | Default risk                    |
| -------------------------- | ----------------------------------------------- | -------------------------------- | ------------------------------- |
| Read chat                  | event ingestion only                            | `user:read:chat`                 | observe                         |
| Update title/category/tags | `twitch.channel.update@1`                       | `channel:manage:broadcast`       | confirm as part of Go-Live plan |
| Send a public message      | `twitch.chat.send_message@1`                    | `user:write:chat`                | confirm                         |
| Delete one message         | `twitch.chat.delete_message@1`                  | `moderator:manage:chat_messages` | confirm by default              |
| Timeout a channel user     | `twitch.moderation.timeout_user@1`              | `moderator:manage:banned_users`  | confirm by default              |
| Permanently ban/unban      | `twitch.moderation.ban_user@1` / `unban_user@1` | `moderator:manage:banned_users`  | always confirm                  |
| Personal block/unblock     | `twitch.user.block@1` / `unblock@1`             | `user:manage:blocked_users`      | always confirm                  |

Every moderation input contains `targetProviderUserId`, normalized `targetLogin`, `action`, optional bounded `durationSeconds`, a registry-owned `reasonCode`, optional `evidenceMessageId`, `expectedAccountRevision`, and `commandId`. Free-form evidence text is never accepted as authorization. Before execution, main re-resolves the target, rejects broadcaster/moderator/protected accounts, verifies that the evidence belongs to the target where supplied, checks the current token scope and moderator relationship, and reissues confirmation if any target or action field changed.

Live-session commands never expose arbitrary tool names. `live-session:command:v1` accepts only:

```ts
type LiveSessionCommand =
  | { action: 'prepare'; profileId: string; mode: 'dry_run' | 'live' }
  | { action: 'start'; planId: string; confirmationId: string }
  | { action: 'stop'; sessionId: string }
  | { action: 'abort'; sessionId: string; reasonCode: string };
```

Plans expire after 60 seconds by default and become invalid on any Twitch account revision, OBS generation/snapshot change, scope change, or profile revision change. `dry_run` structurally forbids Twitch broadcast start and substitutes an OBS recording verification step.
