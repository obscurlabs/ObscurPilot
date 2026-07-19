import {
  announcementForAgent,
  SpeechFeedbackQueue,
} from '../../apps/desktop/src/lib/speech-feedback';
import { describe, expect, it, vi } from 'vitest';

function utterance(): SpeechSynthesisUtterance {
  return {
    voice: null,
    volume: 1,
    rate: 1,
    pitch: 1,
    onend: null,
    onerror: null,
  } as unknown as SpeechSynthesisUtterance;
}

describe('native speech feedback queue', () => {
  it('queues, selects a voice, drains in order and cancels safely', () => {
    const spoken: SpeechSynthesisUtterance[] = [];
    const voice = { voiceURI: 'voice-1' } as SpeechSynthesisVoice;
    const engine = {
      cancel: vi.fn(),
      getVoices: () => [voice],
      speak: (value: SpeechSynthesisUtterance) => spoken.push(value),
    };
    const queue = new SpeechFeedbackQueue(engine, utterance, vi.fn());
    const preferences = { enabled: true, voiceUri: 'voice-1', volume: 0.5 };

    queue.enqueue('First', preferences);
    queue.enqueue('Second', preferences);
    expect(spoken).toHaveLength(1);
    expect(spoken[0]?.voice).toBe(voice);
    expect(spoken[0]?.volume).toBe(0.5);
    spoken[0]?.onend?.call(spoken[0], {} as SpeechSynthesisEvent);
    expect(spoken).toHaveLength(2);

    queue.cancel();
    expect(queue.queuedCount).toBe(0);
    expect(engine.cancel).toHaveBeenCalledOnce();
  });

  it('uses visual fallback when native speech is unavailable', () => {
    const fallback = vi.fn();
    const queue = new SpeechFeedbackQueue(undefined, undefined, fallback);
    queue.enqueue('Approval required', { enabled: true, voiceUri: '', volume: 1 });
    expect(fallback).toHaveBeenCalledWith('Approval required');
  });

  it('announces only important bounded agent transitions', () => {
    expect(
      announcementForAgent({ phase: 'completed', reasonCode: 'DONE', elapsedMs: 10 }),
    ).toBeNull();
    expect(
      announcementForAgent({ phase: 'reasoning', reasonCode: 'MODEL_ACTIVE', elapsedMs: 10 }),
    ).toBeNull();
    expect(
      announcementForAgent({ phase: 'error', reasonCode: 'RATE_LIMITED', elapsedMs: 10 }),
    ).toBeNull();
  });
});
