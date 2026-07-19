import type { AgentInteractionProjection } from '@obscurpilot/contracts/agent';
import type { ConnectionProjection } from '@obscurpilot/contracts/state';

export interface SpeechPreferences {
  readonly enabled: boolean;
  readonly voiceUri: string;
  readonly volume: number;
}

interface SpeechEngineLike {
  cancel(): void;
  speak(utterance: SpeechSynthesisUtterance): void;
  getVoices(): readonly SpeechSynthesisVoice[];
}

type SpeechUtteranceFactory = (text: string) => SpeechSynthesisUtterance;

export class SpeechFeedbackQueue {
  private readonly pending: Array<{ text: string; preferences: SpeechPreferences }> = [];
  private active = false;

  public constructor(
    private readonly engine: SpeechEngineLike | undefined,
    private readonly createUtterance: SpeechUtteranceFactory | undefined,
    private readonly onFallback: (message: string) => void,
    private readonly maxQueued = 5,
  ) {}

  public enqueue(text: string, preferences: SpeechPreferences): void {
    const normalized = text.trim().slice(0, 240);
    if (!preferences.enabled || normalized.length === 0) return;
    if (this.engine === undefined || this.createUtterance === undefined) {
      this.onFallback(normalized);
      return;
    }
    this.pending.push({ text: normalized, preferences });
    while (this.pending.length > this.maxQueued) this.pending.shift();
    this.speakNext();
  }

  public cancel(): void {
    this.pending.length = 0;
    this.active = false;
    this.engine?.cancel();
  }

  public get queuedCount(): number {
    return this.pending.length + (this.active ? 1 : 0);
  }

  private speakNext(): void {
    if (this.active || this.engine === undefined || this.createUtterance === undefined) return;
    const next = this.pending.shift();
    if (next === undefined) return;
    const utterance = this.createUtterance(next.text);
    const selectedVoice = this.engine
      .getVoices()
      .find((voice) => voice.voiceURI === next.preferences.voiceUri);
    utterance.voice = selectedVoice ?? null;
    utterance.volume = Math.min(1, Math.max(0, next.preferences.volume));
    utterance.rate = 1;
    utterance.pitch = 1;
    this.active = true;
    const finish = () => {
      this.active = false;
      this.speakNext();
    };
    utterance.onend = finish;
    utterance.onerror = () => {
      this.onFallback(next.text);
      finish();
    };
    this.engine.speak(utterance);
  }
}

export function createBrowserSpeechQueue(onFallback: (message: string) => void) {
  const engine = typeof window === 'undefined' ? undefined : window.speechSynthesis;
  const factory =
    typeof window === 'undefined' || typeof window.SpeechSynthesisUtterance !== 'function'
      ? undefined
      : (text: string) => new window.SpeechSynthesisUtterance(text);
  return new SpeechFeedbackQueue(engine, factory, onFallback);
}

export function announcementForAgent(agent: AgentInteractionProjection): string | null {
  if (agent.phase === 'awaiting_confirmation')
    return 'Approval required for the protected command.';
  // Completion speech is emitted by the hands-free orchestration boundary only
  // after it has the model's task-specific, tool-grounded response.
  if (agent.phase === 'completed') return null;
  if (agent.phase === 'error') return null;
  return null;
}

export function announcementForConnection(connection: ConnectionProjection): string | null {
  if (connection.phase === 'ready') return `${connection.provider} connection ready.`;
  if (connection.phase === 'auth_required') {
    return `${connection.provider} requires authorization.`;
  }
  if (connection.phase === 'degraded' || connection.phase === 'stopped') {
    return `${connection.provider} connection needs attention.`;
  }
  return null;
}
