import { describe, expect, it } from 'vitest';
import {
  failureSpeech,
  HandsFreeConversation,
} from '../../apps/desktop/electron/hands-free-conversation';

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

  it('clears a prior error from the overlay when a later command completes', () => {
    const controller = new HandsFreeConversation(preferences, () => undefined);
    controller.syncAgent({ phase: 'error', reasonCode: 'RATE_LIMITED', elapsedMs: 100 });
    expect(controller.snapshot()).toMatchObject({
      phase: 'speaking',
      reasonCode: 'COMMAND_FAILED',
      speech: { text: expect.stringContaining('rate limited') },
    });

    controller.syncAgent({
      phase: 'completed',
      reasonCode: 'COMMAND_LOOP_COMPLETE',
      elapsedMs: 250,
    });
    expect(controller.snapshot()).toMatchObject({
      phase: 'standby',
      reasonCode: 'COMMAND_COMPLETE_READY',
    });
  });

  it('turns opaque execution failures into exact actionable voice feedback', () => {
    expect(failureSpeech('OBS_NOT_READY')).toContain('OBS is not connected');
    expect(failureSpeech('ORCHESTRATION_FAILED')).toContain('orchestration failed');
  });

  it('projects realtime provider, task, transcript, and latency state', () => {
    const controller = new HandsFreeConversation(preferences, () => undefined);
    controller.realtimePhase('tool_active', 'PRODUCTION_TOOL_RUNNING', {
      provider: 'deepgram',
      connected: true,
      currentTask: 'live_session_auto_prepare_v1',
      lastTranscript: 'Set up Sekiro and start streaming now',
      lastLatencyMs: 642,
    });
    expect(controller.snapshot()).toMatchObject({
      phase: 'tool_active',
      provider: 'deepgram',
      connected: true,
      currentTask: 'live_session_auto_prepare_v1',
      lastLatencyMs: 642,
    });
    controller.realtimePhase('standby', 'FOLLOW_UP_LISTENING', {
      provider: 'deepgram',
      connected: true,
    });
    expect(controller.snapshot()).not.toHaveProperty('currentTask');
  });

  it('does not let provider readiness activate a disabled microphone preference', () => {
    const controller = new HandsFreeConversation(
      { ...preferences, enabled: false },
      () => undefined,
    );
    controller.realtimePhase('standby', 'DEEPGRAM_REALTIME_READY', {
      provider: 'deepgram',
      connected: true,
    });
    expect(controller.snapshot()).toMatchObject({
      enabled: false,
      phase: 'disabled',
      reasonCode: 'HANDS_FREE_DISABLED',
      sessionActive: false,
    });
  });
});
