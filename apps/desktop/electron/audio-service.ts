import { randomUUID } from 'node:crypto';
import {
  AudioDeviceListSchema,
  PttChangedEventSchema,
  type AudioDevice,
  type PttProjection,
} from '@obscurpilot/contracts/audio';
import { AudioClipVault, PttAudioPipeline } from '@obscurpilot/domain/audio-pipeline';
import { globalShortcut, type BrowserWindow, type IpcMain, type IpcMainEvent } from 'electron';
import { z } from 'zod';
import type { SecureSettingsStore } from './secure-settings.js';

const INTERNAL_EVENT = 'audio-internal:event:v1';
const INTERNAL_COMMAND = 'audio-internal:command:v1';
const AudioInternalEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('started'), sessionId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('stopped'), sessionId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('cancelled'), sessionId: z.string().uuid() }).strict(),
  z
    .object({
      kind: z.literal('interrupted'),
      sessionId: z.string().uuid(),
      reasonCode: z.string().min(1).max(64),
    })
    .strict(),
  z
    .object({
      kind: z.literal('samples'),
      sessionId: z.string().uuid(),
      samples: z.custom<Float32Array>(
        (value) =>
          value instanceof Float32Array &&
          value.length > 0 &&
          value.length <= 4_096 &&
          value.every(Number.isFinite),
      ),
      level: z.number().min(0).max(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('devices'),
      requestId: z.string().uuid(),
      devices: AudioDeviceListSchema.shape.devices,
    })
    .strict(),
]);

export class PttAudioService {
  private readonly vault = new AudioClipVault();
  private readonly pendingDevices = new Map<
    string,
    { resolve: (devices: AudioDevice[]) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly pipeline: PttAudioPipeline;
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  private accelerator = '';
  private disposed = false;

  public constructor(
    private readonly ipcMain: Pick<IpcMain, 'on' | 'removeListener'>,
    private readonly captureWindow: BrowserWindow,
    private readonly settings: SecureSettingsStore,
    private readonly emitProjection: (
      event: ReturnType<typeof PttChangedEventSchema.parse>,
    ) => void,
  ) {
    this.pipeline = new PttAudioPipeline({
      onProjection: (projection) => this.publish(projection),
      onClip: (clip) => this.vault.put(clip),
    });
    this.ipcMain.on(INTERNAL_EVENT, this.onInternalEvent);
  }

  public async start(): Promise<void> {
    const settings = await this.settings.load();
    this.setAcceleratorRegistration(settings.accelerator);
    this.publish(this.pipeline.projection());
  }

  public press(): void {
    const sessionId = this.pipeline.press();
    if (sessionId === undefined) return;
    this.captureWindow.webContents.send(INTERNAL_COMMAND, {
      kind: 'start',
      sessionId,
      deviceId: this.settings.snapshot().audioDeviceId,
    });
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this.release(), 30_250);
    this.watchdog.unref?.();
  }

  public release(): void {
    const projection = this.pipeline.projection();
    if (projection.sessionId === undefined || !['arming', 'capturing'].includes(projection.phase)) {
      return;
    }
    clearTimeout(this.watchdog);
    this.captureWindow.webContents.send(INTERNAL_COMMAND, {
      kind: 'stop',
      sessionId: projection.sessionId,
    });
  }

  public cancel(): void {
    const projection = this.pipeline.projection();
    clearTimeout(this.watchdog);
    if (projection.sessionId !== undefined) {
      this.captureWindow.webContents.send(INTERNAL_COMMAND, {
        kind: 'cancel',
        sessionId: projection.sessionId,
      });
    }
    this.pipeline.cancel();
  }

  public async setAccelerator(accelerator: string): Promise<void> {
    this.setAcceleratorRegistration(accelerator);
    await this.settings.update({ accelerator });
  }

  public async selectDevice(deviceId: string): Promise<void> {
    await this.settings.update({ audioDeviceId: deviceId });
  }

  public listDevices(): Promise<{ devices: AudioDevice[] }> {
    const requestId = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingDevices.delete(requestId);
        resolve({ devices: [] });
      }, 3_000);
      timer.unref?.();
      this.pendingDevices.set(requestId, {
        resolve: (devices) => resolve({ devices }),
        timer,
      });
      this.captureWindow.webContents.send(INTERNAL_COMMAND, { kind: 'list-devices', requestId });
    });
  }

  public projection(): PttProjection {
    return this.pipeline.projection();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.watchdog);
    if (this.accelerator !== '') globalShortcut.unregister(this.accelerator);
    this.pipeline.cancel('SHUTDOWN');
    this.vault.dispose();
    this.ipcMain.removeListener(INTERNAL_EVENT, this.onInternalEvent);
    for (const pending of this.pendingDevices.values()) {
      clearTimeout(pending.timer);
      pending.resolve([]);
    }
    this.pendingDevices.clear();
    if (!this.captureWindow.isDestroyed()) this.captureWindow.destroy();
  }

  private readonly onInternalEvent = (event: IpcMainEvent, raw: unknown): void => {
    if (event.sender.id !== this.captureWindow.webContents.id) return;
    const parsed = AudioInternalEventSchema.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.kind === 'started') this.pipeline.armed(message.sessionId);
    if (message.kind === 'samples') {
      this.pipeline.append(message.sessionId, message.samples, message.level);
    }
    if (message.kind === 'stopped') this.pipeline.release(message.sessionId);
    if (message.kind === 'cancelled') this.pipeline.cancel();
    if (message.kind === 'interrupted') this.pipeline.interrupt(message.reasonCode);
    if (message.kind === 'devices') {
      const pending = this.pendingDevices.get(message.requestId);
      if (pending !== undefined) {
        clearTimeout(pending.timer);
        this.pendingDevices.delete(message.requestId);
        pending.resolve(message.devices);
      }
    }
  };

  private setAcceleratorRegistration(accelerator: string): void {
    if (accelerator === this.accelerator) return;
    const registered = globalShortcut.register(accelerator, () => {
      const phase = this.pipeline.projection().phase;
      if (phase === 'arming' || phase === 'capturing') this.release();
      else this.press();
    });
    if (!registered) throw new Error('Push-to-talk accelerator is unavailable');
    if (this.accelerator !== '') globalShortcut.unregister(this.accelerator);
    this.accelerator = accelerator;
  }

  private publish(projection: PttProjection): void {
    this.emitProjection(
      PttChangedEventSchema.parse({
        protocolVersion: 1,
        eventId: randomUUID(),
        emittedAt: new Date().toISOString(),
        payload: projection,
      }),
    );
  }
}
