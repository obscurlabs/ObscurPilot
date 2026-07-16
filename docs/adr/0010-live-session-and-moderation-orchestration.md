# ADR-0010: Guarded Live-Session and Moderation Orchestration

- **Status:** Accepted
- **Date:** 2026-07-16
- **Owners:** Core Desktop; Stream/Event; Cloud/Security; UI/UX

## Context

A creator expects one request such as “prepare my Sekiro stream and go live” to coordinate Twitch metadata, OBS resources, output start, live verification, chat awareness, and later moderation commands. These are multiple distributed side effects across an OS process, local OBS JSON-RPC, Twitch Helix, EventSub, Groq, and Supabase. Treating them as one unconstrained model loop would create duplicate-start, wrong-target, over-scoped OAuth, and irreversible moderation risks.

Twitch separates broadcast management, chat receipt, message deletion, channel ban/timeout, and personal blocking into different APIs and OAuth scopes. A channel ban is not a personal block. Provider display names are mutable and cannot be the execution identity.

## Decision

Stage 11 introduces a deterministic saga-style `LiveSessionCoordinator` above the versioned Tool Gateway. The model may select a stored profile and request preparation, but only application code controls the step order, preconditions, confirmation boundary, idempotency, verification, compensation, and emergency stop.

Preflight is read-only and captures the profile revision, Twitch account/scope/metadata revision, immutable category ID, OBS generation/snapshot, required resources, intended changes, and plan hash. A live plan expires after 60 seconds and requires one explicit final approval. Any captured revision change invalidates approval. Dry-run mode is a distinct type that cannot start streaming and substitutes OBS recording plus simulated Twitch mutations.

Chat EventSub payloads are normalized and bounded before use. Deterministic rules precede model analysis. Analysis yields a suggestion only. Moderation execution requires an exact registered tool, current OAuth scope, immutable provider user ID, protected-account checks, optional evidence ownership validation, current state, idempotency, and the risk-appropriate creator confirmation.

The following capabilities remain separate:

- channel metadata: `channel:manage:broadcast`;
- chat ingestion: `user:read:chat`;
- message deletion: `moderator:manage:chat_messages`;
- timeout/ban/unban: `moderator:manage:banned_users`;
- personal block/unblock: `user:manage:blocked_users`;
- optional public reply: `user:write:chat`.

OAuth requests only enabled scopes and requires incremental reauthorization when capabilities change. Automatic permanent bans, automatic personal blocks, and model-approved public posting are prohibited. Chat text is memory-bounded and not persisted by default.

The provider requirements are defined by Twitch’s [API reference](https://dev.twitch.tv/docs/api/reference), [EventSub subscription types](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/), and [scope catalog](https://dev.twitch.tv/docs/authentication/scopes/).

## Consequences

The complete workflow becomes locally testable after Stage 11 without pretending that Stage 10’s UI alone supplies provider capabilities. Additional profile types can be added as data. New moderation actions require separate reviewed tools and scopes. The design adds saga and evidence-retention complexity but provides deterministic recovery, observable progress, and a defensible approval boundary.

## Verification

Stage 11 must pass local dry-run, dedicated Twitch account, packaged Electron, adversarial chat, wrong/ambiguous target, protected-account, stale plan, expired confirmation, missing/revoked scope, duplicate EventSub, rate limit, disconnect, uncertain start/stop, compensation, and emergency-stop suites. Acceptance requires zero public broadcasts in dry-run, zero wrong-user actions, zero unconfirmed permanent sanctions, and zero duplicate provider effects.
