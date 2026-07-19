import type { ConnectionProjection } from '@obscurpilot/contracts/state';
import { ObsSnapshotSchema, type ObsSnapshot } from '@obscurpilot/contracts/obs';
import type { ToolDefinition } from '@obscurpilot/domain/tool-registry';
import { authorizeTool, type ToolGrant, type ToolRisk } from '@obscurpilot/domain/policy';
import OBSWebSocket, { EventSubscription, OBSWebSocketError } from 'obs-websocket-js';
import { z } from 'zod';

export const OBS_ADAPTER_PACKAGE = '@obscurpilot/adapters-obs' as const;

const SNAPSHOT_INVALIDATING_EVENTS = [
  'CurrentSceneCollectionChanging',
  'CurrentSceneCollectionChanged',
  'SceneCollectionListChanged',
  'SceneCreated',
  'SceneRemoved',
  'SceneNameChanged',
  'SceneListChanged',
  'CurrentProgramSceneChanged',
  'CurrentPreviewSceneChanged',
  'InputCreated',
  'InputRemoved',
  'InputNameChanged',
  'InputSettingsChanged',
  'StreamStateChanged',
  'RecordStateChanged',
  'StudioModeStateChanged',
] as const;

export type ObsCommandRequest =
  | { readonly requestType: 'CreateScene'; readonly requestData: { sceneName: string } }
  | {
      readonly requestType: 'CreateInput';
      readonly requestData: {
        sceneName: string;
        inputName: string;
        inputKind: string;
        inputSettings: Readonly<Record<string, unknown>>;
        sceneItemEnabled: boolean;
      };
    }
  | { readonly requestType: 'SetCurrentProgramScene'; readonly requestData: { sceneName: string } }
  | {
      readonly requestType: 'SetInputMute';
      readonly requestData: { inputName: string; inputMuted: boolean };
    }
  | {
      readonly requestType: 'SetInputSettings';
      readonly requestData: {
        inputName: string;
        inputSettings: { text: string };
        overlay: true;
      };
    }
  | { readonly requestType: 'StartStream'; readonly requestData?: never }
  | { readonly requestType: 'StopStream'; readonly requestData?: never }
  | { readonly requestType: 'StartRecord'; readonly requestData?: never }
  | { readonly requestType: 'StopRecord'; readonly requestData?: never };

export interface ObsCommandEnvelope {
  readonly commandId: string;
  readonly expectedSnapshotVersion: number;
  readonly expectedGeneration: number;
  readonly command: ObsCommandRequest;
  readonly timeoutMs?: number;
}

export class ObsBridgeError extends Error {
  public constructor(
    public readonly code:
      | 'AUTH_REQUIRED'
      | 'VERSION_MISMATCH'
      | 'PRECONDITION_FAILED'
      | 'UPSTREAM_UNAVAILABLE'
      | 'TIMEOUT'
      | 'UNCERTAIN',
    message: string,
  ) {
    super(message);
    this.name = 'ObsBridgeError';
  }
}

export interface ObsTransport {
  connect(
    url: string,
    password: string | undefined,
  ): Promise<{
    obsWebSocketVersion: string;
    rpcVersion: number;
    negotiatedRpcVersion: number;
  }>;
  call<T extends keyof ObsCallMap>(requestType: T, requestData?: unknown): Promise<ObsCallMap[T]>;
  onInvalidated(listener: () => void): () => void;
  onDisconnected(listener: (error: unknown) => void): () => void;
  disconnect(): Promise<void>;
}

interface ObsVersionResponse {
  readonly obsVersion: string;
  readonly obsWebSocketVersion: string;
  readonly rpcVersion: number;
}

interface ObsCallMap {
  readonly GetVersion: ObsVersionResponse;
  readonly GetSceneCollectionList: {
    readonly currentSceneCollectionName: string;
    readonly sceneCollections: string[];
  };
  readonly GetSceneList: {
    readonly currentProgramSceneName: string | null;
    readonly currentPreviewSceneName: string | null;
    readonly scenes: ReadonlyArray<Record<string, unknown>>;
  };
  readonly GetInputList: { readonly inputs: ReadonlyArray<Record<string, unknown>> };
  readonly GetStreamStatus: { readonly outputActive: boolean };
  readonly GetRecordStatus: { readonly outputActive: boolean };
  readonly GetStudioModeEnabled: { readonly studioModeEnabled: boolean };
  readonly SetCurrentProgramScene: unknown;
  readonly CreateScene: unknown;
  readonly CreateInput: unknown;
  readonly SetInputMute: unknown;
  readonly SetInputSettings: unknown;
  readonly StartStream: unknown;
  readonly StopStream: unknown;
  readonly StartRecord: unknown;
  readonly StopRecord: unknown;
}

class ObsSdkTransport implements ObsTransport {
  private readonly client = new OBSWebSocket();

  public connect(url: string, password: string | undefined) {
    return this.client.connect(url, password, {
      rpcVersion: 1,
      eventSubscriptions:
        EventSubscription.General |
        EventSubscription.Config |
        EventSubscription.Scenes |
        EventSubscription.Inputs |
        EventSubscription.Outputs,
    });
  }

  public call<T extends keyof ObsCallMap>(
    requestType: T,
    requestData?: unknown,
  ): Promise<ObsCallMap[T]> {
    return this.client.call(requestType, requestData as never) as Promise<ObsCallMap[T]>;
  }

  public onInvalidated(listener: () => void): () => void {
    for (const event of SNAPSHOT_INVALIDATING_EVENTS) this.client.on(event, listener);
    return () => {
      for (const event of SNAPSHOT_INVALIDATING_EVENTS) this.client.off(event, listener);
    };
  }

  public onDisconnected(listener: (error: unknown) => void): () => void {
    this.client.on('ConnectionClosed', listener);
    this.client.on('ConnectionError', listener);
    return () => {
      this.client.off('ConnectionClosed', listener);
      this.client.off('ConnectionError', listener);
    };
  }

  public disconnect(): Promise<void> {
    return this.client.disconnect();
  }
}

export interface ObsBridgeOptions {
  readonly url: string;
  readonly password?: string;
  readonly transport?: ObsTransport;
  readonly onConnection: (projection: ConnectionProjection) => void;
  readonly onSnapshot?: (snapshot: ObsSnapshot) => void;
  readonly now?: () => number;
  readonly id?: () => string;
  readonly random?: () => number;
}

export class ObsBridge {
  private readonly transport: ObsTransport;
  private readonly now: () => number;
  private readonly id: () => string;
  private readonly random: () => number;
  private snapshotValue: ObsSnapshot | undefined;
  private snapshotVersion = 0;
  private generation = 0;
  private attempt = 0;
  private stopped = true;
  private synchronizing = false;
  private dirtyDuringSync = false;
  private stable = false;
  private password: string | undefined;
  private reconfiguring = false;
  private resyncTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly completed = new Map<string, unknown>();
  private readonly uncertain = new Set<string>();
  private readonly removeInvalidated: () => void;
  private readonly removeDisconnected: () => void;

  public constructor(private readonly options: ObsBridgeOptions) {
    this.transport = options.transport ?? new ObsSdkTransport();
    this.now = options.now ?? Date.now;
    this.id = options.id ?? (() => crypto.randomUUID());
    this.random = options.random ?? Math.random;
    this.password = options.password;
    this.removeInvalidated = this.transport.onInvalidated(() => this.invalidate());
    this.removeDisconnected = this.transport.onDisconnected(() => this.handleDisconnect());
  }

  public start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    void this.connectAndSynchronize();
  }

  public async reconnect(): Promise<void> {
    if (this.stopped) return;
    clearTimeout(this.reconnectTimer);
    await this.transport.disconnect().catch(() => undefined);
    this.handleDisconnect();
  }

  public async reconfigurePassword(password: string | undefined): Promise<ObsSnapshot> {
    clearTimeout(this.resyncTimer);
    clearTimeout(this.reconnectTimer);
    this.resyncTimer = undefined;
    this.reconnectTimer = undefined;
    this.reconfiguring = true;
    this.generation += 1;
    this.stable = false;
    this.snapshotValue = undefined;
    try {
      await this.transport.disconnect().catch(() => undefined);
    } finally {
      this.reconfiguring = false;
    }
    this.password = password;
    this.stopped = false;
    this.attempt = 0;
    await this.connectAndSynchronize(false);
    const snapshot = this.snapshotValue;
    if (snapshot === undefined) {
      throw new ObsBridgeError('UPSTREAM_UNAVAILABLE', 'OBS pairing did not produce a snapshot');
    }
    return snapshot;
  }

  public snapshot(): ObsSnapshot | undefined {
    return this.snapshotValue;
  }

  public async execute(envelope: ObsCommandEnvelope, signal?: AbortSignal): Promise<unknown> {
    if (this.uncertain.has(envelope.commandId)) {
      throw new ObsBridgeError('UNCERTAIN', 'Command outcome is uncertain and cannot be replayed');
    }
    if (this.completed.has(envelope.commandId)) return this.completed.get(envelope.commandId);
    const snapshot = this.snapshotValue;
    if (
      snapshot === undefined ||
      !this.stable ||
      snapshot.snapshotVersion !== envelope.expectedSnapshotVersion ||
      snapshot.generation !== envelope.expectedGeneration
    ) {
      throw new ObsBridgeError(
        'PRECONDITION_FAILED',
        'OBS state changed; refresh before executing',
      );
    }
    if (signal?.aborted) throw new ObsBridgeError('UPSTREAM_UNAVAILABLE', 'Command was cancelled');
    const timeoutMs = Math.max(100, Math.min(envelope.timeoutMs ?? 2_000, 10_000));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new ObsBridgeError('TIMEOUT', 'OBS command timed out')),
        timeoutMs,
      );
    });
    try {
      const command = envelope.command;
      const call =
        command.requestData === undefined
          ? this.transport.call(command.requestType)
          : this.transport.call(command.requestType, command.requestData);
      const result = await Promise.race([call, timeout]);
      this.completed.set(envelope.commandId, result);
      this.invalidate();
      return result;
    } catch (error: unknown) {
      if (
        (error instanceof ObsBridgeError && error.code === 'TIMEOUT') ||
        this.snapshotValue?.generation !== envelope.expectedGeneration
      ) {
        this.uncertain.add(envelope.commandId);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  public async dispose(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.resyncTimer);
    clearTimeout(this.reconnectTimer);
    this.removeInvalidated();
    this.removeDisconnected();
    await this.transport.disconnect().catch(() => undefined);
    this.emit('stopped', this.attempt, 'STOPPED');
  }

  private async connectAndSynchronize(recover = true): Promise<void> {
    if (this.stopped) return;
    const generation = ++this.generation;
    this.stable = false;
    this.snapshotValue = undefined;
    this.emit(this.attempt === 0 ? 'connecting' : 'reconnecting', this.attempt, 'CONNECTING');
    try {
      const handshake = await this.transport.connect(this.options.url, this.password);
      if (handshake.rpcVersion !== 1 || handshake.negotiatedRpcVersion !== 1) {
        throw new ObsBridgeError('VERSION_MISMATCH', 'OBS WebSocket RPC version 1 is required');
      }
      this.emit('authenticating', this.attempt, 'HANDSHAKE_VALIDATED');
      const version = await this.transport.call('GetVersion');
      const major = Number.parseInt(version.obsVersion.split('.')[0] ?? '', 10);
      if (!Number.isFinite(major) || major < 30 || version.rpcVersion !== 1) {
        throw new ObsBridgeError('VERSION_MISMATCH', 'OBS 30+ with WebSocket RPC 1 is required');
      }
      this.emit('synchronizing', this.attempt, 'BUILDING_SNAPSHOT');
      await this.synchronize(generation, version);
      this.attempt = 0;
      this.emit('ready', 0, 'SYNCHRONIZED');
    } catch (error: unknown) {
      if (this.stopped || generation !== this.generation) return;
      await this.transport.disconnect().catch(() => undefined);
      if (isAuthError(error)) {
        this.emit('auth_required', this.attempt, 'AUTH_REQUIRED');
        if (!recover) {
          throw new ObsBridgeError('AUTH_REQUIRED', 'OBS rejected the WebSocket password');
        }
        return;
      }
      if (error instanceof ObsBridgeError && error.code === 'VERSION_MISMATCH') {
        this.emit('degraded', this.attempt, 'VERSION_MISMATCH');
        if (!recover) throw error;
        return;
      }
      this.emit('backoff', this.attempt, 'RETRYABLE_FAILURE');
      if (!recover) {
        throw new ObsBridgeError('UPSTREAM_UNAVAILABLE', 'OBS is unavailable on the loopback port');
      }
      this.scheduleReconnect();
    }
  }

  private async synchronize(
    generation: number,
    version: ObsVersionResponse,
    reconciliationPass = 0,
  ): Promise<void> {
    this.synchronizing = true;
    this.dirtyDuringSync = false;
    try {
      const [collections, sceneList, inputList, stream, record, studio] = await Promise.all([
        this.transport.call('GetSceneCollectionList'),
        this.transport.call('GetSceneList'),
        this.transport.call('GetInputList'),
        this.transport.call('GetStreamStatus'),
        this.transport.call('GetRecordStatus'),
        this.transport.call('GetStudioModeEnabled'),
      ]);
      if (generation !== this.generation || this.stopped) return;
      const snapshot = ObsSnapshotSchema.parse({
        snapshotVersion: ++this.snapshotVersion,
        generation,
        capturedAt: new Date(this.now()).toISOString(),
        obsVersion: version.obsVersion,
        webSocketVersion: version.obsWebSocketVersion,
        rpcVersion: version.rpcVersion,
        sceneCollectionName: collections.currentSceneCollectionName,
        currentProgramSceneName:
          typeof sceneList.currentProgramSceneName === 'string'
            ? sceneList.currentProgramSceneName
            : '',
        currentPreviewSceneName: studio.studioModeEnabled
          ? sceneList.currentPreviewSceneName
          : null,
        studioModeEnabled: studio.studioModeEnabled,
        streamActive: stream.outputActive,
        recordActive: record.outputActive,
        scenes: sceneList.scenes.map((scene, index) => ({
          name: typeof scene.sceneName === 'string' ? scene.sceneName : 'Unknown scene',
          index:
            typeof scene.sceneIndex === 'number' && scene.sceneIndex >= 0
              ? scene.sceneIndex
              : index,
        })),
        inputs: inputList.inputs.map((input) => ({
          name: typeof input.inputName === 'string' ? input.inputName : 'Unknown input',
          kind: typeof input.inputKind === 'string' ? input.inputKind : 'unknown',
        })),
      });
      this.snapshotValue = snapshot;
      this.options.onSnapshot?.(snapshot);
    } finally {
      this.synchronizing = false;
    }
    if (this.dirtyDuringSync && reconciliationPass < 2) {
      this.dirtyDuringSync = false;
      const freshVersion = await this.transport.call('GetVersion');
      await this.synchronize(generation, freshVersion, reconciliationPass + 1);
    } else if (this.dirtyDuringSync) {
      this.dirtyDuringSync = false;
      this.invalidate();
    } else {
      this.stable = true;
    }
  }

  private invalidate(): void {
    if (this.stopped) return;
    this.stable = false;
    if (this.synchronizing) {
      this.dirtyDuringSync = true;
      return;
    }
    clearTimeout(this.resyncTimer);
    this.resyncTimer = setTimeout(() => {
      const generation = this.generation;
      void this.transport
        .call('GetVersion')
        .then((version) => this.synchronize(generation, version))
        .catch(() => this.handleDisconnect());
    }, 50);
  }

  private handleDisconnect(): void {
    if (this.stopped || this.reconfiguring) return;
    this.generation += 1;
    this.stable = false;
    this.snapshotValue = undefined;
    this.emit('reconnecting', this.attempt, 'CONNECTION_LOST');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== undefined) return;
    const capped = Math.min(30_000, 250 * 2 ** Math.min(this.attempt, 7));
    const delay = Math.floor(this.random() * capped);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connectAndSynchronize();
    }, delay);
  }

  private emit(phase: ConnectionProjection['phase'], attempt: number, reasonCode: string): void {
    this.options.onConnection({
      provider: 'obs',
      phase,
      attempt,
      changedAt: new Date(this.now()).toISOString(),
      reasonCode,
      correlationId: this.id(),
    });
  }
}

export function createObsSnapshotTool(
  bridge: ObsBridge,
): ToolDefinition<Record<string, never>, ObsSnapshot> {
  return {
    name: 'obs.read_snapshot',
    version: 1,
    risk: 'observe',
    modelName: 'obs_read_snapshot_v1',
    description: 'Read the current synchronized OBS production snapshot.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    parse: (input) => {
      if (typeof input !== 'object' || input === null || Object.keys(input).length !== 0) {
        throw new Error('obs.read_snapshot accepts an empty object');
      }
      return {};
    },
    authorize: async () => undefined,
    execute: async () => {
      const snapshot = bridge.snapshot();
      if (snapshot === undefined) {
        throw new ObsBridgeError('UPSTREAM_UNAVAILABLE', 'OBS is not synchronized');
      }
      return snapshot;
    },
  };
}

export interface ObsToolAuthorizationSource {
  readonly getGrants: () => readonly ToolGrant[];
  readonly now?: () => number;
}

export function createObsProductionTools(
  bridge: ObsBridge,
  authorization: ObsToolAuthorizationSource,
): ReadonlyArray<ToolDefinition<unknown, unknown>> {
  const now = authorization.now ?? Date.now;
  const authorize = (toolName: string, requiredScope: string, risk: ToolRisk, confirmed: boolean) =>
    authorizeTool(authorization.getGrants(), {
      now: now(),
      toolName,
      requiredScope,
      risk,
      confirmed,
    });
  const commandTool = <Input>(options: {
    readonly name: string;
    readonly modelName: string;
    readonly description: string;
    readonly scope: string;
    readonly risk: ToolRisk;
    readonly parameters: Readonly<Record<string, unknown>>;
    readonly parse: (input: unknown) => Input;
    readonly toCommand: (input: Input) => ObsCommandRequest;
  }): ToolDefinition<Input, { readonly accepted: true }> => ({
    name: options.name,
    version: 1,
    risk: options.risk,
    modelName: options.modelName,
    description: options.description,
    parameters: options.parameters,
    parse: options.parse,
    authorize: async (context) =>
      authorize(options.name, options.scope, options.risk, context.confirmed === true),
    execute: async (context, input) => {
      if (
        context.expectedObsSnapshotVersion === undefined ||
        context.expectedObsGeneration === undefined
      ) {
        throw new ObsBridgeError('PRECONDITION_FAILED', 'OBS context precondition is absent');
      }
      await bridge.execute(
        {
          commandId: context.commandId ?? context.correlationId,
          expectedSnapshotVersion: context.expectedObsSnapshotVersion,
          expectedGeneration: context.expectedObsGeneration,
          command: options.toCommand(input),
        },
        context.signal,
      );
      return { accepted: true };
    },
  });

  const emptySchema = z.object({}).strict();
  const readTool: ToolDefinition<Record<string, never>, ObsSnapshot> = {
    ...createObsSnapshotTool(bridge),
    authorize: async (context) =>
      authorize('obs.read_snapshot', 'obs:read', 'observe', context.confirmed === true),
  };
  return [
    readTool,
    commandTool({
      name: 'obs.set_program_scene',
      modelName: 'obs_set_program_scene_v1',
      description: 'Change the current OBS program scene to an exact synchronized scene name.',
      scope: 'obs:scene:write',
      risk: 'reversible',
      parameters: {
        type: 'object',
        properties: { sceneName: { type: 'string', minLength: 1, maxLength: 512 } },
        required: ['sceneName'],
        additionalProperties: false,
      },
      parse: (input) =>
        z
          .object({ sceneName: z.string().min(1).max(512) })
          .strict()
          .parse(input),
      toCommand: (input) => ({
        requestType: 'SetCurrentProgramScene',
        requestData: { sceneName: input.sceneName },
      }),
    }),
    commandTool({
      name: 'obs.set_input_mute',
      modelName: 'obs_set_input_mute_v1',
      description: 'Set one exact synchronized OBS input to muted or unmuted.',
      scope: 'obs:audio:write',
      risk: 'reversible',
      parameters: {
        type: 'object',
        properties: {
          inputName: { type: 'string', minLength: 1, maxLength: 512 },
          inputMuted: { type: 'boolean' },
        },
        required: ['inputName', 'inputMuted'],
        additionalProperties: false,
      },
      parse: (input) =>
        z
          .object({ inputName: z.string().min(1).max(512), inputMuted: z.boolean() })
          .strict()
          .parse(input),
      toCommand: (input) => ({
        requestType: 'SetInputMute',
        requestData: { inputName: input.inputName, inputMuted: input.inputMuted },
      }),
    }),
    ...(
      [
        [
          'obs.start_stream',
          'obs_start_stream_v1',
          'Start OBS streaming output.',
          'obs:stream:write',
          'StartStream',
        ],
        [
          'obs.stop_stream',
          'obs_stop_stream_v1',
          'Stop OBS streaming output.',
          'obs:stream:write',
          'StopStream',
        ],
        [
          'obs.start_record',
          'obs_start_record_v1',
          'Start OBS recording output.',
          'obs:record:write',
          'StartRecord',
        ],
        [
          'obs.stop_record',
          'obs_stop_record_v1',
          'Stop OBS recording output.',
          'obs:record:write',
          'StopRecord',
        ],
      ] as const
    ).map(([name, modelName, description, scope, requestType]) =>
      commandTool({
        name,
        modelName,
        description,
        scope,
        risk: 'confirm',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        parse: (input) => emptySchema.parse(input),
        toCommand: () => ({ requestType }),
      }),
    ),
  ];
}

function isAuthError(error: unknown): boolean {
  if (error instanceof OBSWebSocketError && error.code === 4009) return true;
  return error instanceof Error && /auth|password/i.test(error.message);
}
