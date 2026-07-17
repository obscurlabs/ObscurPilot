import { describe, expect, it } from 'vitest';
import { HandsFreeConversation } from '../../apps/desktop/electron/hands-free-conversation';

const preferences = {
  enabled: true,
  wakePhrase: 'Hi Obscur',
  speechThreshold: 0.018,
  silenceReleaseMs: 850,
  conversationWindowMs: 300_000,
} as const;

describe('hands-free conversation boundary', () => {
  it('requires the wake phrase before accepting a background utterance', () => {
    const controller = new HandsFreeConversation(
      preferences,
      () => undefined,
      () => 1_000,
    );
    expect(controller.acceptTranscript('random room conversation', 'hands_free')).toEqual({
      accepted: false,
      command: '',
      woke: false,
    });
    expect(
      controller.acceptTranscript(
        'Hi Obscur, we are streaming Sekiro with a five minute countdown',
        'hands_free',
      ),
    ).toMatchObject({
      accepted: true,
      command: 'we are streaming Sekiro with a five minute countdown',
      woke: true,
    });
  });

  it('accepts follow-up commands during the bounded conversation window', () => {
    let now = 1_000;
    const controller = new HandsFreeConversation(
      preferences,
      () => undefined,
      () => now,
    );
    controller.acceptTranscript('Hey Obscur prepare Sekiro', 'hands_free');
    now += 10_000;
    expect(controller.acceptTranscript('use five minutes', 'hands_free')).toMatchObject({
      accepted: true,
      command: 'use five minutes',
      woke: false,
    });
    now += 300_001;
    expect(controller.acceptTranscript('start it', 'hands_free').accepted).toBe(false);
  });

  it('publishes a bounded speech event and returns to follow-up listening', () => {
    const projections: unknown[] = [];
    const controller = new HandsFreeConversation(preferences, (value) => projections.push(value));
    const speaking = controller.speak('The production plan is ready.');
    expect(speaking).toMatchObject({
      phase: 'speaking',
      speech: { text: 'The production plan is ready.' },
    });
    expect(controller.speechFinished(speaking.speech!.id)).toMatchObject({
      phase: 'standby',
      reasonCode: 'FOLLOW_UP_LISTENING',
    });
    expect(projections).toHaveLength(2);
  });
});
