# Stage 8: Groq Transcription Adapter

Status: implementation and live Groq acceptance complete.

- [Acceptance record](acceptance-record.md)

## Delivered boundary

- Electron main owns the Groq client and API credential. Neither the renderer nor preload receives the credential, audio bytes, or transcript text.
- `GroqTranscriptionAdapter` sends bounded WAV clips to `whisper-large-v3-turbo` through the official Groq SDK transport.
- The request path has an explicit deadline, parent cancellation, bounded retry with jitter, circuit breaking, provider-error translation, and normalized transcript output.
- The one-shot audio service consumes each clip once. The orchestration path zeroizes the local byte array after success, rejection, cancellation, or failure.
- Operational events carry correlation, timing, model, attempt, and outcome metadata only. Audio and transcript content are excluded.
- The renderer receives only typed interaction phases and reason codes: it cannot inspect the transcript or reconstruct the audio.

## Development configuration

```env
GROQ_API_KEY=<user-owned key>
GROQ_STT_MODEL=whisper-large-v3-turbo
```

The credential belongs only in the uncommitted root `.env` during development. A production credential must be stored through the OS credential boundary rather than bundled in the application.

## Verification

```powershell
npm run verify:static
npm run test:unit
npm run test:performance
npm run build
npm run verify:renderer-boundary
```

The optional live acceptance helper is `scripts/verify-groq-live.mjs`. It accepts a local WAV fixture path and prints only booleans, model identity, timing, and safe failure codes; it never prints the transcript or credential.
