import type { BootstrapProjection } from './bootstrap.js';
import type {
  AudioDevice,
  HandsFreePreferences,
  HandsFreeProjection,
  PttCommandPayload,
  PttProjection,
  ShortcutBindings,
} from './audio.js';
import type { ObsProjection } from './obs.js';
import type { AppSnapshot, StateChanged } from './state.js';
import type {
  CloudAuthProjection,
  CloudConfirmationPayload,
  CloudCredentialPayload,
} from './cloud.js';
import type { TwitchActivity, TwitchCategory, TwitchProjection } from './twitch.js';
import type { AgentConfirmationDecisionPayload, AgentInteractionProjection } from './agent.js';
import type {
  ChatAnalysisProjection,
  ChatMessageProjection,
  LiveSessionDecisionPayload,
  LiveSessionMode,
  LiveSessionProfileV1,
  LiveSessionProfilesProjection,
  LiveSessionProjection,
  ModerationIntentV1,
  PilotOverlayPreferences,
} from './live-session.js';

export interface ObscurPilotRendererApi {
  getBootstrap(): Promise<BootstrapProjection>;
  getSnapshot(afterVersion?: number): Promise<AppSnapshot>;
  onStateChanged(listener: (event: Readonly<StateChanged>) => void): () => void;
  commandPtt(action: PttCommandPayload['action']): Promise<{ accepted: true }>;
  getShortcuts(): Promise<ShortcutBindings>;
  setShortcuts(bindings: ShortcutBindings): Promise<ShortcutBindings>;
  listAudioDevices(): Promise<{ devices: AudioDevice[] }>;
  selectAudioDevice(deviceId: string): Promise<{ accepted: true }>;
  onPttChanged(listener: (projection: Readonly<PttProjection>) => void): () => void;
  getHandsFreeProjection(): Promise<HandsFreeProjection>;
  setHandsFreePreferences(preferences: HandsFreePreferences): Promise<HandsFreeProjection>;
  finishHandsFreeSpeech(speechId: string): Promise<HandsFreeProjection>;
  onHandsFreeChanged(listener: (projection: Readonly<HandsFreeProjection>) => void): () => void;
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
  searchTwitchCategories(query: string): Promise<{ categories: TwitchCategory[] }>;
  onTwitchActivity(listener: (activity: Readonly<TwitchActivity>) => void): () => void;
  getLiveSession(): Promise<LiveSessionProjection>;
  getLiveSessionProfiles(): Promise<LiveSessionProfilesProjection>;
  prepareLiveSession(
    profile: LiveSessionProfileV1,
    mode: LiveSessionMode,
  ): Promise<LiveSessionProjection>;
  decideLiveSession(payload: LiveSessionDecisionPayload): Promise<LiveSessionProjection>;
  stopLiveSession(): Promise<LiveSessionProjection>;
  emergencyStopLiveSession(): Promise<LiveSessionProjection>;
  executeModeration(intent: ModerationIntentV1, confirmed: boolean): Promise<{ accepted: true }>;
  onLiveSessionChanged(listener: (projection: Readonly<LiveSessionProjection>) => void): () => void;
  onChatMessage(listener: (message: Readonly<ChatMessageProjection>) => void): () => void;
  onChatAnalysis(listener: (analysis: Readonly<ChatAnalysisProjection>) => void): () => void;
  getPilotOverlayPreferences(): Promise<PilotOverlayPreferences>;
  setPilotOverlayPreferences(
    preferences: PilotOverlayPreferences,
  ): Promise<PilotOverlayPreferences>;
}
