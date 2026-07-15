import type { AppSnapshot, StateChanged } from '@obscurpilot/contracts/state';

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
