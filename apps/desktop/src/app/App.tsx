import type { AgentInteractionProjection } from '@obscurpilot/contracts/agent';
import type { BootstrapProjection } from '@obscurpilot/contracts/bootstrap';
import type { CloudAuthProjection } from '@obscurpilot/contracts/cloud';
import type { ObsProjection } from '@obscurpilot/contracts/obs';
import type { OnboardingProjection } from '@obscurpilot/contracts/onboarding';
import type { AppSnapshot, ConnectionProjection } from '@obscurpilot/contracts/state';
import type { TwitchProjection } from '@obscurpilot/contracts/twitch';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityTimeline } from '../components/activity-timeline';
import { ControlSettings } from '../components/control-settings';
import { RecoveryCenter } from '../components/recovery-center';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { VoicePresence } from '../components/voice-presence';
import { LiveSessionConsole } from '../components/live-session-console';
import { OnboardingPanel } from '../components/onboarding-panel';
import {
  activitiesFromSnapshot,
  activityFromAgent,
  activityFromConnection,
  activityFromTwitch,
  mergeActivityBatch,
  type ActivityItem,
} from '../lib/activity-timeline';
import type { RecoveryAction } from '../lib/recovery-guidance';
import {
  announcementForAgent,
  announcementForConnection,
  createBrowserSpeechQueue,
} from '../lib/speech-feedback';
import { applyStateChanged } from '../lib/state-projection';
import { useUiPreferences } from '../lib/use-ui-preferences';

type LoadState =
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready';
      readonly bootstrap: BootstrapProjection;
      readonly snapshot: AppSnapshot;
    }
  | { readonly status: 'error'; readonly message: string };

function ConfigurationStatus({
  configured,
  label,
}: {
  readonly configured: boolean;
  readonly label: string;
}) {
  return (
    <div className="status-row">
      <span>{label}</span>
      <Badge tone={configured ? 'ready' : 'waiting'}>
        {configured ? 'Service ready' : 'Service unavailable'}
      </Badge>
    </div>
  );
}

function ConnectionStatus({ connection }: { readonly connection: ConnectionProjection }) {
  return (
    <div className="connection-tile">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-zinc-200 uppercase">{connection.provider}</span>
        <Badge tone={connection.phase === 'ready' ? 'ready' : 'neutral'}>
          {connection.phase.replace('_', ' ')}
        </Badge>
      </div>
      <p className="mt-2 text-xs text-zinc-500">{connection.reasonCode.replaceAll('_', ' ')}</p>
    </div>
  );
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function CloudAccess({
  projection,
  onProjection,
}: {
  readonly projection: CloudAuthProjection | undefined;
  readonly onProjection: (projection: CloudAuthProjection) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [pending, setPending] = useState<'sign_in' | 'sign_up' | 'resend' | 'sign_out'>();
  const [notice, setNotice] = useState<string>();
  const emailInvalid = emailTouched && !EMAIL_PATTERN.test(email.trim());
  const credentialsInvalid = !EMAIL_PATTERN.test(email.trim()) || password.length < 8;

  const authenticate = async (action: 'sign_in' | 'sign_up') => {
    setEmailTouched(true);
    if (credentialsInvalid) {
      setNotice('Enter a valid email and a password of at least 8 characters.');
      return;
    }
    setPending(action);
    setNotice(undefined);
    try {
      const credentials = { email: email.trim(), password };
      const next =
        action === 'sign_in'
          ? await window.obscurPilot.signInCloud(credentials)
          : await window.obscurPilot.signUpCloud(credentials);
      onProjection(next);
      if (next.phase === 'authenticated') {
        setNotice('Secure cloud session established.');
      } else if (next.userId !== undefined) {
        setNotice(
          'Cloud credentials are valid, but synchronization is degraded: ' + next.reasonCode,
        );
      } else if (action === 'sign_up' && next.reasonCode !== 'SIGN_UP_REJECTED') {
        setNotice('Account created. Confirm your email if requested, then sign in.');
      } else {
        setNotice('Authentication was not accepted. Check the credentials and try again.');
      }
    } catch {
      setNotice('Cloud authentication is temporarily unavailable. Try again.');
    } finally {
      setPassword('');
      setPending(undefined);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void authenticate('sign_in');
  };

  const resendConfirmation = async () => {
    setEmailTouched(true);
    if (!EMAIL_PATTERN.test(email.trim())) {
      setNotice('Enter the account email before requesting another confirmation link.');
      return;
    }
    setPending('resend');
    setNotice(undefined);
    try {
      await window.obscurPilot.resendCloudConfirmation({ email: email.trim() });
      setNotice(
        'If this account is waiting for confirmation, a new email has been requested. Use only the newest link.',
      );
    } catch {
      setNotice('A confirmation email could not be requested yet. Wait one minute and try again.');
    } finally {
      setPending(undefined);
    }
  };

  const signOut = async () => {
    setPending('sign_out');
    setNotice(undefined);
    try {
      const next = await window.obscurPilot.signOutCloud();
      onProjection(next);
      setNotice('Local cloud session closed.');
    } catch {
      setNotice('Sign-out could not be completed. Try again.');
    } finally {
      setPending(undefined);
    }
  };

  const authenticated = projection?.phase === 'authenticated';
  const sessionPresent = projection?.userId !== undefined;
  return (
    <Card className="span-full" id="cloud-access">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="eyebrow">Encrypted creator identity</p>
            <h2 className="panel-title">Cloud access</h2>
          </div>
          <Badge tone={authenticated ? 'ready' : 'neutral'}>
            {projection?.phase.replace('_', ' ') ?? 'unavailable'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {sessionPresent ? (
          <div className="cloud-session-row">
            <div>
              <p className="cloud-session-title">Secure session active</p>
              <p className="cloud-helper">Twitch authorization is bound to this creator account.</p>
            </div>
            <button
              className="secondary-button"
              type="button"
              disabled={pending !== undefined}
              onClick={() => void signOut()}
            >
              {pending === 'sign_out' ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        ) : (
          <form className="cloud-auth-form" onSubmit={handleSubmit} noValidate>
            <div className="field-group">
              <label htmlFor="cloud-email">Email</label>
              <input
                id="cloud-email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                aria-invalid={emailInvalid}
                aria-describedby={emailInvalid ? 'cloud-email-error' : undefined}
                disabled={pending !== undefined || projection?.configured === false}
                onBlur={() => setEmailTouched(true)}
                onChange={(event) => setEmail(event.target.value)}
              />
              {emailInvalid ? (
                <span className="field-error" id="cloud-email-error">
                  Enter a valid email address.
                </span>
              ) : null}
            </div>
            <div className="field-group">
              <label htmlFor="cloud-password">Password</label>
              <input
                id="cloud-password"
                name="password"
                type="password"
                autoComplete="current-password"
                minLength={8}
                value={password}
                disabled={pending !== undefined || projection?.configured === false}
                onChange={(event) => setPassword(event.target.value)}
              />
              <span className="cloud-helper">
                Minimum 8 characters. Stored only by Supabase Auth.
              </span>
            </div>
            <div className="cloud-auth-actions">
              <button
                className="primary-button"
                type="submit"
                disabled={pending !== undefined || projection?.configured === false}
              >
                {pending === 'sign_in' ? 'Signing in…' : 'Sign in'}
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={pending !== undefined || projection?.configured === false}
                onClick={() => void authenticate('sign_up')}
              >
                {pending === 'sign_up' ? 'Creating…' : 'Create account'}
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={pending !== undefined || projection?.configured === false}
                onClick={() => void resendConfirmation()}
              >
                {pending === 'resend' ? 'Requesting…' : 'Resend confirmation'}
              </button>
            </div>
          </form>
        )}
        {notice !== undefined ? (
          <p className="cloud-notice" role="status" aria-live="polite">
            {notice}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ObsMirror({
  projection,
  phase,
  onReconnect,
}: {
  readonly projection: ObsProjection | undefined;
  readonly phase: ConnectionProjection['phase'];
  readonly onReconnect: () => void;
}) {
  const snapshot = projection?.snapshot;
  return (
    <Card className="obs-mirror" id="obs-studio">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="eyebrow">Authoritative local mirror</p>
            <h2 className="panel-title">OBS Studio</h2>
          </div>
          <Badge tone={phase === 'ready' ? 'ready' : 'neutral'}>{phase.replace('_', ' ')}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {snapshot === undefined ? (
          <div className="empty-state">
            <p>OBS is not synchronized yet.</p>
            <button className="secondary-button" type="button" onClick={onReconnect}>
              Reconnect OBS
            </button>
          </div>
        ) : (
          <dl className="obs-grid">
            <div>
              <dt>Program scene</dt>
              <dd>{snapshot.currentProgramSceneName}</dd>
            </div>
            <div>
              <dt>Collection</dt>
              <dd>{snapshot.sceneCollectionName}</dd>
            </div>
            <div>
              <dt>Scenes</dt>
              <dd>{snapshot.scenes.length}</dd>
            </div>
            <div>
              <dt>Inputs</dt>
              <dd>{snapshot.inputs.length}</dd>
            </div>
            <div>
              <dt>Streaming</dt>
              <dd>{snapshot.streamActive ? 'Active' : 'Inactive'}</dd>
            </div>
            <div>
              <dt>Recording</dt>
              <dd>{snapshot.recordActive ? 'Active' : 'Inactive'}</dd>
            </div>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

export function App() {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [obsProjection, setObsProjection] = useState<ObsProjection | undefined>(undefined);
  const snapshotRef = useRef<AppSnapshot | undefined>(undefined);
  const [cloudProjection, setCloudProjection] = useState<CloudAuthProjection | undefined>();
  const [twitchProjection, setTwitchProjection] = useState<TwitchProjection | undefined>();
  const [onboarding, setOnboarding] = useState<OnboardingProjection>();
  const [onboardingVisible, setOnboardingVisible] = useState(true);
  const [activities, setActivities] = useState<readonly ActivityItem[]>([]);
  const [restoredVersion, setRestoredVersion] = useState<number>();
  const [restorationVisible, setRestorationVisible] = useState(true);
  const [speechFallback, setSpeechFallback] = useState<string>();
  const [twitchActionPending, setTwitchActionPending] = useState(false);
  const [twitchNotice, setTwitchNotice] = useState<string>();
  const { preferences, updatePreferences, resetPreferences } = useUiPreferences();
  const preferencesRef = useRef(preferences);
  const handsFreeEnabledRef = useRef(true);
  const pendingActivitiesRef = useRef<ActivityItem[]>([]);
  const activityFrameRef = useRef<number | undefined>(undefined);
  const [speechQueue] = useState(() => createBrowserSpeechQueue(setSpeechFallback));
  const cloudSessionPresent = cloudProjection?.userId !== undefined;
  const connections =
    loadState.status === 'ready' ? Object.values(loadState.snapshot.connections) : [];
  const readyConnections = connections.filter((connection) => connection.phase === 'ready').length;

  const flushActivities = useCallback(() => {
    activityFrameRef.current = undefined;
    const batch = pendingActivitiesRef.current.splice(0);
    if (batch.length > 0) {
      setActivities((current) => mergeActivityBatch(current, batch));
    }
  }, []);

  const enqueueActivity = useCallback(
    (activity: ActivityItem) => {
      pendingActivitiesRef.current.push(activity);
      if (document.visibilityState === 'hidden' || activityFrameRef.current !== undefined) return;
      activityFrameRef.current = requestAnimationFrame(flushActivities);
    },
    [flushActivities],
  );

  const refreshRuntime = useCallback(async () => {
    try {
      const [bootstrap, snapshot, obs, cloud, twitch, handsFree, setup] = await Promise.all([
        window.obscurPilot.getBootstrap(),
        window.obscurPilot.getSnapshot(snapshotRef.current?.snapshotVersion),
        window.obscurPilot.getObsSnapshot(),
        window.obscurPilot.getCloudAuth(),
        window.obscurPilot.getTwitchProjection(),
        window.obscurPilot.getHandsFreeProjection(),
        window.obscurPilot.getOnboarding(),
      ]);
      handsFreeEnabledRef.current = handsFree.enabled;
      snapshotRef.current = snapshot;
      setObsProjection(obs);
      setCloudProjection(cloud);
      setTwitchProjection(twitch);
      setOnboarding(setup);
      setLoadState({ status: 'ready', bootstrap, snapshot });
      setRestoredVersion(snapshot.snapshotVersion);
      setRestorationVisible(true);
      setActivities((current) => mergeActivityBatch(current, activitiesFromSnapshot(snapshot)));
    } catch (error: unknown) {
      setLoadState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Bootstrap failed',
      });
    }
  }, []);

  const handleAgentActivity = useCallback(
    (agent: AgentInteractionProjection) => {
      enqueueActivity(activityFromAgent(agent));
      const announcement = announcementForAgent(agent);
      if (announcement !== null && !handsFreeEnabledRef.current) {
        const current = preferencesRef.current;
        speechQueue.enqueue(announcement, {
          enabled: current.speechEnabled,
          voiceUri: current.speechVoiceUri,
          volume: current.speechVolume,
        });
      }
    },
    [enqueueActivity, speechQueue],
  );

  const announceConnection = useCallback(
    (connection: ConnectionProjection) => {
      if (handsFreeEnabledRef.current) return;
      const current = preferencesRef.current;
      if (!current.announceConnectionChanges) return;
      const announcement = announcementForConnection(connection);
      if (announcement !== null) {
        speechQueue.enqueue(announcement, {
          enabled: current.speechEnabled,
          voiceUri: current.speechVoiceUri,
          volume: current.speechVolume,
        });
      }
    },
    [speechQueue],
  );

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  const connectTwitch = async () => {
    if (!cloudSessionPresent) {
      setTwitchNotice('Sign into Cloud access before connecting Twitch.');
      return;
    }
    setTwitchActionPending(true);
    setTwitchNotice(undefined);
    try {
      await window.obscurPilot.connectTwitch();
      setTwitchNotice('Twitch authorization opened in your browser.');
    } catch {
      const latest = await window.obscurPilot.getTwitchProjection();
      setTwitchProjection(latest);
      setTwitchNotice('Twitch authorization could not start. Check the connection and try again.');
    } finally {
      setTwitchActionPending(false);
    }
  };

  const refreshOnboarding = useCallback(() => {
    void window.obscurPilot.getOnboarding().then(setOnboarding);
  }, []);

  useEffect(() => {
    let active = true;
    let resyncing = false;
    const refreshObs = () => {
      void window.obscurPilot.getObsSnapshot().then((projection) => {
        if (active) setObsProjection(projection);
      });
    };
    const resynchronize = async () => {
      if (resyncing || !active) return;
      resyncing = true;
      try {
        const snapshot = await window.obscurPilot.getSnapshot(snapshotRef.current?.snapshotVersion);
        if (!active) return;
        snapshotRef.current = snapshot;
        setLoadState((current) =>
          current.status === 'ready' ? { ...current, snapshot } : current,
        );
        setRestoredVersion(snapshot.snapshotVersion);
        setRestorationVisible(true);
        setActivities((current) => mergeActivityBatch(current, activitiesFromSnapshot(snapshot)));
        refreshObs();
      } catch (error: unknown) {
        if (active) {
          setLoadState({
            status: 'error',
            message: error instanceof Error ? error.message : 'State resynchronization failed',
          });
        }
      } finally {
        resyncing = false;
      }
    };
    const unsubscribe = window.obscurPilot.onStateChanged((event) => {
      const current = snapshotRef.current;
      if (current === undefined) return;
      const next = applyStateChanged(current, event);
      if (next === 'resync_required') {
        void resynchronize();
        return;
      }
      snapshotRef.current = next;
      setLoadState((state) => (state.status === 'ready' ? { ...state, snapshot: next } : state));
      for (const patch of event.patches) {
        if (patch.kind !== 'connection') continue;
        enqueueActivity(activityFromConnection(patch.value));
        announceConnection(patch.value);
      }
      if (event.patches.some((patch) => patch.kind === 'connection' && patch.provider === 'obs')) {
        refreshObs();
        refreshOnboarding();
      }
      if (
        event.patches.some((patch) => patch.kind === 'connection' && patch.provider === 'twitch')
      ) {
        void window.obscurPilot.getTwitchProjection().then((projection) => {
          if (active) setTwitchProjection(projection);
        });
        refreshOnboarding();
      }
      if (
        event.patches.some((patch) => patch.kind === 'connection' && patch.provider === 'supabase')
      ) {
        void window.obscurPilot.getCloudAuth().then((projection) => {
          if (active) setCloudProjection(projection);
        });
        refreshOnboarding();
      }
    });
    const unsubscribeTwitch = window.obscurPilot.onTwitchActivity((activity) => {
      if (!active) return;
      enqueueActivity(activityFromTwitch(activity));
    });
    const unsubscribeHandsFree = window.obscurPilot.onHandsFreeChanged((projection) => {
      handsFreeEnabledRef.current = projection.enabled;
      if (projection.enabled) speechQueue.cancel();
    });

    void refreshRuntime();
    return () => {
      active = false;
      unsubscribe();
      unsubscribeTwitch();
      unsubscribeHandsFree();
    };
  }, [announceConnection, enqueueActivity, refreshOnboarding, refreshRuntime, speechQueue]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        flushActivities();
        return;
      }
      if (activityFrameRef.current !== undefined) {
        cancelAnimationFrame(activityFrameRef.current);
        activityFrameRef.current = undefined;
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (activityFrameRef.current !== undefined) cancelAnimationFrame(activityFrameRef.current);
      speechQueue.cancel();
    };
  }, [flushActivities, speechQueue]);

  const handleRecoveryAction = (action: RecoveryAction) => {
    if (action === 'retry_runtime') {
      void refreshRuntime();
      return;
    }
    if (action === 'reconnect_obs') {
      void window.obscurPilot
        .reconnectObs()
        .then(() => window.obscurPilot.getObsSnapshot())
        .then(setObsProjection);
      return;
    }
    if (action === 'reconnect_twitch') {
      void window.obscurPilot
        .reconnectTwitch()
        .then(() => window.obscurPilot.getTwitchProjection())
        .then(setTwitchProjection);
      return;
    }
    const targetId = action === 'sign_in' ? 'cloud-access' : 'settings';
    document.getElementById(targetId)?.scrollIntoView({ block: 'start' });
    if (action === 'sign_in') document.querySelector<HTMLInputElement>('#cloud-email')?.focus();
  };

  const testSpeech = () => {
    speechQueue.cancel();
    speechQueue.enqueue('ObscurPilot voice feedback is ready.', {
      enabled: preferences.speechEnabled,
      voiceUri: preferences.speechVoiceUri,
      volume: preferences.speechVolume,
    });
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to control board
      </a>
      <div className="workspace-layout">
        <aside className="control-sidebar" aria-label="ObscurPilot workspace navigation">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">
              O
            </span>
            <div>
              <span className="brand-name">ObscurPilot</span>
              <span className="brand-edition">Creator control plane</span>
            </div>
          </div>
          <nav className="workspace-nav" aria-label="Control board sections">
            <a className="workspace-nav-link" href="#command-center" aria-current="page">
              <span aria-hidden="true">01</span>
              Command
            </a>
            <a className="workspace-nav-link" href="#obs-studio">
              <span aria-hidden="true">02</span>
              OBS mirror
            </a>
            <a className="workspace-nav-link" href="#connections">
              <span aria-hidden="true">03</span>
              Connections
            </a>
            <a className="workspace-nav-link" href="#live-session">
              <span aria-hidden="true">04</span>
              Live session
            </a>
            <a className="workspace-nav-link" href="#activity-timeline">
              <span aria-hidden="true">04</span>
              Activity
            </a>
            <a className="workspace-nav-link" href="#recovery">
              <span aria-hidden="true">05</span>
              Recovery
            </a>
            <a className="workspace-nav-link" href="#twitch-integration">
              <span aria-hidden="true">06</span>
              Twitch
            </a>
            <a className="workspace-nav-link" href="#settings">
              <span aria-hidden="true">07</span>
              Settings
            </a>
          </nav>
          <div className="sidebar-health" aria-live="polite">
            <span className="health-indicator" data-ready={readyConnections > 0} />
            <div>
              <span className="sidebar-health-label">Runtime health</span>
              <span className="sidebar-health-value">
                {loadState.status === 'ready'
                  ? `${readyConnections}/${connections.length} providers ready`
                  : loadState.status}
              </span>
            </div>
          </div>
        </aside>
        <main className="workspace-main" id="main-content" tabIndex={-1}>
          <div className="app-frame">
            <header className="topbar">
              <div>
                <p className="eyebrow">Production command center</p>
                <h1>ObscurPilot</h1>
                <p className="subtitle">
                  One protected surface for voice, OBS truth, Twitch transport and cloud identity.
                </p>
              </div>
              <div className="topbar-status">
                <span className="topbar-status-label">Production control board</span>
                <Badge tone="ready">Stage 13 · Hardened runtime</Badge>
              </div>
            </header>

            {loadState.status === 'ready' ? (
              <section className="runtime-ribbon" aria-label="Provider readiness">
                <div className="runtime-ribbon-summary">
                  <span className="runtime-ribbon-kicker">System state</span>
                  <strong>{loadState.snapshot.lifecycle.replace('_', ' ')}</strong>
                </div>
                <div className="runtime-ribbon-providers">
                  {connections.map((connection) => (
                    <span
                      className="runtime-provider"
                      data-phase={connection.phase}
                      key={connection.provider}
                    >
                      <span className="runtime-provider-dot" aria-hidden="true" />
                      {connection.provider}
                      <span>{connection.phase.replace('_', ' ')}</span>
                    </span>
                  ))}
                </div>
              </section>
            ) : null}

            {loadState.status === 'ready' && onboarding !== undefined && onboardingVisible ? (
              <OnboardingPanel
                projection={onboarding}
                twitchPending={twitchActionPending}
                onOpenAccount={() => {
                  document.getElementById('cloud-access')?.scrollIntoView({ block: 'start' });
                  document.querySelector<HTMLInputElement>('#cloud-email')?.focus();
                }}
                onConnectTwitch={connectTwitch}
                onProjection={setOnboarding}
                onDismiss={() => setOnboardingVisible(false)}
                onObsProjectionChanged={() => {
                  void window.obscurPilot.getObsSnapshot().then(setObsProjection);
                }}
              />
            ) : null}

            {loadState.status === 'ready' && restorationVisible && restoredVersion !== undefined ? (
              <div className="restoration-banner" role="status">
                <span className="restoration-mark" aria-hidden="true" />
                <div>
                  <strong>Authoritative state restored</strong>
                  <span>
                    Snapshot {restoredVersion} reconstructed voice, OBS, Twitch and cloud surfaces.
                  </span>
                </div>
                <Button size="compact" variant="ghost" onClick={() => setRestorationVisible(false)}>
                  Dismiss
                </Button>
              </div>
            ) : null}

            {loadState.status === 'loading' ? (
              <Card aria-label="Loading secure runtime">
                <CardContent className="loading-skeletons">
                  <Skeleton className="skeleton-title" />
                  <Skeleton className="skeleton-copy" />
                  <Skeleton className="skeleton-panel" />
                  <span className="sr-only">Loading secure runtime</span>
                </CardContent>
              </Card>
            ) : null}
            {loadState.status === 'error' ? (
              <Card className="runtime-error" role="alert">
                <CardContent>
                  <h2 className="font-medium text-red-200">Runtime projection unavailable</h2>
                  <p className="mt-2 text-sm text-red-200/70">{loadState.message}</p>
                  <Button
                    className="mt-4"
                    variant="secondary"
                    onClick={() => void refreshRuntime()}
                  >
                    Retry secure runtime
                  </Button>
                </CardContent>
              </Card>
            ) : null}

            {speechFallback === undefined ? null : (
              <div className="speech-fallback" role="status" aria-live="polite">
                <strong>Voice feedback unavailable</strong>
                <span>{speechFallback}</span>
                <Button size="compact" variant="ghost" onClick={() => setSpeechFallback(undefined)}>
                  Dismiss
                </Button>
              </div>
            )}

            {loadState.status === 'ready' ? (
              <div className="dashboard-grid">
                <VoicePresence onAgentActivity={handleAgentActivity} />
                <ObsMirror
                  projection={obsProjection}
                  phase={loadState.snapshot.connections.obs.phase}
                  onReconnect={() => void window.obscurPilot.reconnectObs()}
                />
                <LiveSessionConsole obs={obsProjection} />
                <Card className="span-full" id="connections">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <h2 className="panel-title">Connection supervisors</h2>
                      <Badge tone={loadState.snapshot.lifecycle === 'ready' ? 'ready' : 'waiting'}>
                        {loadState.snapshot.lifecycle}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="connection-grid">
                    {Object.values(loadState.snapshot.connections).map((connection) => (
                      <ConnectionStatus connection={connection} key={connection.provider} />
                    ))}
                  </CardContent>
                </Card>
                <CloudAccess
                  projection={cloudProjection}
                  onProjection={(projection) => {
                    setCloudProjection(projection);
                    refreshOnboarding();
                  }}
                />
                <Card className="span-full" id="twitch-integration">
                  <CardHeader>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="eyebrow">Remote event transport</p>
                        <h2 className="panel-title">Twitch connection</h2>
                      </div>
                      <Badge tone={twitchProjection?.phase === 'connected' ? 'ready' : 'neutral'}>
                        {twitchProjection?.phase.replace('_', ' ') ?? 'unavailable'}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap items-center gap-3">
                      {twitchProjection?.phase === 'connected' ? (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            void window.obscurPilot.disconnectTwitch().then(setTwitchProjection)
                          }
                        >
                          Disconnect Twitch
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          disabled={
                            twitchActionPending ||
                            !loadState.bootstrap.configuration.twitchConfigured ||
                            !cloudSessionPresent
                          }
                          onClick={() => void connectTwitch()}
                        >
                          {twitchActionPending ? 'Opening Twitch…' : 'Connect Twitch'}
                        </Button>
                      )}
                      {twitchProjection?.account !== undefined ? (
                        <span className="text-sm text-zinc-400">
                          {twitchProjection.account.displayName} ·{' '}
                          {twitchProjection.account.scopes.length} scopes
                        </span>
                      ) : null}
                    </div>
                    {twitchNotice !== undefined ? (
                      <p className="cloud-notice" role="status" aria-live="polite">
                        {twitchNotice}
                      </p>
                    ) : null}
                    <div className="transport-note">
                      <strong>EventSub activity is live</strong>
                      <span>
                        Bounded Twitch events are normalized, deduplicated and routed into the
                        virtualized activity timeline.
                      </span>
                    </div>
                  </CardContent>
                </Card>
                <ActivityTimeline activities={activities} />
                <RecoveryCenter connections={connections} onAction={handleRecoveryAction} />
                <ControlSettings
                  preferences={preferences}
                  onChange={updatePreferences}
                  onReset={resetPreferences}
                  onTestSpeech={testSpeech}
                />
                <Card className="span-full" id="configuration">
                  <CardHeader>
                    <h2 className="panel-title">Provider configuration</h2>
                  </CardHeader>
                  <CardContent className="configuration-grid">
                    <ConfigurationStatus
                      configured={loadState.bootstrap.configuration.deepgramConfigured}
                      label="Deepgram voice"
                    />
                    <ConfigurationStatus
                      configured={loadState.bootstrap.configuration.groqConfigured}
                      label="Groq"
                    />
                    <ConfigurationStatus
                      configured={loadState.bootstrap.configuration.supabaseConfigured}
                      label="Supabase"
                    />
                    <ConfigurationStatus
                      configured={loadState.bootstrap.configuration.twitchConfigured}
                      label="Twitch"
                    />
                  </CardContent>
                </Card>
              </div>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
