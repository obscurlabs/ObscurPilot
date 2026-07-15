# ObscurPilot

ObscurPilot is a cloud-hybrid, ultra-low-latency, voice-controlled live-production desktop platform for solo creators. This repository follows a gated architecture-to-release roadmap; implementation may advance only after the preceding stage has verifiable acceptance evidence.

## Canonical documentation

1. [Product charter](docs/00-product-charter.md)
2. [System architecture](docs/01-system-architecture.md)
3. [Contracts and resilience](docs/02-contracts-and-resilience.md)
4. [Cloud data and security](docs/03-cloud-data-and-security.md)
5. [Engineering ownership](docs/04-engineering-roles.md)
6. [Road to achieve](docs/05-road-to-achieve.md)
7. [Learning, quality, and operations](docs/06-learning-quality-operations.md)
8. [Stage 0 architecture gate](docs/stage-0/README.md)
9. [Stage 1 monorepo and quality gate](docs/stage-1/README.md)
10. [Stage 2 secure desktop and IPC gate](docs/stage-2/README.md)
11. [Stage 3 domain kernel gate](docs/stage-3/README.md)

## Delivery status

| Stage                                             | Status   | Evidence                                               |
| ------------------------------------------------- | -------- | ------------------------------------------------------ |
| Stage 0 - Architecture and measurable contracts   | Complete | [Acceptance record](docs/stage-0/acceptance-record.md) |
| Stage 1 - Monorepo and quality foundation         | Complete | [Acceptance record](docs/stage-1/acceptance-record.md) |
| Stage 2 - Secure desktop shell and IPC spine      | Complete | [Acceptance record](docs/stage-2/acceptance-record.md) |
| Stage 3 - Domain kernel and connection supervisor | Complete | [Acceptance record](docs/stage-3/acceptance-record.md) |

## Fixed technology baseline

- Electron + React + TypeScript + Vite
- Tailwind CSS + shadcn/ui
- Groq `whisper-large-v3-turbo` for push-to-talk transcription
- Groq `openai/gpt-oss-120b` or `qwen/qwen3.6-27b` for tool-oriented reasoning
- Web Speech API for local spoken feedback
- `obs-websocket-js` for local OBS JSON-RPC on port 4455
- Twurple API and EventSub WebSocket packages for Twitch
- Supabase Auth, PostgreSQL, Realtime, and Row Level Security

## Architectural invariants

- The renderer is untrusted and never receives secrets, Node.js access, OAuth refresh tokens, or unrestricted IPC.
- Every command is schema-validated, permission-checked, idempotency-aware, audited, and bounded by timeouts.
- Local control remains usable during cloud degradation; cloud persistence never sits in the real-time OBS command path.
- “Learning” means controlled preference adaptation and offline evaluation, not self-modifying production code or unsupervised model training.
- A roadmap gate may only close when its stated automated and observable verification criteria pass.
