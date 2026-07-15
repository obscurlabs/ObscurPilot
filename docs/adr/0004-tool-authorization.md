# ADR-0004: AI Tool Authorization

- **Status:** Accepted
- **Date:** 2026-07-15
- **Owners:** Stream/Event; Cloud/Security

## Context

Groq models propose local tool calls from untrusted speech and provider context. Model output is data, not authority.

## Decision

Only a versioned compiled Tool Registry maps a model-returned name to executable code. The Tool Gateway must validate the response, resolve exact name/version, parse strict arguments, load current context, verify grant and provider scope, verify resource/state preconditions, classify risk, obtain unexpired confirmation where required, acquire rate/idempotency controls, execute with deadline, normalize the result, and append a redacted audit record.

Unknown tools, extra properties, invalid sizes, stale resources, absent grants, and confirmation mismatches fail closed. The model cannot set risk, grants, scopes, idempotency semantics, or confirmation policy. Tool loops have hard turn, call, time, and byte ceilings.

Groq local tool calling leaves execution to application code: <https://console.groq.com/docs/tool-use/local-tool-calling>.

## Consequences

Adding a provider action requires a reviewed tool definition and grant model. Parallel calls execute only when the registry marks them independent and safe.

## Verification

Stage 9 adversarial tests cover prompt injection, tool-name confusion, schema smuggling, oversized arguments, repeated call IDs, stale confirmation/state, retry duplication, loop exhaustion, and cross-provider substitution.
