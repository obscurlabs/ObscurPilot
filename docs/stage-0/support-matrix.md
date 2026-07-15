# V1 Support and Compatibility Matrix

| Surface               | V1 status           | Minimum or target                                       | Acceptance rule                                                                       |
| --------------------- | ------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Windows               | Tier 1 GA           | Windows 10 22H2 and Windows 11, x64                     | Full packaged E2E, audio/hotkey, vault, OBS, update, and soak suites                  |
| macOS                 | Deferred            | macOS 13+, arm64/x64 candidate                          | Not supported until signing/notarization and Tier 1 tests pass on both architectures  |
| Linux                 | Deferred            | Modern x64 candidate                                    | Not supported until audio, shortcut, keyring, package, and update behavior is defined |
| Electron              | Tier 1              | Current stable selected in Stage 1                      | Remain within Electron's latest three supported stable majors                         |
| React/TypeScript/Vite | Tier 1              | Current stable, locked in Stage 1                       | Exact versions recorded in lockfile and compatibility manifest                        |
| OBS Studio            | Tier 1              | OBS 30.0+ and obs-websocket protocol 5.x                | Test latest two available stable OBS major lines before release                       |
| OBS WebSocket         | Tier 1              | Authenticated 5.x; default loopback port 4455           | Reject 4.x; validate RPC version; password required by default                        |
| Twitch                | Tier 1              | Helix REST and EventSub WebSocket through Twurple       | Fixtures plus test-account validation against current API                             |
| Groq STT              | Tier 1              | whisper-large-v3-turbo                                  | Config probe and recorded-fixture suite; local PTT is bounded below upstream limits   |
| Groq reasoning        | Tier 1 configurable | Primary openai/gpt-oss-120b; alternate qwen/qwen3.6-27b | Capability probe and golden/adversarial evaluation before activation                  |
| Supabase              | Tier 1              | Auth, Postgres, Realtime, RLS, server functions         | Local plus staging migrations and tenant-isolation tests                              |
| Web Speech API        | Best available      | OS voices exposed by Chromium                           | Visual result is canonical; missing voice never blocks completion                     |

OBS WebSocket 5.x is bundled with OBS Studio 28+ and defaults to 4455; V1 deliberately raises the product floor to OBS 30 to limit compatibility burden. Reference: <https://github.com/obsproject/obs-websocket>.

Groq currently documents the selected STT model, local tool use for both reasoning choices, and a 25 MB free-tier STT upload limit. References: <https://console.groq.com/docs/speech-to-text> and <https://console.groq.com/docs/tool-use/overview>.

## Hardware reference classes

| Class                 | CPU and RAM                            | Required behavior                                                        |
| --------------------- | -------------------------------------- | ------------------------------------------------------------------------ |
| Minimum               | 4 physical cores, 8 GB RAM, microphone | Correctness and security pass; latency reported but not release-blocking |
| Performance reference | 6+ modern cores, 16 GB RAM, SSD        | All latency and 8-hour soak budgets pass                                 |

Exact reference machines and audio devices become release metadata in Stage 12. GPU acceleration is not required.

## Compatibility rules

- Provider and model availability is checked with configuration and controlled probes.
- Preview models require an explicit feature flag and passing evaluation. The documented preview status of qwen/qwen3.6-27b prevents silent promotion to primary.
- Unsupported platforms are not labeled production-ready.
- Third-party breaking changes are contained inside adapters.
