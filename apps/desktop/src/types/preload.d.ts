import type { ObscurPilotRendererApi } from '@obscurpilot/contracts/renderer-api';

declare global {
  interface Window {
    readonly obscurPilot: Readonly<ObscurPilotRendererApi>;
  }
}

export {};
