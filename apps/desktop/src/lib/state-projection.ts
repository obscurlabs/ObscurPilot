import type {
  AppSnapshot,
  ConnectionProjection,
  StateChanged,
} from '@obscurpilot/contracts/state';

/**
 * Whether a provider can serve ObscurPilot right now. Wispr Flow and Groq are request based:
 * they sit `idle` with a configured key until a clip or command is sent, which still counts.
 */
export function isConnectionUp(connection: ConnectionProjection): boolean {
  if (connection.phase === 'ready') return true;
  return connection.phase === 'idle' && connection.reasonCode === 'CONFIGURED';
}

export function applyStateChanged(
  snapshot: AppSnapshot,
  event: StateChanged,
): AppSnapshot | 'resync_required' {
  if (event.snapshotVersion !== snapshot.snapshotVersion + 1) return 'resync_required';
  let lifecycle = snapshot.lifecycle;
  let connections = snapshot.connections;
  for (const patch of event.patches) {
    if (patch.kind === 'lifecycle') {
      lifecycle = patch.value;
    } else {
      connections = { ...connections, [patch.provider]: patch.value };
    }
  }
  return {
    ...snapshot,
    snapshotVersion: event.snapshotVersion,
    generatedAt: new Date().toISOString(),
    lifecycle,
    connections,
  };
}
