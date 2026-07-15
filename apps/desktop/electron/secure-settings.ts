import { readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { safeStorage } from 'electron';
import { z } from 'zod';

const SettingsSchema = z
  .object({
    accelerator: z.string().min(1).max(64).default('CommandOrControl+Shift+Space'),
    audioDeviceId: z.string().min(1).max(512).default('default'),
  })
  .strict();
export type SecureSettings = z.infer<typeof SettingsSchema>;

export class SecureSettingsStore {
  private value: SecureSettings = SettingsSchema.parse({});

  public constructor(private readonly filePath: string) {}

  public async load(): Promise<SecureSettings> {
    try {
      if (!safeStorage.isEncryptionAvailable()) return this.value;
      const encrypted = Buffer.from(await readFile(this.filePath, 'utf8'), 'base64');
      this.value = SettingsSchema.parse(JSON.parse(safeStorage.decryptString(encrypted)));
    } catch {
      this.value = SettingsSchema.parse({});
    }
    return this.value;
  }

  public snapshot(): SecureSettings {
    return { ...this.value };
  }

  public async update(patch: Partial<SecureSettings>): Promise<void> {
    this.value = SettingsSchema.parse({ ...this.value, ...patch });
    if (!safeStorage.isEncryptionAvailable()) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    const encrypted = safeStorage.encryptString(JSON.stringify(this.value));
    await writeFile(this.filePath, encrypted.toString('base64'), {
      encoding: 'utf8',
      mode: 0o600,
    });
  }
}
