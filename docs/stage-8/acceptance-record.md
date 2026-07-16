# Stage 8 Acceptance Record

Status: **implementation and live provider gate accepted**

Recorded on: 2026-07-16

## Gate evidence

| Requirement               | Evidence                                                                                           | Result |
| ------------------------- | -------------------------------------------------------------------------------------------------- | ------ |
| Main-process custody      | Groq client is composed only in Electron main; renderer IPC carries redacted projections           | Pass   |
| Fixed STT model           | Runtime and contract accept only `whisper-large-v3-turbo`                                          | Pass   |
| Bounded upload            | WAV MIME and 25 MiB ceiling are enforced before provider dispatch                                  | Pass   |
| Deadline and cancellation | Parent abort, request deadline, retry translation, and circuit state have deterministic fixtures   | Pass   |
| Transcript normalization  | Unicode normalization, whitespace collapse, control removal, and 16,000-character bound are tested | Pass   |
| Privacy and retention     | Audio bytes are zeroized; transcript/audio are absent from projections and diagnostics             | Pass   |
| Local latency             | 100 maximum-duration dispatches satisfy p95 <= 120 ms                                              | Pass   |
| Live provider             | Generated local speech produced a non-empty transcription through the configured Groq account      | Pass   |

## Live acceptance

The redacted live verifier completed against the configured Groq account with `configured: true` and `stt: true`. It deliberately emitted no recognized text, request body, API key, or raw provider response. The temporary WAV fixture was deleted immediately after the call.

## Regression evidence

- Static TypeScript, ESLint, and Prettier gates pass.
- The final combined repository run passes 72 unit tests, 18 contract tests, 5 deterministic integration tests, 1 chaos test, and 3 performance tests.
- Production build and renderer secret-boundary scan pass.
- Direct Electron, packaged Electron, and 100-cycle packaged startup/shutdown tests pass.
