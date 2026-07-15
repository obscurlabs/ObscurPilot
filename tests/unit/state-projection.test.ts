import { applyStateChanged } from '../../apps/desktop/src/lib/state-projection';
import type { AppSnapshot } from '@obscurpilot/contracts/state';
import { describe, expect, it } from 'vitest';

function snapshot(): AppSnapshot {
  const connection = (provider: 'obs' | 'twitch' | 'groq' | 'supabase') => ({
    provider,
    phase: 'idle' as const,
    attempt: 0,
    changedAt: new Date(0).toISOString(),
    reasonCode: 'NOT_STARTED',
    correlationId: '00000000-0000-4000-8000-000000000000',
  });
  return {
    protocolVersion: 1,
    snapshotVersion: 4,
    generatedAt: new Date(0).toISOString(),
    lifecycle: 'starting',
    connections: {
      obs: connection('obs'),
      twitch: connection('twitch'),
      groq: connection('groq'),
      supabase: connection('supabase'),
    },
  };
}

describe('renderer snapshot projection', () => {
  it('applies exactly the next version and forces resync on a gap', () => {
    const current = snapshot();
    const next = applyStateChanged(current, {
      snapshotVersion: 5,
      patches: [{ kind: 'lifecycle', value: 'ready' }],
    });
    expect(next).not.toBe('resync_required');
    if (next !== 'resync_required') {
      expect(next).toMatchObject({ snapshotVersion: 5, lifecycle: 'ready' });
    }
    expect(
      applyStateChanged(current, {
        snapshotVersion: 6,
        patches: [{ kind: 'lifecycle', value: 'ready' }],
      }),
    ).toBe('resync_required');
  });
});
