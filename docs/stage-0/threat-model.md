# Threat Model

## Scope

V1 desktop, local OBS, Groq requests, Twitch OAuth/API/EventSub, Supabase Auth/data/Realtime/functions, update channel, and diagnostics are in scope. The OS and providers are dependencies, not assumed invulnerable. Fully compromised administrator/root access is outside prevention scope, but secret minimization reduces impact.

## Assets

1. Groq user key and request content.
2. Twitch codes, tokens, scopes, and account identity.
3. OBS password and production-control authority.
4. Supabase session, service secrets, configuration, grants, and audits.
5. Microphone audio, transcript, feedback, and preferences.
6. Tool policy, command integrity, idempotency, and confirmations.
7. Desktop binary, updates, migrations, and dependency chain.

## Trust boundaries

    [Microphone/hotkey]
            | TB1
            v
    [Electron Main + policy + vault] --TB2 typed IPC--> [Preload] --TB3--> [React]
       |             |              |
     TB4           TB5            TB6
       v             v              v
    [OBS 4455]    [Groq TLS]   [Supabase TLS/Auth/RLS]
                                      |
                               TB7 server secrets
                                      v
                               [Twitch OAuth/API/EventSub]

    [Protected CI/signing] --TB8 signed artifact/metadata--> [Updater/Main]

TB1 is untrusted and bounded. TB2/TB3 convey no generic authority. TB4 requires OBS authentication. TB5-TB7 require TLS, fixed origins, deadlines, schemas, and redaction. TB8 requires immutable tags, least-privilege credentials, provenance, and signature/checksum verification.

## STRIDE controls

| ID    | Category     | Threat                                   | Required controls                                                      | Verification |
| ----- | ------------ | ---------------------------------------- | ---------------------------------------------------------------------- | ------------ |
| TM-01 | Spoofing     | Renderer impersonates allowed IPC        | frame/origin/webContents check, fixed channels, schemas, no raw IPC    | Stages 2, 12 |
| TM-02 | Spoofing     | OAuth callback/account substitution      | PKCE, state/nonce, single-use flow, callback allowlist, identity match | 7, 12        |
| TM-03 | Spoofing     | Rogue OBS endpoint                       | explicit endpoint, password, protocol/version handshake                | 5            |
| TM-04 | Tampering    | Prompt/provider text injects a tool      | Tool Gateway grants, schema, preconditions, risk, confirmation         | 9, 12        |
| TM-05 | Tampering    | Sync reorders or overwrites state        | revision CAS, immutable IDs, aggregate ordering, reconciliation        | 6, 12        |
| TM-06 | Tampering    | Update/dependency compromise             | lockfile, protected CI, SBOM, tags, signed metadata/artifacts          | 1, 12, 13    |
| TM-07 | Repudiation  | Command lacks attribution                | correlation/command/idempotency IDs, terminal audit, recovery marker   | 3, 6, 9      |
| TM-08 | Disclosure   | Secret enters renderer/bundle/log        | vaults, redaction canaries, no Vite/Web Storage secrets                | 2, 6-8, 12   |
| TM-09 | Disclosure   | Cross-tenant Supabase access             | forced RLS, owner keys, service-role isolation, role matrix            | 6, 12        |
| TM-10 | Disclosure   | Audio/transcript retained                | bounded lifecycle, default-off retention, consent/deletion             | 4, 8, 11     |
| TM-11 | Denial       | Event flood exhausts UI/memory           | bounded queues/TTL-LRU, batching, virtualization, backpressure         | 3, 7, 10, 12 |
| TM-12 | Denial       | Outage creates retry storm               | full jitter, single attempt, breaker, upstream metadata, caps          | 3, 5-8, 12   |
| TM-13 | Elevation    | React obtains native authority           | sandbox, isolation, narrow preload, denied navigation/permissions      | 2, 12        |
| TM-14 | Elevation    | Model invents grant/tool/scope           | compiled registry and independent authorization                        | 3, 9, 11     |
| TM-15 | Elevation    | Security-definer function abuse          | avoid by default; fixed search path, grants, auth.uid check            | 6, 12        |
| TM-16 | Replay       | Duplicate event/command repeats effect   | message dedupe, ledger, idempotency, expiry                            | 3, 7, 9, 12  |
| TM-17 | Exfiltration | Dynamic URL sends credentials away       | fixed SDK bases, origin allowlist, strict redirects                    | 2, 7-9, 12   |
| TM-18 | Disclosure   | Vault failure creates plaintext fallback | fail closed and reauthorize                                            | 4-8, 12      |

## Required abuse cases

- A transcript requests bypassing policy or invoking an unregistered tool: reject before adapter resolution.
- An EventSub notification arrives twice: the second produces no repeated effect.
- Renderer sends a valid tool name on an invented IPC channel: no exposed capability exists.
- User changes a provider ID in a cloud request: RLS and ownership constraints reject it.
- OAuth callback has different/reused state: reject before exchange.
- Network dies after provider acceptance but before response: reconcile; never blindly replay.

## Review triggers

Revisit this model for every new provider, tool risk class, credential type, remote content surface, service worker, native module, updater change, retention expansion, or security-definer function.
