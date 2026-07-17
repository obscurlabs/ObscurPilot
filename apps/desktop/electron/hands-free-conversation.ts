import { randomUUID } from 'node:crypto';
import {
  HandsFreePreferencesSchema,
  HandsFreeProjectionSchema,
  type HandsFreePreferences,
  type HandsFreeProjection,
  type VoiceCaptureSource,
} from '@obscurpilot/contracts/audio';
import type { AgentInteractionProjection } from '@obscurpilot/contracts/agent';

export class HandsFreeConversation {
  private preferencesValue: HandsFreePreferences;
  private projectionValue: HandsFreeProjection;
  private activeUntil = 0;

  public constructor(
    preferences: HandsFreePreferences,
    private readonly onProjection: (projection: HandsFreeProjection) => void,
    private readonly now: () => number = Date.now,
  ) {
    this.preferencesValue = HandsFreePreferencesSchema.parse(preferences);
    this.projectionValue = this.parse({
      phase: preferences.enabled ? 'arming' : 'disabled',
      reasonCode: preferences.enabled ? 'MICROPHONE_ARMING' : 'HANDS_FREE_DISABLED',
      enabled: preferences.enabled,
      wakePhrase: preferences.wakePhrase,
      level: 0,
      sessionActive: false,
    });
  }

  public snapshot(): HandsFreeProjection {
    return this.projectionValue;
  }

  public preferences(): HandsFreePreferences {
    return this.preferencesValue;
  }

  public setPreferences(preferences: HandsFreePreferences): HandsFreeProjection {
    this.preferencesValue = HandsFreePreferencesSchema.parse(preferences);
    if (!preferences.enabled) this.activeUntil = 0;
    this.publish({
      phase: preferences.enabled ? 'arming' : 'disabled',
      reasonCode: preferences.enabled ? 'MICROPHONE_ARMING' : 'HANDS_FREE_DISABLED',
      level: 0,
    });
    return this.snapshot();
  }

  public audioPhase(
    phase: 'arming' | 'standby' | 'listening' | 'paused' | 'error',
    reasonCode: string,
    level = 0,
  ): void {
    if (!this.preferencesValue.enabled && phase !== 'error') return;
    if (this.projectionValue.phase === 'speaking' && phase !== 'error') return;
    this.publish({ phase, reasonCode, level });
  }

  public beginTranscription(): void {
    this.publish({ phase: 'transcribing', reasonCode: 'UNDERSTANDING_SPEECH', level: 0 });
  }

  public acceptTranscript(
    transcript: string,
    source: VoiceCaptureSource,
  ): { readonly accepted: boolean; readonly command: string; readonly woke: boolean } {
    const normalized = transcript.trim();
    if (normalized === '') return { accepted: false, command: '', woke: false };
    if (source === 'ptt') {
      this.extendSession();
      return { accepted: true, command: normalized, woke: false };
    }
    const active = this.activeUntil > this.now();
    const wakeMatch = findWakePhrase(normalized, this.preferencesValue.wakePhrase);
    if (!active && wakeMatch === undefined) {
      this.publish({ phase: 'standby', reasonCode: 'WAKE_PHRASE_REQUIRED', level: 0 });
      return { accepted: false, command: '', woke: false };
    }
    this.extendSession();
    const command = wakeMatch === undefined ? normalized : normalized.slice(wakeMatch.end).trim();
    return { accepted: true, command, woke: wakeMatch !== undefined };
  }

  public syncAgent(agent: AgentInteractionProjection): void {
    if (!this.preferencesValue.enabled) return;
    if (agent.phase === 'transcribing') return this.beginTranscription();
    if (agent.phase === 'reasoning' || agent.phase === 'tool_active') {
      this.publish({
        phase: 'reasoning',
        reasonCode: agent.phase === 'tool_active' ? 'APPLYING_PRODUCTION_TASK' : 'PLANNING_TASK',
        level: 0,
      });
    }
    if (agent.phase === 'awaiting_confirmation') {
      this.speak(
        'The production plan is ready. Say yes to start the broadcast and five minute countdown, or say no to cancel.',
        'VOICE_CONFIRMATION_REQUIRED',
      );
      return;
    }
    if (agent.phase === 'error') {
      this.publish({ phase: 'error', reasonCode: agent.reasonCode, level: 0 });
      return;
    }
    if (agent.phase === 'completed' || agent.phase === 'idle') {
      // Terminal agent state replaces a prior error immediately. Without this,
      // the always-visible pilot overlay can keep showing Error after a
      // newer command succeeds.
      if (this.projectionValue.phase !== 'speaking') {
        this.publish({
          phase: 'standby',
          reasonCode:
            agent.phase === 'completed' ? 'COMMAND_COMPLETE_READY' : 'READY_FOR_NEXT_COMMAND',
          level: 0,
        });
      }
    }
  }

  public speak(text: string, reasonCode = 'SPEAKING'): HandsFreeProjection {
    const bounded = text.trim().slice(0, 1_000);
    if (bounded === '') {
      this.publish({ phase: 'standby', reasonCode: 'AWAITING_WAKE_PHRASE', level: 0 });
      return this.snapshot();
    }
    this.extendSession();
    this.publish({
      phase: 'speaking',
      reasonCode,
      level: 0,
      speech: { id: randomUUID(), text: bounded },
    });
    return this.snapshot();
  }

  public speechFinished(speechId: string): HandsFreeProjection {
    if (this.projectionValue.speech?.id !== speechId) return this.snapshot();
    this.publish({ phase: 'standby', reasonCode: 'FOLLOW_UP_LISTENING', level: 0 });
    return this.snapshot();
  }

  private extendSession(): void {
    this.activeUntil = this.now() + this.preferencesValue.conversationWindowMs;
  }

  private publish(
    next: Pick<HandsFreeProjection, 'phase' | 'reasonCode' | 'level'> &
      Partial<Pick<HandsFreeProjection, 'speech'>>,
  ): void {
    const sessionActive = this.activeUntil > this.now();
    this.projectionValue = this.parse({
      ...next,
      enabled: this.preferencesValue.enabled,
      wakePhrase: this.preferencesValue.wakePhrase,
      sessionActive,
      ...(sessionActive ? { sessionExpiresAt: new Date(this.activeUntil).toISOString() } : {}),
    });
    this.onProjection(this.projectionValue);
  }

  private parse(value: unknown): HandsFreeProjection {
    return HandsFreeProjectionSchema.parse(value);
  }
}

function findWakePhrase(text: string, wakePhrase: string): { readonly end: number } | undefined {
  const normalizedText = normalize(text);
  const normalizedWake = normalize(wakePhrase);
  const aliases = new Set([normalizedWake, 'hey obscur', 'hi obscure', 'hey obscure']);
  for (const alias of aliases) {
    if (normalizedText === alias || normalizedText.startsWith(alias + ' ')) {
      const words = alias.split(' ').length;
      const match = text.match(new RegExp('^\\s*(?:\\S+\\s+){' + (words - 1) + '}\\S+', 'u'));
      return { end: match?.[0].length ?? text.length };
    }
  }
  return undefined;
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9 ]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}
