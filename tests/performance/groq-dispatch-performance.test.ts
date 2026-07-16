import { GroqTranscriptionAdapter } from '@obscurpilot/adapters-groq/boundary';
import { encodeMonoPcm16Wav, type EncodedAudioClip } from '@obscurpilot/domain/audio-pipeline';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';

describe('Groq local dispatch budget', () => {
  it('dispatches a maximum-duration WAV at p95 below 120 ms', async () => {
    const bytes = encodeMonoPcm16Wav(new Int16Array(16_000 * 30).fill(1_000), 16_000);
    const clip: EncodedAudioClip = {
      clipId: '10000000-0000-4000-8000-000000000001',
      sessionId: '10000000-0000-4000-8000-000000000002',
      durationMs: 30_000,
      bytes,
      mimeType: 'audio/wav',
      truncated: true,
    };
    const dispatchLatency: number[] = [];
    let iterationStartedAt = 0;
    const adapter = new GroqTranscriptionAdapter({
      maxAttempts: 1,
      transport: {
        transcribe: async () => {
          dispatchLatency.push(performance.now() - iterationStartedAt);
          return { text: 'fixture' };
        },
      },
    });
    for (let index = 0; index < 100; index += 1) {
      iterationStartedAt = performance.now();
      await adapter.transcribe(
        { ...clip, bytes: new Uint8Array(bytes) },
        crypto.randomUUID(),
        new AbortController().signal,
      );
    }
    dispatchLatency.sort((left, right) => left - right);
    const p95 = dispatchLatency[Math.ceil(dispatchLatency.length * 0.95) - 1];
    expect(p95).toBeDefined();
    expect(p95!).toBeLessThanOrEqual(120);
  });
});
