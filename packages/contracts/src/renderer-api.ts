import type { BootstrapProjection } from './bootstrap.js';
import type { AudioDevice, PttCommandPayload, PttProjection } from './audio.js';
import type { ObsProjection } from './obs.js';
import type { AppSnapshot, StateChanged } from './state.js';
import type {
  CloudAuthProjection,
  CloudConfirmationPayload,
  CloudCredentialPayload,
} from './cloud.js';
import type { TwitchActivity, TwitchProjection } from './twitch.js';
import type { AgentConfirmationDecisionPayload, AgentInteractionProjection } from './agent.js';

export interface ObscurPilotRendererApi {
  getBootstrap(): Promise<BootstrapProjection>;
  getSnapshot(afterVersion?: number): Promise<AppSnapshot>;
  onStateChanged(listener: (event: Readonly<StateChanged>) => void): () => void;
  commandPtt(action: PttCommandPayload['action']): Promise<{ accepted: true }>;
  setPttAccelerator(accelerator: string): Promise<{ accepted: true }>;
  listAudioDevices(): Promise<{ devices: AudioDevice[] }>;
  selectAudioDevice(deviceId: string): Promise<{ accepted: true }>;
  onPttChanged(listener: (projection: Readonly<PttProjection>) => void): () => void;
  getAgentInteraction(): Promise<AgentInteractionProjection>;
  decideAgentConfirmation(
    payload: AgentConfirmationDecisionPayload,
  ): Promise<AgentInteractionProjection>;
  onAgentInteractionChanged(
    listener: (projection: Readonly<AgentInteractionProjection>) => void,
  ): () => void;
  getObsSnapshot(): Promise<ObsProjection>;
  reconnectObs(): Promise<{ accepted: true }>;
  getCloudAuth(): Promise<CloudAuthProjection>;
  signInCloud(credentials: CloudCredentialPayload): Promise<CloudAuthProjection>;
  signUpCloud(credentials: CloudCredentialPayload): Promise<CloudAuthProjection>;
  resendCloudConfirmation(payload: CloudConfirmationPayload): Promise<{ accepted: true }>;
  signOutCloud(): Promise<CloudAuthProjection>;
  requestCloudAccountDeletion(): Promise<{ accepted: true }>;
  getTwitchProjection(): Promise<TwitchProjection>;
  connectTwitch(): Promise<{ accepted: true }>;
  disconnectTwitch(): Promise<TwitchProjection>;
  reconnectTwitch(): Promise<{ accepted: true }>;
  onTwitchActivity(listener: (activity: Readonly<TwitchActivity>) => void): () => void;
}
