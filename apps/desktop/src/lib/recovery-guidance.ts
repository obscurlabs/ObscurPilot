import { PUBLIC_ERROR_CODES, type PublicErrorCode } from '@obscurpilot/contracts/errors';
import type { ConnectionProjection } from '@obscurpilot/contracts/state';

export type RecoveryAction =
  'none' | 'retry_runtime' | 'reconnect_obs' | 'reconnect_twitch' | 'sign_in' | 'review_settings';

export interface RecoveryGuidance {
  readonly title: string;
  readonly description: string;
  readonly action: RecoveryAction;
  readonly actionLabel?: string;
}

export const PUBLIC_ERROR_GUIDANCE: Record<PublicErrorCode, RecoveryGuidance> = {
  VALIDATION_FAILED: {
    title: 'Request needs correction',
    description: 'Review the highlighted values and submit the request again.',
    action: 'review_settings',
    actionLabel: 'Review settings',
  },
  AUTH_REQUIRED: {
    title: 'Sign-in required',
    description: 'Restore the creator session before retrying this operation.',
    action: 'sign_in',
    actionLabel: 'Open cloud access',
  },
  PERMISSION_DENIED: {
    title: 'Permission unavailable',
    description: 'Reconnect the provider and approve only the requested permission.',
    action: 'review_settings',
    actionLabel: 'Review connections',
  },
  RESOURCE_NOT_FOUND: {
    title: 'Resource not found',
    description: 'Refresh the authoritative provider state and verify the resource still exists.',
    action: 'retry_runtime',
    actionLabel: 'Refresh state',
  },
  PRECONDITION_FAILED: {
    title: 'State changed before execution',
    description: 'Refresh current state, review the updated plan, and try again.',
    action: 'retry_runtime',
    actionLabel: 'Refresh state',
  },
  RATE_LIMITED: {
    title: 'Provider is rate limiting requests',
    description: 'Wait for the supervised backoff to finish before retrying.',
    action: 'none',
  },
  UPSTREAM_UNAVAILABLE: {
    title: 'Provider temporarily unavailable',
    description: 'Keep the application open while the connection supervisor recovers.',
    action: 'retry_runtime',
    actionLabel: 'Retry now',
  },
  TIMEOUT: {
    title: 'Provider response timed out',
    description: 'Refresh authoritative state before deciding whether to retry.',
    action: 'retry_runtime',
    actionLabel: 'Refresh state',
  },
  CONFLICT: {
    title: 'A newer operation is already active',
    description: 'Wait for the active operation to finish, then refresh state.',
    action: 'retry_runtime',
    actionLabel: 'Refresh state',
  },
  CANCELLED: {
    title: 'Operation cancelled safely',
    description: 'No further action is required. Start a new command when ready.',
    action: 'none',
  },
  POLICY_REJECTED: {
    title: 'Safety policy stopped the request',
    description: 'Revise the request without bypassing confirmation or permission boundaries.',
    action: 'none',
  },
  INTERNAL: {
    title: 'Runtime could not complete the request',
    description: 'Refresh the runtime. If it repeats, retain the correlation ID for diagnostics.',
    action: 'retry_runtime',
    actionLabel: 'Refresh runtime',
  },
};

export function guidanceForPublicError(code: PublicErrorCode): RecoveryGuidance {
  return PUBLIC_ERROR_GUIDANCE[code];
}

export function guidanceForConnection(connection: ConnectionProjection): RecoveryGuidance | null {
  if (connection.phase === 'ready' || connection.phase === 'idle') return null;
  if (connection.provider === 'obs') {
    return {
      title: 'OBS connection needs attention',
      description: 'Confirm OBS WebSocket is enabled on loopback port 4455, then reconnect.',
      action: 'reconnect_obs',
      actionLabel: 'Reconnect OBS',
    };
  }
  if (connection.provider === 'twitch') {
    return {
      title: 'Twitch connection needs attention',
      description:
        connection.phase === 'auth_required'
          ? 'Reconnect Twitch to restore the approved authorization.'
          : 'Refresh the EventSub transport after the supervised backoff.',
      action: 'reconnect_twitch',
      actionLabel: 'Reconnect Twitch',
    };
  }
  if (connection.provider === 'supabase' && connection.phase === 'auth_required') {
    return {
      title: 'Cloud session required',
      description: 'Sign in again to resume secure synchronization.',
      action: 'sign_in',
      actionLabel: 'Open cloud access',
    };
  }
  return {
    title: `${connection.provider.toUpperCase()} is recovering`,
    description: `Current state: ${connection.reasonCode.replaceAll('_', ' ')}. Keep the application open while supervised recovery runs.`,
    action: 'none',
  };
}

export function hasCompletePublicErrorCatalog(): boolean {
  return PUBLIC_ERROR_CODES.every((code) => PUBLIC_ERROR_GUIDANCE[code] !== undefined);
}
