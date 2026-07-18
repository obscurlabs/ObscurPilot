import { randomUUID } from 'node:crypto';
import {
  AudioDeviceListSchema,
  HandsFreePreferencesSchema,
  PttChangedEventSchema,
  type AudioDevice,
  type HandsFreePreferences,
  type PttProjection,
  type VoiceCaptureSource,
} from '@obscurpilot/contracts/audio';
import { AudioClipVault, PttAudioPipeline } from '@obscurpilot/domain/audio-pipeline';
import type { EncodedAudioClip } from '@obscurpilot/domain/audio-pipeline';
import { globalShortcut, type BrowserWindow, type IpcMain, type IpcMainEvent } from 'electron';
import { z } from 'zod';
import type { SecureSettingsStore } from '../storage/secure-settings.js';

const INTERNAL_EVENT = 'audio-internal:event:v1';
const INTERNAL_COMMAND = 'audio-internal:command:v1';
const AudioInternalEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('monitoring') }).strict(),
  z.object({ kind: z.literal('monitor-stopped') }).strict(),
  z.object({ kind: z.literal('utterance-started'), sessionId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('utterance-stopped'), sessionId: z.string().uuid() }).strict(),
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
  private handsFreeSessions = new Set<string>();
  private handsFree: HandsFreePreferences = HandsFreePreferencesSchema.parse({
    enabled: false,
    wakePhrase: 'Hi Obscur',
    speechThreshold: 0.018,
    silenceReleaseMs: 850,
    conversationWindowMs: 300_000,
  });

  public constructor(
    private readonly ipcMain: Pick<IpcMain, 'on' | 'removeListener'>,
    private readonly captureWindow: BrowserWindow,
    private readonly settings: SecureSettingsStore,
    private readonly emitProjection: (
      event: ReturnType<typeof PttChangedEventSchema.parse>,
    ) => void,
    private readonly onClip?: (
      clip: EncodedAudioClip,
      source: VoiceCaptureSource,
    ) => Promise<void> | void,
    private readonly onHandsFreeAudio?: (
      phase: 'arming' | 'standby' | 'listening' | 'paused' | 'error',
      reasonCode: string,
      level?: number,
    ) => void,
  ) {
    this.pipeline = new PttAudioPipeline({
      onProjection: (projection) => this.publish(projection),
      onClip: (clip) => this.handleClip(clip),
    });
    this.ipcMain.on(INTERNAL_EVENT, this.onInternalEvent);
  }

  public async start(): Promise<void> {
    const settings = await this.settings.load();
    this.handsFree = settings.handsFree;
    this.setAcceleratorRegistration(settings.accelerator);
    this.publish(this.pipeline.projection());
    if (this.handsFree.enabled) this.startMonitor();
  }

  public press(): void {
    this.captureWindow.webContents.send(INTERNAL_COMMAND, { kind: 'monitor-stop' });
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
    if (this.handsFree.enabled) this.startMonitor();
  }

  public async setHandsFreePreferences(preferences: HandsFreePreferences): Promise<void> {
    this.handsFree = HandsFreePreferencesSchema.parse(preferences);
    await this.settings.update({ handsFree: this.handsFree });
    if (this.handsFree.enabled) this.startMonitor();
    else {
      this.captureWindow.webContents.send(INTERNAL_COMMAND, { kind: 'monitor-stop' });
      this.onHandsFreeAudio?.('paused', 'HANDS_FREE_DISABLED');
    }
  }

  public setSuppressed(suppressed: boolean): void {
    if (!this.handsFree.enabled) return;
    this.captureWindow.webContents.send(INTERNAL_COMMAND, { kind: 'suppress', suppressed });
    this.onHandsFreeAudio?.(
      suppressed ? 'paused' : 'standby',
      suppressed ? 'PILOT_SPEAKING' : 'AWAITING_WAKE_PHRASE',
    );
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
    this.captureWindow.webContents.send(INTERNAL_COMMAND, { kind: 'monitor-stop' });
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
    if (message.kind === 'monitoring') {
      this.onHandsFreeAudio?.('standby', 'AWAITING_WAKE_PHRASE');
    }
    if (message.kind === 'monitor-stopped' && this.handsFree.enabled) {
      this.onHandsFreeAudio?.('paused', 'MICROPHONE_PAUSED');
    }
    if (message.kind === 'utterance-started') {
      const sessionId = this.pipeline.press(message.sessionId);
      if (sessionId !== undefined) {
        this.handsFreeSessions.add(sessionId);
        this.pipeline.armed(sessionId);
        this.onHandsFreeAudio?.('listening', 'SPEECH_DETECTED');
      }
    }
    if (message.kind === 'utterance-stopped') {
      this.pipeline.release(message.sessionId);
      this.onHandsFreeAudio?.('standby', 'UTTERANCE_CAPTURED');
    }
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
    if ((message.kind === 'stopped' || message.kind === 'cancelled') && this.handsFree.enabled) {
      this.startMonitor();
    }
  };

  private startMonitor(): void {
    if (this.disposed || !this.handsFree.enabled) return;
    this.onHandsFreeAudio?.('arming', 'MICROPHONE_ARMING');
    this.captureWindow.webContents.send(INTERNAL_COMMAND, {
      kind: 'monitor-start',
      deviceId: this.settings.snapshot().audioDeviceId,
      speechThreshold: this.handsFree.speechThreshold,
      silenceReleaseMs: this.handsFree.silenceReleaseMs,
    });
  }

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

  private handleClip(clip: EncodedAudioClip): void {
    const source: VoiceCaptureSource = this.handsFreeSessions.delete(clip.sessionId)
      ? 'hands_free'
      : 'ptt';
    this.vault.put(clip);
    if (this.onClip === undefined) return;
    const owned = this.vault.take(clip.clipId);
    if (owned === undefined) return;
    void Promise.resolve(this.onClip(owned, source)).finally(() => owned.bytes.fill(0));
  }
}
