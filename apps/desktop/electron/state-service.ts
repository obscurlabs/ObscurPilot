import type {
  AppSnapshot,
  ConnectionProjection,
  ConnectionProvider,
  StatePatch,
} from '@obscurpilot/contracts/state';
import { SnapshotStore, type VersionedPatchEvent } from '@obscurpilot/domain/snapshot-store';

interface MainState {
  readonly lifecycle: AppSnapshot['lifecycle'];
  readonly connections: Readonly<Record<ConnectionProvider, ConnectionProjection>>;
}

const PROVIDERS: readonly ConnectionProvider[] = ['obs', 'twitch', 'groq', 'supabase'];
const INITIAL_CORRELATION_ID = '00000000-0000-4000-8000-000000000000';

function initialConnection(provider: ConnectionProvider): ConnectionProjection {
  return {
    provider,
    phase: 'idle',
    attempt: 0,
    changedAt: new Date(0).toISOString(),
    reasonCode: 'NOT_STARTED',
    correlationId: INITIAL_CORRELATION_ID,
  };
}

export class MainStateService {
  private readonly store = new SnapshotStore<MainState, StatePatch>({
    lifecycle: 'starting',
    connections: Object.fromEntries(
      PROVIDERS.map((provider) => [provider, initialConnection(provider)]),
    ) as Record<ConnectionProvider, ConnectionProjection>,
  });

  public snapshot(): AppSnapshot {
    const snapshot = this.store.snapshot();
    return {
      protocolVersion: 1,
      snapshotVersion: snapshot.snapshotVersion,
      generatedAt: new Date().toISOString(),
      lifecycle: snapshot.state.lifecycle,
      connections: snapshot.state.connections,
    };
  }

  public setLifecycle(lifecycle: AppSnapshot['lifecycle']): void {
    const current = this.store.snapshot().state;
    if (current.lifecycle === lifecycle) return;
    this.store.mutate({ ...current, lifecycle }, [{ kind: 'lifecycle', value: lifecycle }]);
  }

  public subscribe(listener: (event: VersionedPatchEvent<StatePatch>) => void): () => void {
    return this.store.subscribe(listener);
  }
}
