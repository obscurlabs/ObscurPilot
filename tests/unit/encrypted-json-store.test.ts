import {
  EncryptedJsonStore,
  EncryptionUnavailableError,
  requireSecureEncryptionProvider,
  type EncryptedFileOperations,
  type EncryptionProvider,
} from '../../apps/desktop/electron/encrypted-json-store';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

class MemoryFiles implements EncryptedFileOperations {
  public readonly values = new Map<string, string>();
  public readonly renames: [string, string][] = [];

  public async read(path: string): Promise<string> {
    const value = this.values.get(path);
    if (value === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return value;
  }

  public async write(path: string, value: string): Promise<void> {
    this.values.set(path, value);
  }

  public async rename(from: string, to: string): Promise<void> {
    const value = this.values.get(from);
    if (value === undefined) throw new Error('missing source');
    this.values.delete(from);
    this.values.set(to, value);
    this.renames.push([from, to]);
  }

  public async ensureDirectory(): Promise<void> {}
}

const encryption: EncryptionProvider = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from('protected:' + value),
  decryptString: (value) => value.toString('utf8').replace(/^protected:/u, ''),
};

describe('encrypted JSON store', () => {
  it('writes atomically and validates decrypted data', async () => {
    const files = new MemoryFiles();
    const schema = z.object({ publicId: z.string().uuid() }).strict();
    const store = new EncryptedJsonStore(
      'identity.enc',
      schema,
      () => ({ publicId: '00000000-0000-4000-8000-000000000000' }),
      encryption,
      files,
    );
    const value = { publicId: '10000000-0000-4000-8000-000000000001' };
    await store.save(value);
    await expect(store.load()).resolves.toEqual(value);
    expect(files.renames[0]?.[1]).toBe('identity.enc');
    expect(files.values.get('identity.enc')).not.toContain(value.publicId);
  });

  it('quarantines corrupt encrypted content', async () => {
    const files = new MemoryFiles();
    files.values.set('auth.enc', Buffer.from('protected:not-json').toString('base64'));
    const store = new EncryptedJsonStore(
      'auth.enc',
      z.record(z.string(), z.string()),
      () => ({}),
      encryption,
      files,
      () => 42,
    );
    await expect(store.load()).resolves.toEqual({});
    expect(files.values.has('auth.enc.corrupt-42')).toBe(true);
  });

  it('fails closed when OS encryption is unavailable', async () => {
    const files = new MemoryFiles();
    const store = new EncryptedJsonStore(
      'auth.enc',
      z.object({}).strict(),
      () => ({}),
      { ...encryption, isEncryptionAvailable: () => false },
      files,
    );
    await expect(store.save({})).rejects.toBeInstanceOf(EncryptionUnavailableError);
  });

  it('rejects Linux basic-text credential storage', () => {
    const provider = requireSecureEncryptionProvider(
      { ...encryption, getSelectedStorageBackend: () => 'basic_text' },
      'linux',
    );
    expect(provider.isEncryptionAvailable()).toBe(false);
  });

  it('allows an OS-backed Linux credential store', () => {
    const provider = requireSecureEncryptionProvider(
      { ...encryption, getSelectedStorageBackend: () => 'gnome_libsecret' },
      'linux',
    );
    expect(provider.isEncryptionAvailable()).toBe(true);
  });
});
