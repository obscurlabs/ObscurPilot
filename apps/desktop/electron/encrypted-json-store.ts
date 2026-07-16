import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ZodType } from 'zod';

export interface EncryptionProvider {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?(): string;
}

export interface EncryptedFileOperations {
  read(path: string): Promise<string>;
  write(path: string, value: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  ensureDirectory(path: string): Promise<void>;
}

const nodeFileOperations: EncryptedFileOperations = {
  read: (path) => readFile(path, 'utf8'),
  write: (path, value) => writeFile(path, value, { encoding: 'utf8', mode: 0o600 }),
  rename,
  ensureDirectory: (path) => mkdir(path, { recursive: true }).then(() => undefined),
};

export class EncryptionUnavailableError extends Error {
  public constructor() {
    super('Operating-system encryption is unavailable');
    this.name = 'EncryptionUnavailableError';
  }
}

export function requireSecureEncryptionProvider(
  provider: EncryptionProvider,
  platform: 'win32' | 'darwin' | 'linux',
): EncryptionProvider {
  return {
    isEncryptionAvailable: () => {
      if (!provider.isEncryptionAvailable()) return false;
      if (platform !== 'linux') return true;
      const backend = provider.getSelectedStorageBackend?.() ?? 'unknown';
      return backend !== 'basic_text' && backend !== 'unknown';
    },
    encryptString: (value) => provider.encryptString(value),
    decryptString: (value) => provider.decryptString(value),
    ...(provider.getSelectedStorageBackend === undefined
      ? {}
      : { getSelectedStorageBackend: () => provider.getSelectedStorageBackend!() }),
  };
}

export class EncryptedJsonStore<T> {
  public constructor(
    private readonly filePath: string,
    private readonly schema: ZodType<T>,
    private readonly createDefault: () => T,
    private readonly encryption: EncryptionProvider,
    private readonly files: EncryptedFileOperations = nodeFileOperations,
    private readonly now: () => number = Date.now,
  ) {}

  public async load(): Promise<T> {
    let encoded: string;
    try {
      encoded = await this.files.read(this.filePath);
    } catch (error: unknown) {
      if (isMissingFile(error)) return this.createDefault();
      throw error;
    }
    if (!this.encryption.isEncryptionAvailable()) throw new EncryptionUnavailableError();
    try {
      const cleartext = this.encryption.decryptString(Buffer.from(encoded, 'base64'));
      return this.schema.parse(JSON.parse(cleartext));
    } catch {
      const quarantinePath = this.filePath + '.corrupt-' + this.now().toString(10);
      await this.files.rename(this.filePath, quarantinePath);
      return this.createDefault();
    }
  }

  public async save(value: T): Promise<void> {
    if (!this.encryption.isEncryptionAvailable()) throw new EncryptionUnavailableError();
    const parsed = this.schema.parse(value);
    const encrypted = this.encryption.encryptString(JSON.stringify(parsed)).toString('base64');
    await this.files.ensureDirectory(dirname(this.filePath));
    const temporaryPath = this.filePath + '.tmp-' + randomUUID();
    await this.files.write(temporaryPath, encrypted);
    await this.files.rename(temporaryPath, this.filePath);
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
