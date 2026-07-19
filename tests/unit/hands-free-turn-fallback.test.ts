import { describe, expect, it, vi } from 'vitest';
import type { EncodedAudioClip } from '@obscurpilot/domain/audio-pipeline';
import { HandsFreeTurnFallback } from '../../apps/desktop/electron/hands-free-turn-fallback';

function clip(fill = 7): EncodedAudioClip {
  return {
    clipId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    durationMs: 500,
    bytes: new Uint8Array(64).fill(fill),
    mimeType: 'audio/wav',
    truncated: false,
  };
}

describe('hands-free realtime turn fallback', () => {
  it('lets an actual realtime response claim the local clip without duplicate execution', () => {
    vi.useFakeTimers();
    const fallback = vi.fn();
    const router = new HandsFreeTurnFallback({ onFallback: fallback, graceMs: 2_500 });
    const value = clip();
    router.beginRealtimeTurn();
    router.enqueue(value);
    router.commitRealtimeTurn();
    vi.advanceTimersByTime(3_000);
    expect(fallback).not.toHaveBeenCalled();
    expect(value.bytes.every((byte) => byte === 0)).toBe(true);
    router.dispose();
    vi.useRealTimers();
  });

  it('does not cancel fallback merely because realtime STT heard the creator', async () => {
    vi.useFakeTimers();
    const fallback = vi.fn(async () => undefined);
    const router = new HandsFreeTurnFallback({
      onFallback: fallback,
      graceMs: 2_500,
      progressGraceMs: 4_000,
    });
    const value = clip();
    router.enqueue(value);
    router.beginRealtimeTurn();
    await vi.advanceTimersByTimeAsync(3_999);
    expect(fallback).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fallback).toHaveBeenCalledWith(value);
    expect(router.acceptsRealtimeOutput()).toBe(false);
    router.beginRealtimeTurn();
    expect(router.acceptsRealtimeOutput()).toBe(true);
    router.dispose();
    vi.useRealTimers();
  });

  it('uses the local STT path when realtime voice does not claim the turn', async () => {
    vi.useFakeTimers();
    const fallback = vi.fn(async () => undefined);
    const router = new HandsFreeTurnFallback({ onFallback: fallback, graceMs: 2_500 });
    const value = clip();
    router.enqueue(value);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(fallback).toHaveBeenCalledWith(value);
    router.dispose();
    vi.useRealTimers();
  });

  it('matches a committed response that arrives just before its local clip', () => {
    vi.useFakeTimers();
    let now = 1_000;
    const fallback = vi.fn();
    const router = new HandsFreeTurnFallback({
      onFallback: fallback,
      graceMs: 2_500,
      now: () => now,
    });
    router.beginRealtimeTurn();
    router.commitRealtimeTurn();
    now += 100;
    const value = clip();
    router.enqueue(value);
    vi.advanceTimersByTime(3_000);
    expect(fallback).not.toHaveBeenCalled();
    expect(value.bytes.every((byte) => byte === 0)).toBe(true);
    router.dispose();
    vi.useRealTimers();
  });
});
