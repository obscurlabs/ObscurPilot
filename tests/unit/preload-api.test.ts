import { createRendererApi } from '../../apps/desktop/electron/preload-api';
import { IPC_CHANNELS } from '@obscurpilot/contracts/ipc';
import { describe, expect, it } from 'vitest';

type Listener = (event: unknown, payload: unknown) => void;

class FakeRendererIpc {
  private readonly listeners = new Map<string, Set<Listener>>();

  public async invoke(channel: string, rawRequest: unknown): Promise<unknown> {
    const requestId =
      typeof rawRequest === 'object' &&
      rawRequest !== null &&
      'requestId' in rawRequest &&
      typeof rawRequest.requestId === 'string'
        ? rawRequest.requestId
        : crypto.randomUUID();
    if (channel === IPC_CHANNELS.getBootstrap) {
      return {
        ok: true,
        requestId,
        data: {
          protocolVersion: 1,
          app: { name: 'ObscurPilot', version: '0.1.0' },
          runtime: {
            platform: 'win32',
            electron: '43',
            chrome: '144',
            node: '24',
          },
          configuration: {
            groqConfigured: false,
            supabaseConfigured: false,
            twitchConfigured: false,
          },
        },
      };
    }
    return {
      ok: true,
      requestId,
      data: {
        protocolVersion: 1,
        snapshotVersion: 0,
        generatedAt: new Date().toISOString(),
        lifecycle: 'starting',
        connections: Object.fromEntries(
          ['obs', 'twitch', 'groq', 'supabase'].map((provider) => [
            provider,
            {
              provider,
              phase: 'idle',
              attempt: 0,
              changedAt: new Date(0).toISOString(),
              reasonCode: 'NOT_STARTED',
              correlationId: '00000000-0000-4000-8000-000000000000',
            },
          ]),
        ),
      },
    };
  }

  public on(channel: string, listener: Listener): void {
    const listeners = this.listeners.get(channel) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(channel, listeners);
  }

  public removeListener(channel: string, listener: Listener): void {
    this.listeners.get(channel)?.delete(listener);
  }

  public listenerCount(channel: string): number {
    return this.listeners.get(channel)?.size ?? 0;
  }
}

describe('preload capability API', () => {
  it('validates request/response envelopes without exposing raw IPC', async () => {
    const api = createRendererApi(new FakeRendererIpc());
    expect(Object.keys(api)).toEqual([
      'getBootstrap',
      'getSnapshot',
      'onStateChanged',
      'commandPtt',
      'setPttAccelerator',
      'listAudioDevices',
      'selectAudioDevice',
      'onPttChanged',
      'getAgentInteraction',
      'decideAgentConfirmation',
      'onAgentInteractionChanged',
      'getObsSnapshot',
      'reconnectObs',
      'getCloudAuth',
      'signInCloud',
      'signUpCloud',
      'resendCloudConfirmation',
      'signOutCloud',
      'requestCloudAccountDeletion',
      'getTwitchProjection',
      'connectTwitch',
      'disconnectTwitch',
      'reconnectTwitch',
      'onTwitchActivity',
    ]);
    await expect(api.getBootstrap()).resolves.toMatchObject({ app: { name: 'ObscurPilot' } });
    await expect(api.getSnapshot()).resolves.toMatchObject({ snapshotVersion: 0 });
    expect(Object.isFrozen(api)).toBe(true);
  });

  it('does not leak listeners over 100 subscribe/unsubscribe cycles', () => {
    const ipc = new FakeRendererIpc();
    const api = createRendererApi(ipc);
    for (let index = 0; index < 100; index += 1) {
      const unsubscribe = api.onStateChanged(() => undefined);
      expect(ipc.listenerCount(IPC_CHANNELS.stateChanged)).toBe(1);
      unsubscribe();
      unsubscribe();
      expect(ipc.listenerCount(IPC_CHANNELS.stateChanged)).toBe(0);
    }
  });

  it('does not leak Twitch activity listeners', () => {
    const ipc = new FakeRendererIpc();
    const api = createRendererApi(ipc);
    const unsubscribe = api.onTwitchActivity(() => undefined);
    expect(ipc.listenerCount(IPC_CHANNELS.twitchActivity)).toBe(1);
    unsubscribe();
    unsubscribe();
    expect(ipc.listenerCount(IPC_CHANNELS.twitchActivity)).toBe(0);
  });
});
