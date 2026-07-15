import type { PttProjection } from '@obscurpilot/contracts/audio';

export interface EncodedAudioClip {
  readonly clipId: string;
  readonly sessionId: string;
  readonly durationMs: number;
  readonly bytes: Uint8Array;
  readonly mimeType: 'audio/wav';
  readonly truncated: boolean;
}

export interface AudioPipelineOptions {
  readonly sampleRate?: number;
  readonly minDurationMs?: number;
  readonly maxDurationMs?: number;
  readonly silenceRms?: number;
  readonly id?: () => string;
  readonly now?: () => number;
  readonly onProjection?: (projection: PttProjection) => void;
  readonly onClip?: (clip: EncodedAudioClip) => void;
}

export class BoundedPcmRingBuffer {
  private readonly samples: Int16Array;
  private length = 0;
  private sumSquares = 0;
  private clipped = false;

  public constructor(public readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) throw new Error('Invalid PCM capacity');
    this.samples = new Int16Array(capacity);
  }

  public append(input: Float32Array): number {
    const writable = Math.min(input.length, this.capacity - this.length);
    for (let index = 0; index < writable; index += 1) {
      const value = Math.max(-1, Math.min(1, input[index] ?? 0));
      const pcm = value < 0 ? Math.round(value * 0x8000) : Math.round(value * 0x7fff);
      this.samples[this.length + index] = pcm;
      this.sumSquares += value * value;
    }
    this.length += writable;
    if (writable < input.length) this.clipped = true;
    return writable;
  }

  public sampleCount(): number {
    return this.length;
  }

  public rms(): number {
    return this.length === 0 ? 0 : Math.sqrt(this.sumSquares / this.length);
  }

  public wasTruncated(): boolean {
    return this.clipped;
  }

  public view(): Int16Array {
    return this.samples.subarray(0, this.length);
  }

  public clear(): void {
    this.samples.fill(0);
    this.length = 0;
    this.sumSquares = 0;
    this.clipped = false;
  }
}

export class AudioClipVault {
  private readonly clips = new Map<
    string,
    { clip: EncodedAudioClip; timer: ReturnType<typeof setTimeout> }
  >();

  public constructor(private readonly retentionMs = 5_000) {}

  public put(clip: EncodedAudioClip): void {
    this.delete(clip.clipId);
    const timer = setTimeout(() => this.delete(clip.clipId), this.retentionMs);
    this.clips.set(clip.clipId, { clip, timer });
  }

  public take(clipId: string): EncodedAudioClip | undefined {
    const entry = this.clips.get(clipId);
    if (entry === undefined) return undefined;
    clearTimeout(entry.timer);
    this.clips.delete(clipId);
    return entry.clip;
  }

  public delete(clipId: string): void {
    const entry = this.clips.get(clipId);
    if (entry === undefined) return;
    clearTimeout(entry.timer);
    entry.clip.bytes.fill(0);
    this.clips.delete(clipId);
  }

  public dispose(): void {
    for (const id of [...this.clips.keys()]) this.delete(id);
  }

  public size(): number {
    return this.clips.size;
  }
}

export class PttAudioPipeline {
  private readonly sampleRate: number;
  private readonly minDurationMs: number;
  private readonly maxDurationMs: number;
  private readonly silenceRms: number;
  private readonly id: () => string;
  private readonly now: () => number;
  private buffer: BoundedPcmRingBuffer | undefined;
  private sessionId: string | undefined;
  private startedAt = 0;
  private phase: PttProjection['phase'] = 'idle';

  public constructor(private readonly options: AudioPipelineOptions = {}) {
    this.sampleRate = options.sampleRate ?? 16_000;
    this.minDurationMs = options.minDurationMs ?? 250;
    this.maxDurationMs = options.maxDurationMs ?? 30_000;
    this.silenceRms = options.silenceRms ?? 0.008;
    this.id = options.id ?? (() => crypto.randomUUID());
    this.now = options.now ?? Date.now;
  }

  public press(): string | undefined {
    if (
      this.phase !== 'idle' &&
      this.phase !== 'ready' &&
      this.phase !== 'rejected' &&
      this.phase !== 'error'
    ) {
      return undefined;
    }
    this.buffer?.clear();
    this.sessionId = this.id();
    this.startedAt = this.now();
    this.buffer = new BoundedPcmRingBuffer(
      Math.ceil((this.sampleRate * this.maxDurationMs) / 1_000),
    );
    this.phase = 'arming';
    this.emit('arming', 'CAPTURE_ARMING');
    return this.sessionId;
  }

  public armed(sessionId: string): void {
    if (!this.matches(sessionId, 'arming')) return;
    this.phase = 'capturing';
    this.emit('capturing', 'CAPTURE_ACTIVE');
  }

  public append(sessionId: string, samples: Float32Array, level?: number): number {
    if (!this.matches(sessionId, 'capturing') || this.buffer === undefined) return 0;
    const written = this.buffer.append(samples);
    this.emit(
      'capturing',
      this.buffer.wasTruncated() ? 'MAX_DURATION_REACHED' : 'CAPTURE_ACTIVE',
      level,
    );
    return written;
  }

  public release(sessionId: string): EncodedAudioClip | undefined {
    if (this.sessionId !== sessionId) return undefined;
    if (this.phase === 'arming') return this.reject('TOO_SHORT');
    if (this.phase !== 'capturing' || this.buffer === undefined) return undefined;
    this.phase = 'encoding';
    this.emit('encoding', 'ENCODING');
    const durationMs = Math.round((this.buffer.sampleCount() / this.sampleRate) * 1_000);
    if (durationMs < this.minDurationMs) return this.reject('TOO_SHORT');
    if (this.buffer.rms() < this.silenceRms) return this.reject('SILENCE');

    const bytes = encodeMonoPcm16Wav(this.buffer.view(), this.sampleRate);
    const clip: EncodedAudioClip = {
      clipId: this.id(),
      sessionId,
      durationMs,
      bytes,
      mimeType: 'audio/wav',
      truncated: this.buffer.wasTruncated(),
    };
    this.buffer.clear();
    this.buffer = undefined;
    this.phase = 'ready';
    this.emit('ready', clip.truncated ? 'READY_TRUNCATED' : 'READY', undefined, clip);
    this.options.onClip?.(clip);
    return clip;
  }

  public cancel(reasonCode = 'CANCELLED'): void {
    this.buffer?.clear();
    this.buffer = undefined;
    this.phase = 'idle';
    this.sessionId = undefined;
    this.emit('idle', reasonCode);
  }

  public interrupt(reasonCode = 'DEVICE_LOST'): void {
    this.buffer?.clear();
    this.buffer = undefined;
    this.phase = 'error';
    this.emit('error', reasonCode);
  }

  public projection(): PttProjection {
    return this.buildProjection(this.phase, this.phase === 'idle' ? 'IDLE' : 'CURRENT');
  }

  private reject(reasonCode: string): undefined {
    this.buffer?.clear();
    this.buffer = undefined;
    this.phase = 'rejected';
    this.emit('rejected', reasonCode);
    return undefined;
  }

  private matches(sessionId: string, phase: PttProjection['phase']): boolean {
    return this.sessionId === sessionId && this.phase === phase;
  }

  private emit(
    phase: PttProjection['phase'],
    reasonCode: string,
    level = 0,
    clip?: EncodedAudioClip,
  ): void {
    this.options.onProjection?.(this.buildProjection(phase, reasonCode, level, clip));
  }

  private buildProjection(
    phase: PttProjection['phase'],
    reasonCode: string,
    level = 0,
    clip?: EncodedAudioClip,
  ): PttProjection {
    const projection: PttProjection = {
      phase,
      elapsedMs: this.startedAt === 0 ? 0 : Math.max(0, this.now() - this.startedAt),
      level: Math.max(0, Math.min(1, level)),
      reasonCode,
    };
    if (this.sessionId !== undefined) projection.sessionId = this.sessionId;
    if (clip !== undefined) {
      projection.clip = {
        clipId: clip.clipId,
        durationMs: clip.durationMs,
        bytes: clip.bytes.byteLength,
        mimeType: clip.mimeType,
        truncated: clip.truncated,
      };
    }
    return projection;
  }
}

export function encodeMonoPcm16Wav(samples: Int16Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.byteLength;
  const output = new Uint8Array(44 + dataBytes);
  const view = new DataView(output.buffer);
  writeAscii(output, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(output, 8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(output, 36, 'data');
  view.setUint32(40, dataBytes, true);
  output.set(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength), 44);
  return output;
}

function writeAscii(output: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1)
    output[offset + index] = value.charCodeAt(index);
}
