import { describe, expect, it } from 'vitest';
import { projectOnboarding } from '../../apps/desktop/electron/onboarding-service';

const ready = {
  endpoint: 'ws://127.0.0.1:4455',
  secureStorageAvailable: true,
  passwordStored: true,
  accountConfigured: true,
  accountReady: true,
  accountReasonCode: 'AUTHENTICATED',
  twitchConfigured: true,
  twitchReady: true,
  twitchReasonCode: 'CONNECTED',
  obsPhase: 'ready' as const,
  obsReady: true,
  obsReasonCode: 'SYNCHRONIZED',
};

describe('Stage 12 onboarding projection', () => {
  it('advances in account, Twitch, OBS order without exposing a password', () => {
    const account = projectOnboarding({
      ...ready,
      accountReady: false,
      twitchReady: false,
      obsReady: false,
    });
    expect(account.nextStep).toBe('account');
    expect(account.account.status).toBe('current');
    expect(JSON.stringify(account)).not.toContain('one-time-secret');

    const twitch = projectOnboarding({ ...ready, twitchReady: false, obsReady: false });
    expect(twitch.nextStep).toBe('twitch');
    expect(twitch.obs.status).toBe('waiting');

    const obs = projectOnboarding({ ...ready, obsReady: false, obsPhase: 'auth_required' });
    expect(obs.nextStep).toBe('obs');
    expect(obs.obs.status).toBe('current');
    expect(projectOnboarding(ready)).toMatchObject({ complete: true, nextStep: 'complete' });
  });

  it('blocks password pairing when OS encryption is unavailable', () => {
    const projection = projectOnboarding({
      ...ready,
      obsReady: false,
      obsPhase: 'auth_required',
      secureStorageAvailable: false,
      passwordStored: false,
    });
    expect(projection.obs).toMatchObject({
      status: 'blocked',
      reasonCode: 'SECURE_STORAGE_UNAVAILABLE',
    });
  });
});
