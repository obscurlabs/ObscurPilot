import {
  GetBootstrapPayloadSchema,
  BootstrapProjectionSchema,
} from '@obscurpilot/contracts/bootstrap';
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
