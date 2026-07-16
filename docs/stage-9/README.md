# Stage 9: Reasoning and Guarded Tool Ingestion

Status: implementation, hosted policy deployment, live Groq acceptance, and packaged desktop gate complete.

- [Acceptance record](acceptance-record.md)

## Delivered boundary

- `GroqReasoningAdapter` uses the OpenAI-compatible Groq chat-completions transport with a configured primary model and optional fallback model.
- `ToolRegistry` exposes exact, versioned model names, descriptions, JSON Schemas, risk classes, parsers, authorization handlers, and execution handlers.
- The orchestration prompt treats transcripts and provider labels as untrusted data. The model can select only supplied tools; it cannot grant permission or confirm an operation.
- Tool calls pass strict response validation, JSON parsing, per-tool Zod parsing, persisted grant checks, confirmation policy, captured OBS snapshot/generation preconditions, and an idempotency ledger before execution.
- The loop has independent ceilings for turns, tool-call count, argument bytes, and active wall time. Confirmation wait pauses the wall-time budget without removing the 15-second confirmation expiry.
- OBS tools cover read-only snapshots, program-scene changes, input mute state, streaming state, and recording state. Stream and recording start/stop operations always require explicit confirmation.
- Twitch is exposed at this stage only through the read-only connection projection. No broader remote permission is inferred.
- Audit rows record hashed command identities plus model, prompt, tool, and policy versions. Raw transcript text, tool arguments, tool results, and credentials are excluded.

## Hosted policy

Migration `202607160005_stage9_default_tool_policy.sql` creates or reuses an active control profile and applies least-privilege default grants for existing and future users. The private bootstrap function is security-definer, has a fixed empty search path, and is revoked from `public`, `anon`, and `authenticated`.

The hosted Supabase project is synchronized through migration `202607160005`.

## Development configuration

```env
GROQ_REASONING_MODEL=openai/gpt-oss-120b
GROQ_REASONING_FALLBACK_MODEL=qwen/qwen3.6-27b
```

The fallback is optional. Stage 9 tests both allowed model identities through the same strict response and tool boundary.

## Verification

```powershell
npm run verify:static
npm run test:unit
npm run test:contract
npm run test:integration
npm run test:chaos
npm run test:performance
npm run build
npm run verify:renderer-boundary
npm run package:dir
npm run test:e2e
```
