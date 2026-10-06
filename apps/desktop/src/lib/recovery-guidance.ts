import type { ConnectionProjection } from '@obscurpilot/contracts/state';

export type RecoveryAction =
  'none' | 'retry_runtime' | 'reconnect_obs' | 'reconnect_twitch' | 'sign_in' | 'review_settings';

export interface RecoveryGuidance {
  readonly title: string;
  readonly description: string;
  readonly action: RecoveryAction;
  readonly actionLabel?: string;
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
  if (connection.provider === 'wispr' && connection.phase === 'auth_required') {
    return {
      title: 'Wispr Flow key needed',
      description: 'Add your Wispr Flow API key to .env, then restart ObscurPilot to transcribe voice.',
      action: 'review_settings',
      actionLabel: 'Review provider keys',
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
