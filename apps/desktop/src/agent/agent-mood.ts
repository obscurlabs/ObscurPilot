import type { AgentInteractionPhase } from '@obscurpilot/contracts/agent';
import type { HandsFreeProjection, PttPhase } from '@obscurpilot/contracts/audio';
import type { LiveSessionPhase } from '@obscurpilot/contracts/live-session';

export type AgentMood =
  | 'idle'
  | 'standby'
  | 'alert'
  | 'listening'
  | 'processing'
  | 'thinking'
  | 'working'
  | 'asking'
  | 'speaking'
  | 'happy'
  | 'error'
  | 'worried'
  | 'sleeping'
  | 'offline'
  | 'live';

export type PresencePhase =
  | PttPhase
  | AgentInteractionPhase
  | HandsFreeProjection['phase']
  | LiveSessionPhase;

// Exhaustive on purpose: adding a phase to any contract fails the build until it has a mood.
const MOOD_BY_PHASE: Readonly<Record<PresencePhase, AgentMood>> = {
  idle: 'idle',
  arming: 'alert',
  capturing: 'listening',
  encoding: 'processing',
  ready: 'processing',
  rejected: 'error',
  error: 'error',
  transcribing: 'processing',
  reasoning: 'thinking',
  tool_active: 'working',
  awaiting_confirmation: 'asking',
  completed: 'happy',
  disabled: 'sleeping',
  standby: 'standby',
  listening: 'listening',
  speaking: 'speaking',
  paused: 'sleeping',
  draft: 'idle',
  preflight: 'working',
  applying_twitch: 'working',
  preparing_obs: 'working',
  starting_output: 'working',
  verifying_live: 'working',
  live: 'live',
  rolling_back: 'worried',
  failed: 'error',
  stopping: 'worried',
  stopped: 'idle',
};

export function moodForPhase(phase: PresencePhase): AgentMood {
  return MOOD_BY_PHASE[phase];
}
