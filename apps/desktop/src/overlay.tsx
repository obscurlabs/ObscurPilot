import type { AgentInteractionProjection } from '@obscurpilot/contracts/agent';
import type { HandsFreeProjection, PttProjection } from '@obscurpilot/contracts/audio';
import type { LiveSessionProjection } from '@obscurpilot/contracts/live-session';
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './overlay.css';

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
  const orb = useRef<HTMLSpanElement>(null);

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
      orb.current?.style.setProperty('--overlay-energy', next.level.toFixed(3));
      setPtt({ ...next, level: 0 });
    });
    const offAgent = window.obscurPilot.onAgentInteractionChanged(setAgent);
    const offHandsFree = window.obscurPilot.onHandsFreeChanged((next) => {
      orb.current?.style.setProperty('--overlay-energy', next.level.toFixed(3));
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
    utterance.voice = selectPilotVoice(window.speechSynthesis.getVoices());
    utterance.rate = 1.03;
    utterance.pitch = 0.96;
    utterance.volume = 0.86;
    const finish = () => void window.obscurPilot.finishHandsFreeSpeech(speech.id);
    utterance.addEventListener('end', finish, { once: true });
    utterance.addEventListener('error', finish, { once: true });
    window.speechSynthesis.speak(utterance);
    return () => {
      utterance.removeEventListener('end', finish);
      utterance.removeEventListener('error', finish);
      window.speechSynthesis.cancel();
    };
  }, [handsFree.phase, handsFree.speech]);

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
        : handsFree.phase === 'tool_active'
          ? 'Applying task'
          : handsFree.phase === 'reasoning'
            ? 'Thinking'
            : handsFree.phase === 'recovering'
              ? 'Restoring voice'
              : handsFree.phase === 'interrupted'
                ? 'Interrupted'
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

  return (
    <main className="pilot-presence" data-phase={phase} aria-live="polite">
      <div className="pilot-orb" aria-hidden="true">
        <span className="pilot-wave pilot-wave-a" />
        <span className="pilot-wave pilot-wave-b" />
        <span className="pilot-core" ref={orb} />
      </div>
      <div className="pilot-copy">
        <span className="pilot-kicker">OBSCURPILOT</span>
        <strong>{label}</strong>
        <span>
          {handsFree.phase === 'standby'
            ? handsFree.connected
              ? 'Realtime ready · say ' + handsFree.wakePhrase
              : 'Say ' + handsFree.wakePhrase
            : handsFree.currentTask !== undefined
              ? handsFree.currentTask.replaceAll('_', ' ')
              : detail.replaceAll('_', ' ')}
        </span>
      </div>
      {session.phase === 'live' ? <span className="pilot-live">LIVE</span> : null}
    </main>
  );
}

function selectPilotVoice(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const femaleName = /\b(zira|aria|jenny|samantha|susan|hazel|female)\b/iu;
  return (
    voices.find((voice) => femaleName.test(`${voice.name} ${voice.voiceURI}`)) ??
    voices.find((voice) => voice.lang.toLocaleLowerCase('en-US').startsWith('en')) ??
    voices[0] ??
    null
  );
}

const root = document.getElementById('overlay-root');
if (!root) throw new Error('Pilot overlay root was not found');
createRoot(root).render(
  <StrictMode>
    <PilotOverlay />
  </StrictMode>,
);
