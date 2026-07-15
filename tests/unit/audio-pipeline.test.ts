import {
  AudioClipVault,
  BoundedPcmRingBuffer,
  PttAudioPipeline,
  encodeMonoPcm16Wav,
  type EncodedAudioClip,
} from '@obscurpilot/domain/audio-pipeline';
import { describe, expect, it, vi } from 'vitest';

function uuid(index: number): string {
  return '10000000-0000-4000-8000-' + index.toString().padStart(12, '0');
}

describe('bounded push-to-talk audio pipeline', () => {
  it('encodes only valid speech and rejects rapid taps and silence', () => {
    let nextId = 0;
    let now = 1_000;
    const pipeline = new PttAudioPipeline({
      id: () => uuid(++nextId),
      now: () => now,
      sampleRate: 16_000,
    });
    const rapid = pipeline.press();
    expect(rapid).toBeDefined();
    expect(pipeline.release(rapid!)).toBeUndefined();
    expect(pipeline.projection().phase).toBe('rejected');
    pipeline.cancel();

    const silent = pipeline.press()!;
    pipeline.armed(silent);
    now += 300;
    pipeline.append(silent, new Float32Array(4_800));
    expect(pipeline.release(silent)).toBeUndefined();
    expect(pipeline.projection().phase).toBe('rejected');

    const speech = pipeline.press()!;
    pipeline.armed(speech);
    pipeline.append(speech, new Float32Array(4_800).fill(0.2), 0.8);
    now += 300;
    const clip = pipeline.release(speech);
    expect(clip?.mimeType).toBe('audio/wav');
    expect(clip?.bytes.slice(0, 4)).toEqual(Uint8Array.from([82, 73, 70, 70]));
  });

  it('bounds oversized input and clears memory on cancel and interruption', () => {
    const buffer = new BoundedPcmRingBuffer(16);
    expect(buffer.append(new Float32Array(32).fill(0.5))).toBe(16);
    expect(buffer.sampleCount()).toBe(16);
    expect(buffer.wasTruncated()).toBe(true);
    buffer.clear();
    expect(buffer.sampleCount()).toBe(0);

    const pipeline = new PttAudioPipeline({ sampleRate: 100, maxDurationMs: 1_000 });
    const id = pipeline.press()!;
    pipeline.armed(id);
    pipeline.append(id, new Float32Array(200).fill(0.3));
    const clip = pipeline.release(id);
    expect(clip?.truncated).toBe(true);
    pipeline.interrupt();
    expect(pipeline.projection().phase).toBe('error');
    pipeline.cancel('SHUTDOWN');
    expect(pipeline.projection().phase).toBe('idle');
  });

  it('runs 1,000 capture cycles without retaining session buffers', () => {
    let nextId = 0;
    let clips = 0;
    const pipeline = new PttAudioPipeline({
      id: () => uuid(++nextId),
      minDurationMs: 1,
      onClip: () => {
        clips += 1;
      },
    });
    const samples = new Float32Array(32).fill(0.25);
    for (let cycle = 0; cycle < 1_000; cycle += 1) {
      const id = pipeline.press()!;
      pipeline.armed(id);
      pipeline.append(id, samples);
      pipeline.release(id);
    }
    expect(clips).toBe(1_000);
    expect(pipeline.projection().phase).toBe('ready');
  });

  it('zeroizes expired or disposed clip bytes', () => {
    vi.useFakeTimers();
    const bytes = encodeMonoPcm16Wav(new Int16Array([1, 2, 3]), 16_000);
    const clip: EncodedAudioClip = {
      clipId: uuid(1),
      sessionId: uuid(2),
      durationMs: 1,
      bytes,
      mimeType: 'audio/wav',
      truncated: false,
    };
    const vault = new AudioClipVault(100);
    vault.put(clip);
    vi.advanceTimersByTime(100);
    expect(vault.size()).toBe(0);
    expect(bytes.every((value) => value === 0)).toBe(true);
    vi.useRealTimers();
  });
});
