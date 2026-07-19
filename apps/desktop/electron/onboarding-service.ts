import {
  OnboardingProjectionSchema,
  type OnboardingProjection,
  type OnboardingStepStatus,
} from '@obscurpilot/contracts/onboarding';
import type { ConnectionPhase } from '@obscurpilot/contracts/state';

export interface OnboardingInputs {
  readonly endpoint: string;
  readonly secureStorageAvailable: boolean;
  readonly passwordStored: boolean;
  readonly accountConfigured: boolean;
  readonly accountReady: boolean;
  readonly accountReasonCode: string;
  readonly twitchConfigured: boolean;
  readonly twitchReady: boolean;
  readonly twitchReasonCode: string;
  readonly obsPhase: ConnectionPhase;
  readonly obsReady: boolean;
  readonly obsReasonCode: string;
}

export function projectOnboarding(inputs: OnboardingInputs): OnboardingProjection {
  const nextStep = !inputs.accountReady
    ? 'account'
    : !inputs.twitchReady
      ? 'twitch'
      : !inputs.obsReady
        ? 'obs'
        : 'complete';
  const status = (
    step: Exclude<OnboardingProjection['nextStep'], 'complete'>,
    ready: boolean,
    configured = true,
  ): OnboardingStepStatus => {
    if (ready) return 'complete';
    if (!configured) return 'blocked';
    return nextStep === step ? 'current' : 'waiting';
  };
  return OnboardingProjectionSchema.parse({
    schemaVersion: 1,
    complete: nextStep === 'complete',
    nextStep,
    account: {
      status: status('account', inputs.accountReady, inputs.accountConfigured),
      ready: inputs.accountReady,
      reasonCode: inputs.accountReasonCode,
    },
    twitch: {
      status: status('twitch', inputs.twitchReady, inputs.twitchConfigured),
      ready: inputs.twitchReady,
      reasonCode: inputs.twitchReasonCode,
    },
    obs: {
      status:
        inputs.obsPhase === 'auth_required' && !inputs.secureStorageAvailable
          ? 'blocked'
          : status('obs', inputs.obsReady),
      ready: inputs.obsReady,
      reasonCode:
        inputs.obsPhase === 'auth_required' && !inputs.secureStorageAvailable
          ? 'SECURE_STORAGE_UNAVAILABLE'
          : inputs.obsReasonCode,
      endpoint: inputs.endpoint,
      passwordStored: inputs.passwordStored,
      secureStorageAvailable: inputs.secureStorageAvailable,
    },
  });
}
