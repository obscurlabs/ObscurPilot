import { readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { safeStorage } from 'electron';
import { z } from 'zod';
import {
  DEFAULT_SHORTCUT_BINDINGS,
  HandsFreePreferencesSchema,
  ShortcutBindingsSchema,
} from '@obscurpilot/contracts/audio';
import {
  LiveSessionProfileV1Schema,
  PilotOverlayPreferencesSchema,
} from '@obscurpilot/contracts/live-session';

const SettingsSchema = z
  .object({
    accelerator: z.string().min(1).max(64).default('Alt+X'),
    shortcuts: ShortcutBindingsSchema.default(DEFAULT_SHORTCUT_BINDINGS),
    audioDeviceId: z.string().min(1).max(512).default('default'),
    handsFree: HandsFreePreferencesSchema.default({
      enabled: false,
      wakePhrase: 'Hi Obscur',
      speechThreshold: 0.018,
      silenceReleaseMs: 850,
      conversationWindowMs: 300_000,
    }),
    pilotOverlay: PilotOverlayPreferencesSchema.default({
      visible: true,
      corner: 'bottom_right',
      scale: 1,
      clickThrough: true,
    }),
    liveSessionProfiles: z.array(LiveSessionProfileV1Schema).max(20).default([]),
    activeLiveSessionProfileId: z.string().uuid().optional(),
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
