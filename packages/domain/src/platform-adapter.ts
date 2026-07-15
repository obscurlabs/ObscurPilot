export const PLATFORM_ADAPTER_CONTRACT_VERSION = 1 as const;

export type ProviderHealth = 'idle' | 'connecting' | 'ready' | 'degraded' | 'auth_required';

export interface PlatformCapability {
  readonly name: string;
  readonly version: number;
}

export interface PlatformAdapterDescriptor {
  readonly contractVersion: typeof PLATFORM_ADAPTER_CONTRACT_VERSION;
  readonly provider: string;
  readonly capabilities: readonly PlatformCapability[];
}
