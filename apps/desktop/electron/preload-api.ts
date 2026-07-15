import {
  GetBootstrapPayloadSchema,
  BootstrapProjectionSchema,
} from '@obscurpilot/contracts/bootstrap';
import {
  AudioDeviceListSchema,
  EmptyPayloadSchema,
  OperationAcceptedSchema,
  PttChangedEventSchema,
  PttCommandPayloadSchema,
  SelectAudioDevicePayloadSchema,
  SetPttAcceleratorPayloadSchema,
  type PttProjection,
} from '@obscurpilot/contracts/audio';
import {
  createResultEnvelopeSchema,
  IPC_CHANNELS,
  IPC_PROTOCOL_VERSION,
} from '@obscurpilot/contracts/ipc';
import {
  AppSnapshotSchema,
  GetSnapshotPayloadSchema,
  StateChangedEventSchema,
  type StateChanged,
} from '@obscurpilot/contracts/state';
import type { ObscurPilotRendererApi } from '@obscurpilot/contracts/renderer-api';
import {
  GetObsSnapshotPayloadSchema,
  ObsProjectionSchema,
  ReconnectObsPayloadSchema,
} from '@obscurpilot/contracts/obs';
import type { ZodType } from 'zod';

interface RendererIpc {
  invoke(channel: string, request: unknown): Promise<unknown>;
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void;
  removeListener(channel: string, listener: (event: unknown, payload: unknown) => void): void;
}

export class RendererIpcError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly correlationId: string,
  ) {
    super(message);
    this.name = 'RendererIpcError';
  }
}

export function createRendererApi(ipc: RendererIpc): Readonly<ObscurPilotRendererApi> {
  return Object.freeze({
    getBootstrap: () =>
      invoke(
        ipc,
        IPC_CHANNELS.getBootstrap,
        GetBootstrapPayloadSchema.parse({}),
        BootstrapProjectionSchema,
      ),
    getSnapshot: (afterVersion?: number) =>
      invoke(
        ipc,
        IPC_CHANNELS.getSnapshot,
        GetSnapshotPayloadSchema.parse(afterVersion === undefined ? {} : { afterVersion }),
        AppSnapshotSchema,
      ),
    onStateChanged: (listener: (event: Readonly<StateChanged>) => void) => {
      let subscribed = true;
      const wrapped = (_event: unknown, rawEnvelope: unknown) => {
        const envelope = StateChangedEventSchema.parse(rawEnvelope);
        listener(envelope.payload);
      };
      ipc.on(IPC_CHANNELS.stateChanged, wrapped);
      return () => {
        if (!subscribed) return;
        subscribed = false;
        ipc.removeListener(IPC_CHANNELS.stateChanged, wrapped);
      };
    },
    commandPtt: (action: 'press' | 'release' | 'cancel') =>
      invoke(
        ipc,
        IPC_CHANNELS.pttCommand,
        PttCommandPayloadSchema.parse({ action }),
        OperationAcceptedSchema,
      ),
    setPttAccelerator: (accelerator: string) =>
      invoke(
        ipc,
        IPC_CHANNELS.pttSetAccelerator,
        SetPttAcceleratorPayloadSchema.parse({ accelerator }),
        OperationAcceptedSchema,
      ),
    listAudioDevices: () =>
      invoke(
        ipc,
        IPC_CHANNELS.audioListDevices,
        EmptyPayloadSchema.parse({}),
        AudioDeviceListSchema,
      ),
    selectAudioDevice: (deviceId: string) =>
      invoke(
        ipc,
        IPC_CHANNELS.audioSelectDevice,
        SelectAudioDevicePayloadSchema.parse({ deviceId }),
        OperationAcceptedSchema,
      ),
    onPttChanged: (listener: (projection: Readonly<PttProjection>) => void) => {
      let subscribed = true;
      const wrapped = (_event: unknown, rawEnvelope: unknown) => {
        const envelope = PttChangedEventSchema.parse(rawEnvelope);
        listener(envelope.payload);
      };
      ipc.on(IPC_CHANNELS.pttChanged, wrapped);
      return () => {
        if (!subscribed) return;
        subscribed = false;
        ipc.removeListener(IPC_CHANNELS.pttChanged, wrapped);
      };
    },
    getObsSnapshot: () =>
      invoke(
        ipc,
        IPC_CHANNELS.obsGetSnapshot,
        GetObsSnapshotPayloadSchema.parse({}),
        ObsProjectionSchema,
      ),
    reconnectObs: () =>
      invoke(
        ipc,
        IPC_CHANNELS.obsReconnect,
        ReconnectObsPayloadSchema.parse({}),
        OperationAcceptedSchema,
      ),
  });
}

async function invoke<Input, Output>(
  ipc: RendererIpc,
  channel: string,
  payload: Input,
  outputSchema: ZodType<Output>,
): Promise<Output> {
  const requestId = crypto.randomUUID();
  const rawResult = await ipc.invoke(channel, {
    protocolVersion: IPC_PROTOCOL_VERSION,
    requestId,
    sentAt: new Date().toISOString(),
    payload,
  });
  const result = createResultEnvelopeSchema(outputSchema).parse(rawResult);
  if (result.requestId !== requestId) {
    throw new RendererIpcError(
      'CONFLICT',
      'IPC response request ID did not match',
      false,
      crypto.randomUUID(),
    );
  }
  if (!result.ok) {
    throw new RendererIpcError(
      result.error.code,
      result.error.message,
      result.error.retryable,
      result.error.correlationId,
    );
  }
  return outputSchema.parse(result.data);
}
