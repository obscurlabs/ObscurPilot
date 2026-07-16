import type { GroqSttModel } from '@obscurpilot/contracts/agent';
import type { EncodedAudioClip } from '@obscurpilot/domain/audio-pipeline';
import type { OperationalEvent } from '@obscurpilot/observability/event';
import type Groq from 'groq-sdk';
import { z } from 'zod';
import { GroqAdapterError, translateGroqError } from './errors.js';
import { GroqResiliencePolicy, type GroqResilienceOptions } from './resilience.js';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_TRANSCRIPT_CHARACTERS = 16_000;
const TranscriptionResponseSchema = z.object({ text: z.string() }).passthrough();

export interface TranscriptionTransport {
  transcribe(input: {
    readonly file: File;
    readonly model: GroqSttModel;
    readonly signal: AbortSignal;
    readonly timeoutMs: number;
  }): Promise<unknown>;
}

export interface TranscriptionResult {
  readonly text: string;
  readonly model: GroqSttModel;
  readonly durationMs: number;
  readonly attempts: number;
}

export interface GroqTranscriptionAdapterOptions extends GroqResilienceOptions {
  readonly model?: GroqSttModel;
  readonly timeoutMs?: number;
  readonly transport: TranscriptionTransport;
  readonly onEvent?: (event: OperationalEvent) => void;
  readonly now?: () => number;
}

export class GroqTranscriptionAdapter {
  private readonly model: GroqSttModel;
  private readonly timeoutMs: number;
  private readonly resilience: GroqResiliencePolicy;
  private readonly now: () => number;

  public constructor(private readonly options: GroqTranscriptionAdapterOptions) {
    this.model = options.model ?? 'whisper-large-v3-turbo';
    this.timeoutMs = options.timeoutMs ?? 12_000;
    this.now = options.now ?? Date.now;
    this.resilience = new GroqResiliencePolicy(options);
  }

  public async transcribe(
    clip: EncodedAudioClip,
    correlationId: string,
    signal: AbortSignal,
  ): Promise<TranscriptionResult> {
    if (clip.mimeType !== 'audio/wav' || clip.bytes.byteLength > MAX_UPLOAD_BYTES) {
      throw new GroqAdapterError('UPSTREAM_REJECTED', 'Audio clip violates upload bounds');
    }
    const startedAt = this.now();
    this.emit(correlationId, 'groq.transcription.started');
    try {
      const copiedBytes = new Uint8Array(clip.bytes);
      const file = new File([copiedBytes], `${clip.clipId}.wav`, { type: clip.mimeType });
      const execution = await this.resilience.execute(async () => {
        const deadline = createDeadlineSignal(signal, this.timeoutMs);
        try {
          return await this.options.transport.transcribe({
            file,
            model: this.model,
            signal: deadline.signal,
            timeoutMs: this.timeoutMs,
          });
        } catch (error: unknown) {
          if (deadline.timedOut()) {
            throw new GroqAdapterError('TIMEOUT', 'Groq request deadline elapsed', true);
          }
          throw translateGroqError(error, signal);
        } finally {
          deadline.dispose();
        }
      }, signal);
      const response = TranscriptionResponseSchema.safeParse(execution.value);
      if (!response.success) {
        throw new GroqAdapterError('MALFORMED_RESPONSE', 'Groq transcription was malformed');
      }
      const text = normalizeTranscript(response.data.text);
      if (text === '') throw new GroqAdapterError('NO_SPEECH', 'No speech was recognized');
      const durationMs = Math.max(0, this.now() - startedAt);
      this.emit(correlationId, 'groq.transcription.completed', durationMs, 'success');
      return { text, model: this.model, durationMs, attempts: execution.attempts };
    } catch (error: unknown) {
      const fault = translateGroqError(error, signal);
      this.emit(
        correlationId,
        'groq.transcription.completed',
        Math.max(0, this.now() - startedAt),
        fault.code === 'CANCELLED' ? 'cancelled' : 'failure',
      );
      throw fault;
    }
  }

  public circuitState(): ReturnType<GroqResiliencePolicy['state']> {
    return this.resilience.state();
  }

  private emit(
    correlationId: string,
    event: string,
    durationMs?: number,
    outcome?: OperationalEvent['outcome'],
  ): void {
    this.options.onEvent?.({
      timestamp: new Date(this.now()).toISOString(),
      level: outcome === 'failure' ? 'warn' : 'info',
      service: 'groq-stt',
      event,
      correlationId,
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(outcome === undefined ? {} : { outcome }),
    });
  }
}

export function createSdkTranscriptionTransport(client: Groq): TranscriptionTransport {
  return {
    transcribe: ({ file, model, signal, timeoutMs }) =>
      client.audio.transcriptions.create(
        { file, model, response_format: 'json', temperature: 0 },
        { signal, timeout: timeoutMs, maxRetries: 0 },
      ),
  };
}

export function normalizeTranscript(value: string): string {
  const collapsed = value.normalize('NFKC').replace(/\s+/gu, ' ');
  let sanitized = '';
  for (const character of collapsed) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || codePoint === 127) continue;
    sanitized += character;
    if (sanitized.length >= MAX_TRANSCRIPT_CHARACTERS) break;
  }
  return sanitized.trim();
}

function createDeadlineSignal(
  parent: AbortSignal,
  timeoutMs: number,
): {
  readonly signal: AbortSignal;
  timedOut(): boolean;
  dispose(): void;
} {
  const controller = new AbortController();
  let timeout = false;
  const onParentAbort = () => controller.abort(parent.reason);
  parent.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => {
    timeout = true;
    controller.abort(new DOMException('Deadline elapsed', 'AbortError'));
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timeout,
    dispose: () => {
      clearTimeout(timer);
      parent.removeEventListener('abort', onParentAbort);
    },
  };
}
