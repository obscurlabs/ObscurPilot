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
import {
  CloudAuthProjectionSchema,
  CloudConfirmationPayloadSchema,
  CloudCredentialPayloadSchema,
  CloudGetAuthPayloadSchema,
  CloudSignOutPayloadSchema,
  type CloudCredentialPayload,
  type CloudConfirmationPayload,
} from '@obscurpilot/contracts/cloud';
import {
  TwitchActivityEventSchema,
  TwitchEmptyPayloadSchema,
  TwitchOperationAcceptedSchema,
  TwitchProjectionSchema,
  type TwitchActivity,
} from '@obscurpilot/contracts/twitch';
import {
  AgentConfirmationDecisionPayloadSchema,
  AgentEmptyPayloadSchema,
  AgentInteractionChangedEventSchema,
  AgentInteractionProjectionSchema,
  type AgentConfirmationDecisionPayload,
  type AgentInteractionProjection,
} from '@obscurpilot/contracts/agent';

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
    getAgentInteraction: () =>
      invoke(
        ipc,
        IPC_CHANNELS.agentGetProjection,
        AgentEmptyPayloadSchema.parse({}),
        AgentInteractionProjectionSchema,
      ),
    decideAgentConfirmation: (payload: AgentConfirmationDecisionPayload) =>
      invoke(
        ipc,
        IPC_CHANNELS.agentConfirmationDecision,
        AgentConfirmationDecisionPayloadSchema.parse(payload),
        AgentInteractionProjectionSchema,
      ),
    onAgentInteractionChanged: (
      listener: (projection: Readonly<AgentInteractionProjection>) => void,
    ) => {
      let subscribed = true;
      const wrapped = (_event: unknown, rawEnvelope: unknown) => {
        const envelope = AgentInteractionChangedEventSchema.parse(rawEnvelope);
        listener(envelope.payload);
      };
      ipc.on(IPC_CHANNELS.agentInteractionChanged, wrapped);
      return () => {
        if (!subscribed) return;
        subscribed = false;
        ipc.removeListener(IPC_CHANNELS.agentInteractionChanged, wrapped);
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
    getCloudAuth: () =>
      invoke(
        ipc,
        IPC_CHANNELS.cloudGetAuth,
        CloudGetAuthPayloadSchema.parse({}),
        CloudAuthProjectionSchema,
      ),
    signInCloud: (credentials: CloudCredentialPayload) =>
      invoke(
        ipc,
        IPC_CHANNELS.cloudSignIn,
        CloudCredentialPayloadSchema.parse(credentials),
        CloudAuthProjectionSchema,
      ),
    signUpCloud: (credentials: CloudCredentialPayload) =>
      invoke(
        ipc,
        IPC_CHANNELS.cloudSignUp,
        CloudCredentialPayloadSchema.parse(credentials),
        CloudAuthProjectionSchema,
      ),
    resendCloudConfirmation: (payload: CloudConfirmationPayload) =>
      invoke(
        ipc,
        IPC_CHANNELS.cloudResendConfirmation,
        CloudConfirmationPayloadSchema.parse(payload),
        OperationAcceptedSchema,
      ),
    signOutCloud: () =>
      invoke(
        ipc,
        IPC_CHANNELS.cloudSignOut,
        CloudSignOutPayloadSchema.parse({ scope: 'local' }),
        CloudAuthProjectionSchema,
      ),
    requestCloudAccountDeletion: () =>
      invoke(
        ipc,
        IPC_CHANNELS.cloudRequestDeletion,
        CloudGetAuthPayloadSchema.parse({}),
        OperationAcceptedSchema,
      ),
    getTwitchProjection: () =>
      invoke(
        ipc,
        IPC_CHANNELS.twitchGetProjection,
        TwitchEmptyPayloadSchema.parse({}),
        TwitchProjectionSchema,
      ),
    connectTwitch: () =>
      invoke(
        ipc,
        IPC_CHANNELS.twitchConnect,
        TwitchEmptyPayloadSchema.parse({}),
        TwitchOperationAcceptedSchema,
      ),
    disconnectTwitch: () =>
      invoke(
        ipc,
        IPC_CHANNELS.twitchDisconnect,
        TwitchEmptyPayloadSchema.parse({}),
        TwitchProjectionSchema,
      ),
    reconnectTwitch: () =>
      invoke(
        ipc,
        IPC_CHANNELS.twitchReconnect,
        TwitchEmptyPayloadSchema.parse({}),
        TwitchOperationAcceptedSchema,
      ),
    onTwitchActivity: (listener: (activity: Readonly<TwitchActivity>) => void) => {
      let subscribed = true;
      const wrapped = (_event: unknown, rawEnvelope: unknown) => {
        const envelope = TwitchActivityEventSchema.parse(rawEnvelope);
        listener(envelope.payload);
      };
      ipc.on(IPC_CHANNELS.twitchActivity, wrapped);
      return () => {
        if (!subscribed) return;
        subscribed = false;
        ipc.removeListener(IPC_CHANNELS.twitchActivity, wrapped);
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
