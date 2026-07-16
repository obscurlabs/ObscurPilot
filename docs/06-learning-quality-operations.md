# Controlled Learning, Quality, and Operations

## 1. Learning model

ObscurPilot does not perform online reinforcement learning against model weights. It uses a safer three-layer improvement system:

1. **Deterministic preference memory:** explicit or strongly evidenced user preferences stored as versioned facts.
2. **Outcome feedback:** thumbs/reason codes and command outcomes linked to redacted context, tool, model, prompt, and policy versions.
3. **Offline evaluation and promotion:** candidate prompts, routing rules, and defaults run against curated/replayed datasets before controlled rollout.

A preference record contains `id`, `user_id`, `key`, typed `value`, `source`, `confidence`, `evidence_count`, `created_at`, `last_confirmed_at`, `expires_at`, and `revision`. Allowed keys come from a registry. Preferences may affect presentation, model routing, and default non-security behavior. They cannot create permissions, change tool risk, skip confirmations, expand scopes, or override resource preconditions.

Chat and moderation outcomes may improve classification thresholds, language/context preferences, summary grouping, and which items are surfaced for review. They may not automatically add a protected user to a sanction target, turn a suggestion into execution, expand a timeout into a permanent ban, conflate a channel ban with a personal block, or learn to suppress confirmation. False-positive moderation carries a release-blocking weight higher than missed low-severity classification.

## 2. Candidate promotion gate

```text
feedback -> redact/validate -> evaluation dataset -> candidate version
         -> offline replay -> safety regression -> shadow comparison
         -> reviewed promotion -> canary -> full rollout / rollback
```

Candidate reports include task success, false execution, clarification rate, latency, token use, policy rejection, moderation precision/recall, target-identity accuracy, sanction-severity confusion, and regressions by scenario. Any safety regression blocks promotion regardless of average quality gain. Every active prompt/policy/model routing configuration has an immutable version and immediate rollback target.

## 3. Test pyramid

- **Unit:** schemas, reducers, FSM transitions, retry math, policy decisions, dedupe, redaction.
- **Contract:** IPC envelopes, tool JSON schemas, SDK adapter fixtures, SQL repository behavior.
- **Integration:** Electron main/preload, real OBS, local Supabase, Twitch test account/mock protocol, chat/moderation fixtures, Groq recorded/mock error cases.
- **E2E:** packaged app from push-to-talk through preflight/confirmation, visible/audible result, provider verification, moderation review, and audited completion.
- **Chaos:** socket termination, latency, packet loss, 429/5xx, token expiry, process crash, device removal, clock skew.
- **Performance:** cold start, event burst, timeline render, voice dispatch, memory/handle soak.
- **Security:** RLS tenant matrix, IPC fuzzing, bundle/secret scans, dependency review, OAuth abuse cases.

CI keeps deterministic tests on every change. Provider and packaged compatibility suites run on protected schedules and release candidates.

## 4. Observability

Use structured events with `timestamp`, `level`, `service`, `event`, `appVersion`, `sessionId`, `correlationId`, `provider`, `durationMs`, `outcome`, and sanitized metadata. Correlation flows from PTT session through transcription, reasoning, tool execution, provider RPC, timeline, and audit.

Metrics include connection availability, reconnect duration/attempts, transcription latency, reasoning latency/turn count, tool latency/outcome, provider rate-limit headroom, dedupe hits, outbox depth/age, Realtime lag, renderer long tasks, memory, and crash-free sessions. Metrics must not contain transcript text, tokens, display names, or raw tool arguments.

## 5. Operational runbooks

Maintain tested runbooks for:

- OBS authentication/version mismatch and restart loops;
- Twitch token revocation, subscription failure, and exhausted rate limits;
- Twitch chat outage/flood, mistaken-target recovery, moderation reversal where supported, uncertain stream start, and emergency stop;
- Groq throttling/outage and model configuration rollback;
- Supabase outage, migration failure, RLS incident, restore, and quota exhaustion;
- corrupted local cache/outbox recovery;
- compromised credential rotation;
- bad desktop release/update rollback;
- account export, deletion, and retention enforcement.

## 6. Release governance

- Semantic version desktop, IPC protocol, tool schemas, prompts/policies, and database migrations independently.
- Maintain backward database compatibility for at least the supported desktop update window.
- Release artifacts are generated only by protected CI from immutable tags.
- Attach checksums, SBOM, test evidence, migration notes, known limitations, and rollback instructions.
- Never call a build production-ready while a required provider integration is only mocked.

## 7. Competitive engineering bar

Superiority over any competing product must be demonstrated, not asserted. Maintain a repeatable benchmark matrix for equivalent, permission-safe scenarios: local command latency, reconnection recovery time, duplicate-action rate, setup completion, long-session stability, accessibility, offline degradation, and diagnostic clarity. Publish the measurement environment and do not claim advantages where equivalent measurements are unavailable.
