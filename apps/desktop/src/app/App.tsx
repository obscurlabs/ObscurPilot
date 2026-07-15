import type { BootstrapProjection } from '@obscurpilot/contracts/bootstrap';
import type { ObsProjection } from '@obscurpilot/contracts/obs';
import type { AppSnapshot, ConnectionProjection } from '@obscurpilot/contracts/state';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { VoicePresence } from '../components/voice-presence';
import { applyStateChanged } from '../lib/state-projection';

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
    <Card className="obs-mirror">
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
      if (event.patches.some((patch) => patch.kind === 'connection' && patch.provider === 'obs')) {
        refreshObs();
      }
    });

    Promise.all([
      window.obscurPilot.getBootstrap(),
      window.obscurPilot.getSnapshot(),
      window.obscurPilot.getObsSnapshot(),
    ])
      .then(([bootstrap, snapshot, obs]) => {
        if (!active) return;
        snapshotRef.current = snapshot;
        setObsProjection(obs);
        setLoadState({ status: 'ready', bootstrap, snapshot });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Bootstrap failed',
        });
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return (
    <main className="app-shell">
      <div className="app-frame">
        <header className="topbar">
          <div>
            <p className="eyebrow">Local-first production intelligence</p>
            <h1>ObscurPilot</h1>
            <p className="subtitle">
              Voice capture and OBS truth remain inside the protected desktop boundary.
            </p>
          </div>
          <Badge tone="accent">Stages 4–5</Badge>
        </header>

        {loadState.status === 'loading' ? (
          <Card>
            <CardContent className="text-zinc-400">Loading secure runtime…</CardContent>
          </Card>
        ) : null}
        {loadState.status === 'error' ? (
          <Card className="border-red-400/20 bg-red-400/5" role="alert">
            <CardContent>
              <h2 className="font-medium text-red-200">Runtime projection unavailable</h2>
              <p className="mt-2 text-sm text-red-200/70">{loadState.message}</p>
            </CardContent>
          </Card>
        ) : null}

        {loadState.status === 'ready' ? (
          <div className="dashboard-grid">
            <VoicePresence />
            <ObsMirror
              projection={obsProjection}
              phase={loadState.snapshot.connections.obs.phase}
              onReconnect={() => void window.obscurPilot.reconnectObs()}
            />
            <Card className="span-full">
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
            <Card className="span-full">
              <CardHeader>
                <h2 className="panel-title">Provider configuration</h2>
              </CardHeader>
              <CardContent className="configuration-grid">
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
  );
}
