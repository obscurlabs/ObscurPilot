import type { AgentInteractionProjection } from '@obscurpilot/contracts/agent';
import type { BootstrapProjection } from '@obscurpilot/contracts/bootstrap';
import type { CloudAuthProjection } from '@obscurpilot/contracts/cloud';
import type { ObsProjection } from '@obscurpilot/contracts/obs';
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
import { LiveSessionConsole } from '../components/live-session-console';
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
import { HomePage } from '../pages/home';
import { ShortcutsPage } from '../pages/shortcuts';

type Page = 'home' | 'connections' | 'shortcuts' | 'live' | 'activity' | 'settings';

const NAV_ITEMS: ReadonlyArray<{ readonly page: Page; readonly label: string }> = [
  { page: 'home', label: 'Home' },
  { page: 'connections', label: 'Connections' },
  { page: 'shortcuts', label: 'Shortcuts' },
  { page: 'live', label: 'Live session' },
  { page: 'activity', label: 'Activity' },
  { page: 'settings', label: 'Settings' },
];

function NavIcon({ page }: { readonly page: Page }) {
  const paths: Record<Page, React.ReactNode> = {
    home: (
      <>
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5 9.5V21h14V9.5" />
      </>
    ),
    connections: (
      <>
        <path d="M9 7v4a3 3 0 0 0 6 0V7" />
        <path d="M12 14v7" />
        <path d="M8 3v4M16 3v4" />
      </>
    ),
    shortcuts: (
      <>
        <rect x="3" y="7" width="18" height="12" rx="2" />
        <path d="M7 11h.01M11 11h.01M15 11h.01M7 15h10" />
      </>
    ),
    live: (
      <>
        <circle cx="12" cy="12" r="2" />
        <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4" />
        <path d="M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2" />
      </>
    ),
    activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
    settings: (
      <>
        <path d="M4 8h10M18 8h2M4 16h2M10 16h10" />
        <circle cx="16" cy="8" r="2" />
        <circle cx="8" cy="16" r="2" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="18"
    >
      {paths[page]}
    </svg>
  );
}

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
        {configured ? 'Configured' : 'Waiting for .env'}
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
  const [page, setPage] = useState<Page>('home');
  const [obsProjection, setObsProjection] = useState<ObsProjection | undefined>(undefined);
  const snapshotRef = useRef<AppSnapshot | undefined>(undefined);
  const [cloudProjection, setCloudProjection] = useState<CloudAuthProjection | undefined>();
  const [twitchProjection, setTwitchProjection] = useState<TwitchProjection | undefined>();
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
      const [bootstrap, snapshot, obs, cloud, twitch, handsFree] = await Promise.all([
        window.obscurPilot.getBootstrap(),
        window.obscurPilot.getSnapshot(snapshotRef.current?.snapshotVersion),
        window.obscurPilot.getObsSnapshot(),
        window.obscurPilot.getCloudAuth(),
        window.obscurPilot.getTwitchProjection(),
        window.obscurPilot.getHandsFreeProjection(),
      ]);
      handsFreeEnabledRef.current = handsFree.enabled;
      snapshotRef.current = snapshot;
      setObsProjection(obs);
      setCloudProjection(cloud);
      setTwitchProjection(twitch);
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
      }
      if (
        event.patches.some((patch) => patch.kind === 'connection' && patch.provider === 'twitch')
      ) {
        void window.obscurPilot.getTwitchProjection().then((projection) => {
          if (active) setTwitchProjection(projection);
        });
      }
      if (
        event.patches.some((patch) => patch.kind === 'connection' && patch.provider === 'supabase')
      ) {
        void window.obscurPilot.getCloudAuth().then((projection) => {
          if (active) setCloudProjection(projection);
        });
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
  }, [announceConnection, enqueueActivity, refreshRuntime, speechQueue]);

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
    <div className="op-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="op-rail" aria-label="ObscurPilot navigation">
        <div className="op-brand">
          <span className="op-brand-mark" aria-hidden="true" />
          <div>
            <span className="op-brand-name">ObscurPilot</span>
            <span className="op-brand-tag">Stream copilot</span>
          </div>
        </div>
        <nav className="op-nav" aria-label="Pages">
          {NAV_ITEMS.map((item) => (
            <button
              aria-current={page === item.page ? 'page' : undefined}
              className="op-nav-button"
              data-active={page === item.page}
              key={item.page}
              type="button"
              onClick={() => setPage(item.page)}
            >
              <NavIcon page={item.page} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="op-rail-foot" aria-live="polite">
          <span
            className="health-indicator"
            data-ready={connections.length > 0 && readyConnections === connections.length}
          />
          <span className="op-rail-health">
            {loadState.status === 'ready'
              ? `${readyConnections} of ${connections.length} connections ready`
              : 'Starting secure runtime…'}
          </span>
        </div>
      </aside>
      <main className="op-main" id="main-content" tabIndex={-1}>
        {loadState.status === 'ready' && restorationVisible && restoredVersion !== undefined ? (
          <div className="restoration-banner" role="status">
            <span className="restoration-mark" aria-hidden="true" />
            <div>
              <strong>Session restored</strong>
              <span>Voice, OBS, Twitch and cloud state were reconstructed.</span>
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
              <h2 className="font-medium text-red-200">The runtime is unavailable</h2>
              <p className="mt-2 text-sm text-red-200/70">{loadState.message}</p>
              <Button className="mt-4" variant="secondary" onClick={() => void refreshRuntime()}>
                Try again
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
          page === 'home' ? (
            <HomePage
              activities={activities}
              connections={connections}
              obs={obsProjection}
              twitch={twitchProjection}
              onAgentActivity={handleAgentActivity}
              onNavigate={setPage}
            />
          ) : page === 'connections' ? (
            <div className="op-page">
              <header className="op-page-head">
                <h1>Connections</h1>
                <p>
                  Everything the copilot talks to. Local control keeps working even when cloud
                  services degrade.
                </p>
              </header>
              <div className="op-connect-grid">
                <ObsMirror
                  projection={obsProjection}
                  phase={loadState.snapshot.connections.obs.phase}
                  onReconnect={() => void window.obscurPilot.reconnectObs()}
                />
                <Card id="twitch-integration">
                  <CardHeader>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="eyebrow">Chat, events and moderation</p>
                        <h2 className="panel-title">Twitch</h2>
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
                  </CardContent>
                </Card>
                <CloudAccess projection={cloudProjection} onProjection={setCloudProjection} />
                <Card id="configuration">
                  <CardHeader>
                    <h2 className="panel-title">Provider keys</h2>
                  </CardHeader>
                  <CardContent className="configuration-grid">
                    <ConfigurationStatus
                      configured={loadState.bootstrap.configuration.groqConfigured}
                      label="Groq voice engine"
                    />
                    <ConfigurationStatus
                      configured={loadState.bootstrap.configuration.supabaseConfigured}
                      label="Supabase cloud"
                    />
                    <ConfigurationStatus
                      configured={loadState.bootstrap.configuration.twitchConfigured}
                      label="Twitch app"
                    />
                  </CardContent>
                </Card>
              </div>
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
              <RecoveryCenter connections={connections} onAction={handleRecoveryAction} />
            </div>
          ) : page === 'shortcuts' ? (
            <ShortcutsPage />
          ) : page === 'live' ? (
            <div className="op-page">
              <header className="op-page-head">
                <h1>Live session</h1>
                <p>
                  Prepare, rehearse and go live. Nothing starts without your explicit approval.
                </p>
              </header>
              <LiveSessionConsole obs={obsProjection} />
            </div>
          ) : page === 'activity' ? (
            <div className="op-page">
              <header className="op-page-head">
                <h1>Activity</h1>
                <p>Everything the copilot heard, did and observed — newest first.</p>
              </header>
              <ActivityTimeline activities={activities} />
            </div>
          ) : (
            <div className="op-page">
              <header className="op-page-head">
                <h1>Settings</h1>
                <p>Motion, spoken feedback and interface preferences.</p>
              </header>
              <ControlSettings
                preferences={preferences}
                onChange={updatePreferences}
                onReset={resetPreferences}
                onTestSpeech={testSpeech}
              />
            </div>
          )
        ) : null}
      </main>
    </div>
  );
}
