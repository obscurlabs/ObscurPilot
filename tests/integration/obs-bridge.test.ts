import { ObsBridge, ObsBridgeError, type ObsTransport } from '@obscurpilot/adapters-obs/boundary';
import type { ConnectionProjection } from '@obscurpilot/contracts/state';
import { describe, expect, it, vi } from 'vitest';

const ID = '20000000-0000-4000-8000-000000000001';

function createTransport(overrides: Partial<ObsTransport> = {}) {
  let invalidated: (() => void) | undefined;
  let disconnected: ((error: unknown) => void) | undefined;
  const calls: string[] = [];
  const responses: Record<string, unknown> = {
    GetVersion: {
      obsVersion: '31.0.0',
      obsWebSocketVersion: '5.6.0',
      rpcVersion: 1,
    },
    GetSceneCollectionList: {
      currentSceneCollectionName: 'Test collection',
      sceneCollections: ['Test collection'],
    },
    GetSceneList: {
      currentProgramSceneName: 'Program',
      currentPreviewSceneName: null,
      scenes: [{ sceneName: 'Program', sceneIndex: 0 }],
    },
    GetInputList: { inputs: [{ inputName: 'Mic', inputKind: 'wasapi_input_capture' }] },
    GetStreamStatus: { outputActive: false },
    GetRecordStatus: { outputActive: false },
    GetStudioModeEnabled: { studioModeEnabled: false },
    SetCurrentProgramScene: {},
  };
  const base = {
    connect: vi.fn(async () => ({
      obsWebSocketVersion: '5.6.0',
      rpcVersion: 1,
      negotiatedRpcVersion: 1,
    })),
    call: vi.fn(async (requestType: string) => {
      calls.push(requestType);
      return responses[requestType];
    }),
    onInvalidated: (listener: () => void) => {
      invalidated = listener;
      return () => {
        invalidated = undefined;
      };
    },
    onDisconnected: (listener: (error: unknown) => void) => {
      disconnected = listener;
      return () => {
        disconnected = undefined;
      };
    },
    disconnect: vi.fn(async () => undefined),
  };
  return {
    transport: { ...base, ...overrides } as unknown as ObsTransport,
    calls,
    invalidate: () => invalidated?.(),
    disconnect: () => disconnected?.(new Error('socket lost')),
  };
}

describe('OBS authoritative bridge', () => {
  it('validates handshake and builds a normalized authoritative snapshot', async () => {
    const fake = createTransport();
    const phases: ConnectionProjection[] = [];
    const bridge = new ObsBridge({
      url: 'ws://127.0.0.1:4455',
      transport: fake.transport,
      onConnection: (phase) => phases.push(phase),
      id: () => ID,
      random: () => 0,
    });
    bridge.start();
    await vi.waitFor(() => expect(bridge.snapshot()?.currentProgramSceneName).toBe('Program'));
    expect(phases.at(-1)?.phase).toBe('ready');
    expect(bridge.snapshot()).toMatchObject({
      obsVersion: '31.0.0',
      sceneCollectionName: 'Test collection',
      scenes: [{ name: 'Program', index: 0 }],
      inputs: [{ name: 'Mic', kind: 'wasapi_input_capture' }],
    });
    const initialVersion = bridge.snapshot()!.snapshotVersion;
    fake.invalidate();
    await vi.waitFor(() =>
      expect(bridge.snapshot()!.snapshotVersion).toBeGreaterThan(initialVersion),
    );
    await bridge.dispose();
  });

  it('fails closed for authentication and protocol/version mismatch', async () => {
    const auth = createTransport({
      connect: async () => {
        throw new Error('authentication password rejected');
      },
    });
    const authPhases: string[] = [];
    const authBridge = new ObsBridge({
      url: 'ws://127.0.0.1:4455',
      transport: auth.transport,
      onConnection: (phase) => authPhases.push(phase.phase),
      id: () => ID,
    });
    authBridge.start();
    await vi.waitFor(() => expect(authPhases.at(-1)).toBe('auth_required'));
    await authBridge.dispose();

    const mismatch = createTransport({
      connect: async () => ({
        obsWebSocketVersion: '5.6.0',
        rpcVersion: 2,
        negotiatedRpcVersion: 2,
      }),
    });
    const mismatchPhases: string[] = [];
    const mismatchBridge = new ObsBridge({
      url: 'ws://127.0.0.1:4455',
      transport: mismatch.transport,
      onConnection: (phase) => mismatchPhases.push(phase.phase),
      id: () => ID,
    });
    mismatchBridge.start();
    await vi.waitFor(() => expect(mismatchPhases.at(-1)).toBe('degraded'));
    await mismatchBridge.dispose();
  });

  it('enforces state preconditions, deduplicates success, and never replays uncertainty', async () => {
    const fake = createTransport();
    const bridge = new ObsBridge({
      url: 'ws://127.0.0.1:4455',
      transport: fake.transport,
      onConnection: () => undefined,
      id: () => ID,
    });
    bridge.start();
    await vi.waitFor(() => expect(bridge.snapshot()).toBeDefined());
    const snapshot = bridge.snapshot()!;
    const envelope = {
      commandId: ID,
      expectedSnapshotVersion: snapshot.snapshotVersion,
      expectedGeneration: snapshot.generation,
      command: {
        requestType: 'SetCurrentProgramScene' as const,
        requestData: { sceneName: 'Program' },
      },
    };
    await bridge.execute(envelope);
    await bridge.execute(envelope);
    expect(fake.calls.filter((call) => call === 'SetCurrentProgramScene')).toHaveLength(1);
    await expect(
      bridge.execute({ ...envelope, commandId: ID.replace(/1$/, '2'), expectedGeneration: 99 }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await bridge.dispose();
  });

  it('marks timed-out commands uncertain and rebuilds truth after disconnect', async () => {
    let releaseCommand: (() => void) | undefined;
    const fake = createTransport({
      call: async (requestType: string) => {
        if (requestType === 'SetCurrentProgramScene') {
          return new Promise((resolve) => {
            releaseCommand = () => resolve({} as never);
          });
        }
        return createTransport().transport.call(requestType as never);
      },
    });
    const bridge = new ObsBridge({
      url: 'ws://127.0.0.1:4455',
      transport: fake.transport,
      onConnection: () => undefined,
      id: () => ID,
      random: () => 0,
    });
    bridge.start();
    await vi.waitFor(() => expect(bridge.snapshot()).toBeDefined());
    const snapshot = bridge.snapshot()!;
    const envelope = {
      commandId: ID,
      expectedSnapshotVersion: snapshot.snapshotVersion,
      expectedGeneration: snapshot.generation,
      timeoutMs: 100,
      command: {
        requestType: 'SetCurrentProgramScene' as const,
        requestData: { sceneName: 'Program' },
      },
    };
    await expect(bridge.execute(envelope)).rejects.toBeInstanceOf(ObsBridgeError);
    await expect(bridge.execute(envelope)).rejects.toMatchObject({ code: 'UNCERTAIN' });
    releaseCommand?.();
    const oldGeneration = snapshot.generation;
    fake.disconnect();
    await vi.waitFor(() => expect(bridge.snapshot()?.generation).toBeGreaterThan(oldGeneration));
    await bridge.dispose();
  });
});
