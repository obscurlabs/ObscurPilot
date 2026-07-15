import type { BootstrapProjection } from '@obscurpilot/contracts/bootstrap';
import type { AppSnapshot, ConnectionProjection } from '@obscurpilot/contracts/state';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardHeader } from '../components/ui/card';
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
    <div className="flex items-center justify-between rounded-xl border border-white/8 bg-white/3 px-4 py-3">
      <span className="text-sm text-zinc-300">{label}</span>
      <Badge tone={configured ? 'ready' : 'waiting'}>
        {configured ? 'Configured' : 'Waiting for .env'}
      </Badge>
    </div>
  );
}

function ConnectionStatus({ connection }: { readonly connection: ConnectionProjection }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/3 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-zinc-200 uppercase">{connection.provider}</span>
        <Badge tone={connection.phase === 'ready' ? 'ready' : 'neutral'}>
          {connection.phase.replace('_', ' ')}
        </Badge>
      </div>
      <p className="mt-2 text-xs text-zinc-500">{connection.reasonCode}</p>
    </div>
  );
}

export function App() {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const snapshotRef = useRef<AppSnapshot | undefined>(undefined);

  useEffect(() => {
    let active = true;
    let resyncing = false;

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
    });

    Promise.all([window.obscurPilot.getBootstrap(), window.obscurPilot.getSnapshot()])
      .then(([bootstrap, snapshot]) => {
        if (!active) return;
        snapshotRef.current = snapshot;
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
    <main className="min-h-screen bg-zinc-950 px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex items-end justify-between gap-6">
          <div>
            <p className="mb-2 text-xs font-medium tracking-[0.24em] text-violet-300 uppercase">
              Secure runtime diagnostics
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">ObscurPilot</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
              Typed IPC, monotonic state, and supervised provider boundaries are operational.
            </p>
          </div>
          <Badge tone="accent">Stages 2–3</Badge>
        </header>

        {loadState.status === 'loading' ? (
          <Card>
            <CardContent className="text-zinc-400">
              Loading the secure main-process projection…
            </CardContent>
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
          <div className="grid gap-6">
            <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-medium text-zinc-200">Runtime boundary</h2>
                    <Badge tone={loadState.snapshot.lifecycle === 'ready' ? 'ready' : 'waiting'}>
                      {loadState.snapshot.lifecycle}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <dt className="text-zinc-500">Desktop</dt>
                      <dd className="mt-1 text-zinc-200">{loadState.bootstrap.app.version}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Snapshot</dt>
                      <dd className="mt-1 text-zinc-200">v{loadState.snapshot.snapshotVersion}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Electron</dt>
                      <dd className="mt-1 text-zinc-200">{loadState.bootstrap.runtime.electron}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Platform</dt>
                      <dd className="mt-1 text-zinc-200">{loadState.bootstrap.runtime.platform}</dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <h2 className="text-sm font-medium text-zinc-200">Local configuration</h2>
                </CardHeader>
                <CardContent className="space-y-3">
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

            <Card>
              <CardHeader>
                <h2 className="text-sm font-medium text-zinc-200">Connection supervisors</h2>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {Object.values(loadState.snapshot.connections).map((connection) => (
                  <ConnectionStatus connection={connection} key={connection.provider} />
                ))}
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>
    </main>
  );
}
