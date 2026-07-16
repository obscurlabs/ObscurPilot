import { PUBLIC_ERROR_CODES } from '@obscurpilot/contracts/errors';
import {
  guidanceForConnection,
  guidanceForPublicError,
  hasCompletePublicErrorCatalog,
} from '../../apps/desktop/src/lib/recovery-guidance';
import { describe, expect, it } from 'vitest';

describe('actionable recovery catalog', () => {
  it('defines a safe presentation for every public error code', () => {
    expect(hasCompletePublicErrorCatalog()).toBe(true);
    for (const code of PUBLIC_ERROR_CODES) {
      const guidance = guidanceForPublicError(code);
      expect(guidance.title.length).toBeGreaterThan(0);
      expect(guidance.description.length).toBeGreaterThan(0);
      if (guidance.action !== 'none') expect(guidance.actionLabel).toBeTruthy();
    }
  });

  it('maps provider recovery to typed preload actions', () => {
    const base = {
      attempt: 2,
      changedAt: new Date(0).toISOString(),
      correlationId: '00000000-0000-4000-8000-000000000000',
      reasonCode: 'CONNECTION_LOST',
    };
    expect(guidanceForConnection({ ...base, provider: 'obs', phase: 'reconnecting' })?.action).toBe(
      'reconnect_obs',
    );
    expect(
      guidanceForConnection({ ...base, provider: 'twitch', phase: 'auth_required' })?.action,
    ).toBe('reconnect_twitch');
    expect(guidanceForConnection({ ...base, provider: 'groq', phase: 'idle' })).toBeNull();
  });
});
