import type { AgentInteractionProjection } from '@obscurpilot/contracts/agent';
import type { HandsFreeProjection, PttProjection } from '@obscurpilot/contracts/audio';
import type { LiveSessionProjection } from '@obscurpilot/contracts/live-session';
import type {
  AppSnapshot,
  ConnectionProjection,
  ConnectionProvider,
} from '@obscurpilot/contracts/state';
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { moodForPhase } from './agent/agent-mood';
import { PilotAgent, type PilotAgentHandle } from './agent/pilot-agent';
import { applyStateChanged, isConnectionUp } from './lib/state-projection';
import './overlay.css';

const PROVIDER_NAMES: Readonly<Record<ConnectionProvider, string>> = {
  obs: 'OBS',
  twitch: 'Twitch',
  wispr: 'Wispr Flow',
  groq: 'Groq',
  supabase: 'Cloud sync',
};

const PTT: PttProjection = { phase: 'idle', elapsedMs: 0, level: 0, reasonCode: 'IDLE' };
const AGENT: AgentInteractionProjection = {
  phase: 'idle',
  reasonCode: 'IDLE',
  elapsedMs: 0,
};
const HANDS_FREE: HandsFreeProjection = {
  phase: 'arming',
  reasonCode: 'MICROPHONE_ARMING',
  enabled: true,
  wakePhrase: 'Hi Obscur',
  level: 0,
  sessionActive: false,
};
const SESSION: LiveSessionProjection = {
  phase: 'draft',
  reasonCode: 'NO_PLAN',
  updatedAt: new Date(0).toISOString(),
  completedSteps: [],
  obsStreamActive: false,
  twitchLive: false,
  liveVerified: false,
};
export function PilotOverlay() {
  const [ptt, setPtt] = useState(PTT);
  const [agent, setAgent] = useState(AGENT);
  const [handsFree, setHandsFree] = useState(HANDS_FREE);
  const [session, setSession] = useState(SESSION);
  // Null until the first snapshot arrives, so Pilot never flashes offline during startup.
  const [connections, setConnections] = useState<readonly ConnectionProjection[] | null>(null);
  const pilot = useRef<PilotAgentHandle>(null);

  useEffect(() => {
    let snapshot: AppSnapshot | undefined;
    let disposed = false;
    const accept = (next: AppSnapshot) => {
      snapshot = next;
      setConnections(Object.values(next.connections));
    };
    const resync = () =>
      void window.obscurPilot.getSnapshot().then((next) => {
        if (!disposed) accept(next);
      });
    resync();
    const offState = window.obscurPilot.onStateChanged((event) => {
      if (snapshot === undefined) return;
      const next = applyStateChanged(snapshot, event);
      if (next === 'resync_required') resync();
      else accept(next);
    });
    return () => {
      disposed = true;
      offState();
    };
  }, []);

  useEffect(() => {
    void Promise.all([
      window.obscurPilot.getAgentInteraction(),
      window.obscurPilot.getLiveSession(),
      window.obscurPilot.getHandsFreeProjection(),
    ]).then(([agentState, sessionState, handsFreeState]) => {
      setAgent(agentState);
      setSession(sessionState);
      setHandsFree(handsFreeState);
    });
    const offPtt = window.obscurPilot.onPttChanged((next) => {
      pilot.current?.setEnergy(next.level);
      setPtt({ ...next, level: 0 });
    });
    const offAgent = window.obscurPilot.onAgentInteractionChanged(setAgent);
    const offHandsFree = window.obscurPilot.onHandsFreeChanged((next) => {
      pilot.current?.setEnergy(next.level);
      setHandsFree({ ...next, level: 0 });
    });
    const offSession = window.obscurPilot.onLiveSessionChanged((next) => {
      setSession(next);
    });
    return () => {
      offPtt();
      offAgent();
      offHandsFree();
      offSession();
      window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    const speech = handsFree.speech;
    if (handsFree.phase !== 'speaking' || speech === undefined) return;
    if (typeof window.speechSynthesis === 'undefined') {
      void window.obscurPilot.finishHandsFreeSpeech(speech.id);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(speech.text);
    utterance.rate = 1.03;
    utterance.pitch = 0.96;
    utterance.volume = 0.86;
    const finish = () => void window.obscurPilot.finishHandsFreeSpeech(speech.id);
    const syllable = () => pilot.current?.pulseSpeech();
    utterance.addEventListener('end', finish, { once: true });
    utterance.addEventListener('error', finish, { once: true });
    utterance.addEventListener('boundary', syllable);
    window.speechSynthesis.speak(utterance);
    return () => {
      utterance.removeEventListener('end', finish);
      utterance.removeEventListener('error', finish);
      utterance.removeEventListener('boundary', syllable);
    };
  }, [handsFree.phase, handsFree.speech]);

  // A finished agent turn drops straight back to the session phase, so mark it with a beat.
  useEffect(() => {
    if (agent.phase === 'completed') pilot.current?.celebrate();
  }, [agent.phase]);

  const captureActive = ['arming', 'capturing', 'encoding'].includes(ptt.phase);
  const agentActive = !['idle', 'completed'].includes(agent.phase);
  const handsFreeActive = handsFree.enabled && handsFree.phase !== 'standby';
  const phase = captureActive
    ? ptt.phase
    : handsFreeActive
      ? handsFree.phase
      : agentActive
        ? agent.phase
        : session.phase;
  const label = handsFreeActive
    ? handsFree.phase === 'listening'
      ? 'Listening'
      : handsFree.phase === 'speaking'
        ? 'Speaking'
        : handsFree.phase === 'awaiting_confirmation'
          ? 'Say yes or no'
          : handsFree.phase.replaceAll('_', ' ')
    : captureActive
      ? ptt.phase === 'capturing'
        ? 'Listening'
        : 'Preparing voice'
      : agentActive
        ? agent.phase === 'awaiting_confirmation'
          ? 'Approval needed'
          : agent.phase.replaceAll('_', ' ')
        : session.phase === 'live'
          ? 'Live verified'
          : session.phase === 'verifying_live'
            ? session.countdownRemainingSeconds === undefined
              ? 'Verifying output'
              : `Starting in ${session.countdownRemainingSeconds}s`
            : 'Pilot ready';
  const detail = handsFreeActive
    ? handsFree.reasonCode
    : captureActive
      ? ptt.reasonCode
      : agentActive
        ? agent.reasonCode
        : session.reasonCode;

  const missing = (connections ?? [])
    .filter((connection) => !isConnectionUp(connection))
    .map((connection) => PROVIDER_NAMES[connection.provider]);
  const offline = connections !== null && missing.length === connections.length;
  const phaseMood = moodForPhase(phase);
  // Offline only replaces resting moods; live voice and agent activity still show through.
  const mood = offline && (phaseMood === 'idle' || phaseMood === 'standby') ? 'offline' : phaseMood;
  const notConnected = 'Not connected: ' + missing.join(', ');
  const tooltip = mood === 'offline' ? notConnected : missing.length ? `${label}. ${notConnected}` : label;

  const status = handsFree.phase === 'standby' ? 'Say ' + handsFree.wakePhrase : detail;

  // The character carries state visually; the text stays for screen readers only.
  return (
    <main className="pilot-presence" data-phase={phase} aria-live="polite">
      <PilotAgent
        mood={mood}
        title={tooltip}
        ref={pilot}
        onInteractiveChange={(interactive) =>
          void window.obscurPilot.setPilotOverlayInteractive(interactive)
        }
        onDrag={(phase) => void window.obscurPilot.dragPilotOverlay(phase)}
      />
      <p className="pilot-status">
        {session.phase === 'live' ? 'Live. ' : ''}
        {mood === 'offline'
          ? notConnected
          : `${label}. ${status.replaceAll('_', ' ').toLowerCase()}`}
      </p>
    </main>
  );
}

const root = document.getElementById('overlay-root');
if (!root) throw new Error('Pilot overlay root was not found');
createRoot(root).render(
  <StrictMode>
    <PilotOverlay />
  </StrictMode>,
);
