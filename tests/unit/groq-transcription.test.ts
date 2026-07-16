import {
  createGroqClient,
  GroqAdapterError,
  GroqTranscriptionAdapter,
  normalizeTranscript,
  translateGroqError,
  type TranscriptionTransport,
} from '@obscurpilot/adapters-groq/boundary';
import { encodeMonoPcm16Wav, type EncodedAudioClip } from '@obscurpilot/domain/audio-pipeline';
import { APIError } from 'groq-sdk';
import { describe, expect, it, vi } from 'vitest';

const id = '10000000-0000-4000-8000-000000000001';

function clip(overrides: Partial<EncodedAudioClip> = {}): EncodedAudioClip {
  return {
    clipId: id,
    sessionId: '10000000-0000-4000-8000-000000000002',
    durationMs: 500,
    bytes: encodeMonoPcm16Wav(new Int16Array(8_000).fill(2_000), 16_000),
    mimeType: 'audio/wav',
    truncated: false,
    ...overrides,
  };
}

function adapter(
  implementation: TranscriptionTransport['transcribe'],
  overrides: Partial<ConstructorParameters<typeof GroqTranscriptionAdapter>[0]> = {},
) {
  return new GroqTranscriptionAdapter({
    transport: { transcribe: implementation },
    maxAttempts: 1,
    random: () => 0,
    ...overrides,
  });
}

describe('Groq transcription boundary', () => {
  it('normalizes multilingual text without losing accents', async () => {
    expect(normalizeTranscript('  café\n  नमस्ते\u0000  world  ')).toBe('café नमस्ते world');
    const result = await adapter(async ({ file, model }) => {
      expect(file.name).toBe(`${id}.wav`);
      expect(file.type).toBe('audio/wav');
      expect(model).toBe('whisper-large-v3-turbo');
      return { text: '  café   stream  ' };
    }).transcribe(clip(), id, new AbortController().signal);
    expect(result.text).toBe('café stream');
    expect(result.attempts).toBe(1);
  });

  it('maps silence and malformed responses to terminal faults', async () => {
    await expect(
      adapter(async () => ({ text: ' \n ' })).transcribe(clip(), id, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'NO_SPEECH', retryable: false });
    await expect(
      adapter(async () => ({ transcript: 'hidden' })).transcribe(
        clip(),
        id,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE', retryable: false });
  });

  it('accepts the bounded maximum-duration fixture and rejects oversized uploads', async () => {
    const maximum = clip({ durationMs: 30_000, truncated: true });
    await expect(
      adapter(async () => ({ text: 'maximum duration accepted' })).transcribe(
        maximum,
        id,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ text: 'maximum duration accepted' });
    const oversized = clip({ bytes: new Uint8Array(25 * 1024 * 1024 + 1) });
    await expect(
      adapter(async () => ({ text: 'never' })).transcribe(
        oversized,
        id,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'UPSTREAM_REJECTED' });
  });

  it('enforces deadlines and caller cancellation', async () => {
    const waitsForAbort: TranscriptionTransport['transcribe'] = ({ signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
          once: true,
        });
      });
    await expect(
      adapter(waitsForAbort, { timeoutMs: 5 }).transcribe(clip(), id, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });

    const controller = new AbortController();
    controller.abort();
    await expect(
      adapter(async () => ({ text: 'never' })).transcribe(clip(), id, controller.signal),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('retries 429 and 5xx responses but never retries credential failures', async () => {
    const retryable = [429, 503];
    for (const status of retryable) {
      const request = vi
        .fn<TranscriptionTransport['transcribe']>()
        .mockRejectedValueOnce(new APIError(status, {}, 'provider failure', new Headers()))
        .mockResolvedValueOnce({ text: 'recovered' });
      await expect(
        adapter(request, { maxAttempts: 3 }).transcribe(clip(), id, new AbortController().signal),
      ).resolves.toMatchObject({ attempts: 2, text: 'recovered' });
      expect(request).toHaveBeenCalledTimes(2);
    }

    const auth = vi
      .fn<TranscriptionTransport['transcribe']>()
      .mockRejectedValue(new APIError(401, {}, 'invalid key', new Headers()));
    await expect(
      adapter(auth, { maxAttempts: 3 }).transcribe(clip(), id, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED', retryable: false });
    expect(auth).toHaveBeenCalledOnce();
  });

  it('keeps transcript and audio content out of operational diagnostics', async () => {
    const events: unknown[] = [];
    const secretTranscript = 'private spoken command';
    const audio = clip();
    await adapter(async () => ({ text: secretTranscript }), {
      onEvent: (event) => events.push(event),
    }).transcribe(audio, id, new AbortController().signal);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(secretTranscript);
    expect(serialized).not.toContain('RIFF');
    expect(events).toHaveLength(2);
  });

  it('requires a non-empty credential and translates non-retryable provider errors', () => {
    expect(() => createGroqClient({ apiKey: '' })).toThrow('required');
    expect(translateGroqError(new APIError(400, {}, 'bad request', new Headers()))).toMatchObject({
      code: 'UPSTREAM_REJECTED',
      retryable: false,
    });
  });

  it('opens its circuit after five qualifying failures', async () => {
    const failing = adapter(
      async () => {
        throw new GroqAdapterError('UPSTREAM_UNAVAILABLE', 'offline', true);
      },
      { maxAttempts: 1, now: () => 1_000 },
    );
    for (let index = 0; index < 5; index += 1) {
      await expect(
        failing.transcribe(clip(), id, new AbortController().signal),
      ).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
    }
    await expect(
      failing.transcribe(clip(), id, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'CIRCUIT_OPEN' });
  });
});
