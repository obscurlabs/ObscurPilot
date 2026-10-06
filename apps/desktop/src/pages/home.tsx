import type { AgentInteractionProjection, AgentStartResult } from '@obscurpilot/contracts/agent';
import type { PttProjection } from '@obscurpilot/contracts/audio';
import type { ObsProjection } from '@obscurpilot/contracts/obs';
import type { ConnectionProjection } from '@obscurpilot/contracts/state';
import type { TwitchProjection } from '@obscurpilot/contracts/twitch';
import { useEffect, useState } from 'react';
import { VoicePresence } from '../components/voice-presence';
import type { ActivityItem } from '../lib/activity-timeline';
import { isConnectionUp } from '../lib/state-projection';

type HomeNavigationTarget = 'connections' | 'shortcuts' | 'live' | 'activity';

const PROVIDER_NAMES: Record<string, string> = {
  obs: 'OBS Studio',
  twitch: 'Twitch',
  wispr: 'Wispr Flow voice',
  groq: 'Reasoning engine',
  supabase: 'Cloud sync',
};

type BeaconState = 'listening' | 'onair' | 'attention' | 'ready';

function beaconCopy(state: BeaconState, holdKey: string, attention: number): string {
  if (state === 'listening') return 'Listening — release to send.';
  if (state === 'onair') return `You are live. Hold ${holdKey} to talk to your copilot.`;
  if (state === 'attention')
    return attention === 1
      ? 'One connection needs attention.'
      : `${attention} connections need attention.`;
  return `Ready. Hold ${holdKey} and talk.`;
}

export function HomePage({
  connections,
  obs,
  twitch,
  activities,
  onNavigate,
  onAgentActivity,
}: {
  readonly connections: readonly ConnectionProjection[];
  readonly obs: ObsProjection | undefined;
  readonly twitch: TwitchProjection | undefined;
  readonly activities: readonly ActivityItem[];
  readonly onNavigate: (target: HomeNavigationTarget) => void;
  readonly onAgentActivity: (agent: AgentInteractionProjection) => void;
}) {
  const [pttPhase, setPttPhase] = useState<PttProjection['phase']>('idle');
  const [holdKey, setHoldKey] = useState('Alt+X');

  useEffect(() => {
    const unsubscribe = window.obscurPilot.onPttChanged((projection) =>
      setPttPhase(projection.phase),
    );
    window.obscurPilot
      .getShortcuts()
      .then((shortcuts) => {
        if (shortcuts.holdToTalk !== '') setHoldKey(shortcuts.holdToTalk);
      })
      .catch(() => undefined);
    return unsubscribe;
  }, []);

  const snapshot = obs?.available === true ? obs.snapshot : undefined;
  const streaming = snapshot?.streamActive === true;
  const attention = connections.filter((connection) => !isConnectionUp(connection)).length;
  const state: BeaconState =
    pttPhase === 'arming' || pttPhase === 'capturing'
      ? 'listening'
      : streaming
        ? 'onair'
        : attention > 0
          ? 'attention'
          : 'ready';

  const recent = activities.slice(0, 3);
  const [starting, setStarting] = useState(false);
  const [startResult, setStartResult] = useState<AgentStartResult>();
  const voiceOn = startResult?.steps.some(
    (step) => step.label === 'Turn on voice' && step.status === 'done',
  );
  const startPilot = async () => {
    setStarting(true);
    try {
      setStartResult(await window.obscurPilot.startPilot());
    } catch {
      setStartResult({
        running: false,
        steps: [{ label: 'Start Pilot', status: 'failed', detail: 'See the Logs page' }],
      });
    } finally {
      setStarting(false);
    }
  };
  const stopPilot = async () => setStartResult(await window.obscurPilot.stopPilot());

  return (
    <div className="op-page">
      <section className="op-hero" data-state={state} aria-live="polite">
        <div className="op-beacon" data-state={state} aria-hidden="true">
          <span className="op-beacon-core" />
        </div>
        <div className="op-hero-copy">
          {streaming ? <span className="op-onair-chip">ON AIR</span> : null}
          <h1>{beaconCopy(state, holdKey, attention)}</h1>
          <p className="op-hero-hint">
            <span className="op-kbd-group">
              {holdKey.split('+').map((part) => (
                <kbd className="op-kbd" key={part}>
                  {part}
                </kbd>
              ))}
            </span>
            <span>
              works everywhere — in game, in OBS, minimized.{' '}
              <button className="op-inline-link" type="button" onClick={() => onNavigate('shortcuts')}>
                Change shortcuts
              </button>
            </span>
          </p>
          <div className="op-hero-actions">
            <button
              className="op-start-button"
              type="button"
              disabled={starting}
              onClick={() => void startPilot()}
            >
              {starting ? 'Starting Pilot…' : startResult?.running ? 'Pilot is running' : 'Start Pilot'}
            </button>
            {voiceOn ? (
              <button className="secondary-button" type="button" onClick={() => void stopPilot()}>
                Stop listening
              </button>
            ) : null}
          </div>
          {startResult === undefined ? null : (
            <ol className="connect-steps" aria-label="Start steps">
              {startResult.steps.map((step) => (
                <li key={step.label} data-status={step.status}>
                  <span>
                    {step.label}
                    {step.detail === undefined ? null : <small>{step.detail}</small>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      <div className="op-glance">
        <button className="op-glance-card" type="button" onClick={() => onNavigate('live')}>
          <span className="op-glance-label">Stream</span>
          {snapshot === undefined ? (
            <span className="op-glance-value">OBS not connected</span>
          ) : (
            <>
              <span className="op-glance-value">{snapshot.currentProgramSceneName}</span>
              <span className="op-glance-meta">
                {streaming ? 'Streaming' : 'Not streaming'}
                {snapshot.recordActive ? ' · Recording' : ''}
                {twitch?.account !== undefined ? ` · ${twitch.account.displayName}` : ''}
              </span>
            </>
          )}
          <span className="op-glance-go">Open live session</span>
        </button>

        <button className="op-glance-card" type="button" onClick={() => onNavigate('connections')}>
          <span className="op-glance-label">Connections</span>
          <span className="op-glance-value">
            {connections.length - attention} of {connections.length} ready
          </span>
          <span className="op-glance-dots">
            {connections.map((connection) => (
              <span
                className="op-glance-dot"
                data-ready={isConnectionUp(connection)}
                key={connection.provider}
                title={PROVIDER_NAMES[connection.provider] ?? connection.provider}
              />
            ))}
          </span>
          <span className="op-glance-go">Manage connections</span>
        </button>

        <button className="op-glance-card" type="button" onClick={() => onNavigate('activity')}>
          <span className="op-glance-label">Latest activity</span>
          {recent.length === 0 ? (
            <span className="op-glance-value">Quiet so far</span>
          ) : (
            <span className="op-glance-list">
              {recent.map((item) => (
                <span className="op-glance-line" data-severity={item.severity} key={item.id}>
                  {item.summary}
                </span>
              ))}
            </span>
          )}
          <span className="op-glance-go">Open activity</span>
        </button>
      </div>

      <VoicePresence onAgentActivity={onAgentActivity} />
    </div>
  );
}
