import {
  OnboardingProjectionSchema,
  PairObsPayloadSchema,
} from '@obscurpilot/contracts/onboarding';
import { describe, expect, it } from 'vitest';

describe('Stage 12 onboarding contract', () => {
  it('exposes readiness without accepting secret fields in projections', () => {
    const projection = {
      schemaVersion: 1,
      complete: false,
      nextStep: 'obs',
      account: { status: 'complete', ready: true, reasonCode: 'AUTHENTICATED' },
      twitch: { status: 'complete', ready: true, reasonCode: 'CONNECTED' },
      obs: {
        status: 'current',
        ready: false,
        reasonCode: 'AUTH_REQUIRED',
        endpoint: 'ws://127.0.0.1:4455',
        passwordStored: false,
        secureStorageAvailable: true,
      },
    };
    expect(OnboardingProjectionSchema.parse(projection)).toEqual(projection);
    expect(() =>
      OnboardingProjectionSchema.parse({
        ...projection,
        obs: { ...projection.obs, password: 'must-never-cross-preload' },
      }),
    ).toThrow();
  });

  it('accepts only a bounded pairing password and loopback endpoints', () => {
    expect(PairObsPayloadSchema.parse({ password: 'local-only' })).toEqual({
      password: 'local-only',
    });
    expect(() => PairObsPayloadSchema.parse({ password: 'x'.repeat(257) })).toThrow();
    expect(() =>
      OnboardingProjectionSchema.parse({
        schemaVersion: 1,
        complete: false,
        nextStep: 'obs',
        account: { status: 'complete', ready: true, reasonCode: 'READY' },
        twitch: { status: 'complete', ready: true, reasonCode: 'READY' },
        obs: {
          status: 'current',
          ready: false,
          reasonCode: 'CONNECTING',
          endpoint: 'ws://remote.example:4455',
          passwordStored: false,
          secureStorageAvailable: true,
        },
      }),
    ).toThrow();
  });
});
