import type { BootstrapProjection } from './bootstrap.js';
import type { AudioDevice, PttCommandPayload, PttProjection } from './audio.js';
import type { ObsProjection } from './obs.js';
import type { AppSnapshot, StateChanged } from './state.js';

export interface ObscurPilotRendererApi {
  getBootstrap(): Promise<BootstrapProjection>;
  getSnapshot(afterVersion?: number): Promise<AppSnapshot>;
  onStateChanged(listener: (event: Readonly<StateChanged>) => void): () => void;
  commandPtt(action: PttCommandPayload['action']): Promise<{ accepted: true }>;
  setPttAccelerator(accelerator: string): Promise<{ accepted: true }>;
  listAudioDevices(): Promise<{ devices: AudioDevice[] }>;
  selectAudioDevice(deviceId: string): Promise<{ accepted: true }>;
  onPttChanged(listener: (projection: Readonly<PttProjection>) => void): () => void;
  getObsSnapshot(): Promise<ObsProjection>;
  reconnectObs(): Promise<{ accepted: true }>;
}
