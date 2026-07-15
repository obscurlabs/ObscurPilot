interface ObscurPilotAudioApi {
  onCommand(listener: (command: unknown) => void): void;
  emit(event: unknown): void;
}

declare global {
  interface Window {
    readonly obscurPilotAudio: Readonly<ObscurPilotAudioApi>;
  }
}

export {};
