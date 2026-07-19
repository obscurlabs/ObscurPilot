import type { AgentInteractionProjection } from '@obscurpilot/contracts/agent';
import type { HandsFreeProjection, PttProjection } from '@obscurpilot/contracts/audio';
import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';

const INITIAL: PttProjection = {
  phase: 'idle',
  elapsedMs: 0,
  level: 0,
  reasonCode: 'IDLE',
};

const INITIAL_AGENT: AgentInteractionProjection = {
  phase: 'idle',
  reasonCode: 'IDLE',
  elapsedMs: 0,
};
const INITIAL_HANDS_FREE: HandsFreeProjection = {
  phase: 'arming',
  reasonCode: 'MICROPHONE_ARMING',
  enabled: true,
  wakePhrase: 'Hi Obscur',
  level: 0,
  sessionActive: false,
};

const LABELS: Record<PttProjection['phase'], string> = {
  idle: 'Hold to speak',
  arming: 'Opening microphone',
  capturing: 'Listening',
  encoding: 'Preparing voice',
  ready: 'Voice captured',
  rejected: 'Try again',
  error: 'Microphone unavailable',
};

const AGENT_LABELS: Record<AgentInteractionProjection['phase'], string> = {
  idle: 'Hold to speak',
  transcribing: 'Understanding voice',
  reasoning: 'Planning safely',
  tool_active: 'Applying command',
  awaiting_confirmation: 'Approval required',
  completed: 'Command complete',
  error: 'Command stopped',
};

const AGENT_STEPS: ReadonlyArray<{
  readonly phase: AgentInteractionProjection['phase'];
  readonly label: string;
}> = [
  { phase: 'transcribing', label: 'Understand' },
  { phase: 'reasoning', label: 'Plan' },
  { phase: 'tool_active', label: 'Apply' },
  { phase: 'awaiting_confirmation', label: 'Confirm' },
  { phase: 'completed', label: 'Complete' },
];

export function VoicePresence({
  onAgentActivity,
}: {
  readonly onAgentActivity?: (projection: AgentInteractionProjection) => void;
}) {
  const [projection, setProjection] = useState<PttProjection>(INITIAL);
  const [agent, setAgent] = useState<AgentInteractionProjection>(INITIAL_AGENT);
  const [handsFree, setHandsFree] = useState<HandsFreeProjection>(INITIAL_HANDS_FREE);
  const [decisionPending, setDecisionPending] = useState(false);
  const [decisionNotice, setDecisionNotice] = useState<string>();
  const [clock, setClock] = useState(() => Date.now());
  const orbRef = useRef<HTMLSpanElement>(null);
  const pressedRef = useRef(false);

  useEffect(
    () =>
      window.obscurPilot.onPttChanged((next) => {
        orbRef.current?.style.setProperty('--voice-energy', next.level.toFixed(3));
        setProjection((current) => {
          if (
            current.phase === next.phase &&
            current.reasonCode === next.reasonCode &&
            current.clip?.clipId === next.clip?.clipId
          ) {
            return current;
          }
          return { ...next, level: 0 };
        });
      }),
    [],
  );

  useEffect(() => {
    let active = true;
    void window.obscurPilot
      .getAgentInteraction()
      .then((next) => {
        if (active) {
          setAgent(next);
          onAgentActivity?.(next);
        }
      })
      .catch(() => undefined);
    const unsubscribe = window.obscurPilot.onAgentInteractionChanged((next) => {
      if (active) {
        setAgent(next);
        setDecisionPending(false);
        setDecisionNotice(undefined);
        onAgentActivity?.(next);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [onAgentActivity]);

  useEffect(() => {
    let active = true;
    void window.obscurPilot.getHandsFreeProjection().then((next) => {
      if (active) setHandsFree(next);
    });
    const unsubscribe = window.obscurPilot.onHandsFreeChanged((next) => {
      orbRef.current?.style.setProperty('--voice-energy', next.level.toFixed(3));
      if (active) setHandsFree({ ...next, level: 0 });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (agent.confirmation === undefined) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [agent.confirmation]);

  const decide = async (decision: 'approve' | 'deny') => {
    if (agent.confirmation === undefined || decisionPending) return;
    setDecisionPending(true);
    setDecisionNotice(undefined);
    try {
      setAgent(
        await window.obscurPilot.decideAgentConfirmation({
          confirmationId: agent.confirmation.confirmationId,
          decision,
        }),
      );
    } catch {
      setDecisionNotice('The decision could not be applied. Refresh state and repeat the command.');
    } finally {
      setDecisionPending(false);
    }
  };

  const press = () => {
    if (pressedRef.current) return;
    pressedRef.current = true;
    void window.obscurPilot.commandPtt('press');
  };
  const release = () => {
    if (!pressedRef.current) return;
    pressedRef.current = false;
    void window.obscurPilot.commandPtt('release');
  };

  const agentActive = agent.phase !== 'idle';
  const realtimeActive = handsFree.provider === 'deepgram' && handsFree.enabled;
  const label = realtimeActive
    ? realtimeVoiceLabel(handsFree)
    : agentActive
      ? AGENT_LABELS[agent.phase]
      : LABELS[projection.phase];
  const reasonCode = realtimeActive
    ? handsFree.reasonCode
    : agentActive
      ? agent.reasonCode
      : projection.reasonCode;
  const visualPhase = realtimeActive
    ? handsFree.phase
    : agentActive
      ? agent.phase
      : projection.phase;
  const currentStep = AGENT_STEPS.findIndex((step) => step.phase === agent.phase);
  const confirmationRemainingMs =
    agent.confirmation === undefined
      ? 0
      : Math.max(0, new Date(agent.confirmation.expiresAt).getTime() - clock);
  const confirmationExpired = agent.confirmation !== undefined && confirmationRemainingMs === 0;

  return (
    <section
      className="voice-presence"
      id="command-center"
      data-agent-phase={agent.phase}
      aria-labelledby="voice-presence-title"
    >
      <div>
        <p className="eyebrow">Voice boundary</p>
        <h2 id="voice-presence-title">Agent presence</h2>
        <p className="voice-copy">
          {!handsFree.enabled
            ? 'Hands-free listening is off. Enable it in Settings to use the wake phrase.'
            : handsFree.connected
              ? 'Realtime voice is active. Say ' +
                handsFree.wakePhrase +
                ', then continue naturally; interrupt at any time.'
              : 'Hands-free fallback is active. Say ' +
                handsFree.wakePhrase +
                ', then speak naturally; no button is required.'}
        </p>
      </div>
      <button
        className="voice-control"
        data-phase={visualPhase}
        aria-label="Hold to speak"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          press();
        }}
        onPointerUp={release}
        onPointerCancel={() => {
          pressedRef.current = false;
          void window.obscurPilot.commandPtt('cancel');
        }}
        onKeyDown={(event) => {
          if (!event.repeat && (event.key === ' ' || event.key === 'Enter')) {
            event.preventDefault();
            press();
          }
        }}
        onKeyUp={(event) => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            release();
          }
        }}
      >
        <span className="orb-shell" ref={orbRef} aria-hidden="true">
          <span className="orb-ring orb-ring-outer" />
          <span className="orb-ring orb-ring-inner" />
          <span className="orb-core" />
        </span>
        <span className="voice-label">{label}</span>
        <span className="voice-reason">{reasonCode.replaceAll('_', ' ')}</span>
      </button>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {label}
      </div>
      {realtimeActive ? (
        <dl className="realtime-voice-telemetry" aria-label="Realtime voice status">
          <div>
            <dt>Voice route</dt>
            <dd>{handsFree.connected ? 'Deepgram realtime' : 'Groq fallback'}</dd>
          </div>
          <div>
            <dt>Wake boundary</dt>
            <dd>
              {handsFree.wakeWord?.engine === 'sherpa_onnx'
                ? 'Offline · sherpa-onnx'
                : 'Transcript fallback'}
            </dd>
          </div>
          <div>
            <dt>Current task</dt>
            <dd>{handsFree.currentTask?.replaceAll('_', ' ') ?? 'Conversation ready'}</dd>
          </div>
          <div>
            <dt>Turn latency</dt>
            <dd>
              {handsFree.lastLatencyMs === undefined
                ? 'Measuring'
                : handsFree.lastLatencyMs + ' ms'}
            </dd>
          </div>
        </dl>
      ) : null}
      {agentActive ? (
        <div className="agent-state-panel" aria-label="Agent command progress">
          <ol className="agent-progress">
            {AGENT_STEPS.map((step, index) => {
              const state =
                agent.phase === 'error'
                  ? 'stopped'
                  : index < currentStep
                    ? 'complete'
                    : index === currentStep
                      ? 'current'
                      : 'pending';
              return (
                <li
                  data-state={state}
                  key={step.phase}
                  aria-current={state === 'current' ? 'step' : undefined}
                >
                  <span aria-hidden="true" />
                  {step.label}
                </li>
              );
            })}
          </ol>
          <dl className="agent-telemetry">
            <div>
              <dt>Elapsed</dt>
              <dd>{(agent.elapsedMs / 1_000).toFixed(1)}s</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{agent.model?.replace('openai/', '').replace('qwen/', '') ?? 'Pending'}</dd>
            </div>
            <div>
              <dt>Protected tool</dt>
              <dd>{agent.tool?.name ?? 'None'}</dd>
            </div>
          </dl>
        </div>
      ) : null}
      {agent.confirmation === undefined ? null : (
        <div
          className="agent-confirmation"
          role="group"
          aria-label="Command approval"
          data-expired={confirmationExpired}
        >
          <div>
            <p className="agent-confirmation-title">Confirm protected command</p>
            <p className="agent-confirmation-detail">
              {agent.confirmation.tool.name.replaceAll('_', ' ').replaceAll('.', ' ')}
            </p>
            <p className="agent-confirmation-summary">
              {agent.confirmation.summaryCode.replaceAll('_', ' ')} ·{' '}
              {confirmationExpired
                ? 'Expired — repeat the command'
                : `${Math.ceil(confirmationRemainingMs / 1_000)}s remaining`}
            </p>
          </div>
          <div className="agent-confirmation-actions">
            <Button
              variant="secondary"
              disabled={decisionPending || confirmationExpired}
              onClick={() => void decide('deny')}
            >
              Deny
            </Button>
            <Button
              variant="primary"
              disabled={decisionPending || confirmationExpired}
              onClick={() => void decide('approve')}
            >
              {decisionPending ? 'Applying…' : 'Approve'}
            </Button>
          </div>
        </div>
      )}
      {decisionNotice === undefined ? null : (
        <p className="agent-decision-notice" role="alert">
          {decisionNotice}
        </p>
      )}
      {projection.clip !== undefined ? (
        <p className="clip-proof">
          Captured {Math.round(projection.clip.durationMs / 100) / 10}s ·{' '}
          {Math.round(projection.clip.bytes / 1024)} KB
        </p>
      ) : null}
    </section>
  );
}

function realtimeVoiceLabel(projection: HandsFreeProjection): string {
  const labels: Partial<Record<HandsFreeProjection['phase'], string>> = {
    connecting: 'Connecting realtime voice',
    standby: projection.connected ? 'Realtime voice ready' : 'Voice fallback ready',
    listening: 'Listening continuously',
    reasoning: 'Understanding command',
    tool_active: 'Applying production task',
    speaking: 'ObscurPilot speaking',
    interrupted: 'Listening to interruption',
    recovering: 'Restoring realtime voice',
    error: 'Realtime voice unavailable',
  };
  return labels[projection.phase] ?? projection.phase.replaceAll('_', ' ');
}
