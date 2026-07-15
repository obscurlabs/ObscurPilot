import type { BootstrapProjection } from './bootstrap.js';
import type { AppSnapshot, StateChanged } from './state.js';

export interface ObscurPilotRendererApi {
  getBootstrap(): Promise<BootstrapProjection>;
  getSnapshot(afterVersion?: number): Promise<AppSnapshot>;
  onStateChanged(listener: (event: Readonly<StateChanged>) => void): () => void;
}
