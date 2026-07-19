export interface ObsPairingPorts {
  readonly getStoredPassword: () => string | undefined;
  readonly encryptionAvailable: () => boolean;
  readonly configure: (password: string | undefined) => Promise<unknown>;
  readonly persist: (password: string | undefined) => Promise<void>;
}

export class ObsPairingSecurityError extends Error {
  public constructor() {
    super('OS_ENCRYPTION_UNAVAILABLE');
    this.name = 'ObsPairingSecurityError';
  }
}

export class ObsPairingService {
  public constructor(private readonly ports: ObsPairingPorts) {}

  public async pair(password: string | undefined): Promise<void> {
    if (password !== undefined && !this.ports.encryptionAvailable()) {
      throw new ObsPairingSecurityError();
    }
    const previous = this.ports.getStoredPassword();
    try {
      await this.ports.configure(password);
      await this.ports.persist(password);
    } catch (error: unknown) {
      if (password !== previous) {
        await this.ports.configure(previous).catch(() => undefined);
      }
      throw error;
    }
  }

  public async clear(): Promise<void> {
    await this.ports.persist(undefined);
    await this.ports.configure(undefined).catch(() => undefined);
  }
}
