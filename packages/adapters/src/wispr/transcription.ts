import type { OperationalEvent } from '@obscurpilot/contracts/observability';
import type { EncodedAudioClip } from '@obscurpilot/domain/audio-pipeline';
import { CircuitBreaker } from '@obscurpilot/domain/circuit-breaker';
import { computeFullJitterDelay, sleepWithSignal } from '@obscurpilot/domain/retry';
import { z } from 'zod';

/** Wispr Flow REST transcription: base64 16 kHz WAV in, cleaned-up text out. */
export const WISPR_FLOW_ENDPOINT = 'https://platform-api.wisprflow.ai/api/v1/dash/api';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_TRANSCRIPT_CHARACTERS = 16_000;
const MAX_DICTIONARY_TERMS = 200;
const MAX_DICTIONARY_TERM_LENGTH = 64;
const ResponseSchema = z
  .object({ text: z.string(), detected_language: z.string().optional() })
  .passthrough();

export type WisprFaultCode =
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'AUTH_REQUIRED'
  | 'RATE_LIMITED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_REJECTED'
  | 'MALFORMED_RESPONSE'
  | 'NO_SPEECH'
  | 'CIRCUIT_OPEN';

export class WisprAdapterError extends Error {
  public constructor(
    public readonly code: WisprFaultCode,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'WisprAdapterError';
  }
}

export interface TranscriptionResult {
  readonly text: string;
  readonly durationMs: number;
  readonly attempts: number;
  readonly detectedLanguage?: string;
}

export interface WisprTranscriptionAdapterOptions {
  readonly apiKey: string;
  /** Uncommon words Flow should spell correctly, read fresh for every clip. */
  readonly dictionary?: () => readonly string[];
  /** ISO 639-1 codes; a single entry forces that language, omitted autodetects. */
  readonly languages?: readonly string[];
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly fetch?: typeof fetch;
  readonly onEvent?: (event: OperationalEvent) => void;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly circuitBreaker?: CircuitBreaker;
}

export class WisprTranscriptionAdapter {
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly circuit: CircuitBreaker;

  public constructor(private readonly options: WisprTranscriptionAdapterOptions) {
    this.timeoutMs = options.timeoutMs ?? 12_000;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.circuit = options.circuitBreaker ?? new CircuitBreaker();
  }

  public async transcribe(
    clip: EncodedAudioClip,
    correlationId: string,
    signal: AbortSignal,
  ): Promise<TranscriptionResult> {
    if (clip.mimeType !== 'audio/wav' || clip.bytes.byteLength > MAX_UPLOAD_BYTES) {
      throw new WisprAdapterError('UPSTREAM_REJECTED', 'Audio clip violates upload bounds');
    }
    const startedAt = this.now();
    this.emit(correlationId, 'wispr.transcription.started');
    try {
      const body = JSON.stringify(this.requestBody(clip));
      const { value, attempts } = await this.withRetries(() => this.request(body, signal), signal);
      const text = normalizeTranscript(value.text);
      if (text === '') throw new WisprAdapterError('NO_SPEECH', 'No speech was recognized');
      const durationMs = Math.max(0, this.now() - startedAt);
      this.emit(correlationId, 'wispr.transcription.completed', durationMs, 'success');
      return {
        text,
        durationMs,
        attempts,
        ...(value.detected_language === undefined
          ? {}
          : { detectedLanguage: value.detected_language }),
      };
    } catch (error: unknown) {
      const fault = translateWisprError(error, signal);
      this.emit(
        correlationId,
        'wispr.transcription.completed',
        Math.max(0, this.now() - startedAt),
        fault.code === 'CANCELLED' ? 'cancelled' : 'failure',
      );
      throw fault;
    }
  }

  private requestBody(clip: EncodedAudioClip): Record<string, unknown> {
    const dictionary = [
      ...new Set(
        (this.options.dictionary?.() ?? [])
          .map((term) => term.trim())
          .filter((term) => term.length > 0 && term.length <= MAX_DICTIONARY_TERM_LENGTH),
      ),
    ].slice(0, MAX_DICTIONARY_TERMS);
    return {
      audio: Buffer.from(clip.bytes).toString('base64'),
      ...(this.options.languages?.length ? { language: [...this.options.languages] } : {}),
      context: {
        app: { name: 'ObscurPilot', type: 'ai' },
        ...(dictionary.length ? { dictionary_context: dictionary } : {}),
      },
    };
  }

  private async request(body: string, signal: AbortSignal): Promise<z.infer<typeof ResponseSchema>> {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]);
    let response: Response;
    try {
      response = await this.fetch(WISPR_FLOW_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: deadline,
      });
    } catch (error: unknown) {
      throw translateWisprError(error, signal);
    }
    if (!response.ok) throw faultForStatus(response.status);
    const parsed = ResponseSchema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) {
      throw new WisprAdapterError('MALFORMED_RESPONSE', 'Wispr Flow response was malformed');
    }
    return parsed.data;
  }

  private async withRetries<T>(
    operation: () => Promise<T>,
    signal: AbortSignal,
  ): Promise<{ readonly value: T; readonly attempts: number }> {
    if (!this.circuit.canExecute(this.now())) {
      throw new WisprAdapterError('CIRCUIT_OPEN', 'Wispr Flow circuit is temporarily open');
    }
    for (let attempt = 1; ; attempt += 1) {
      if (signal.aborted) throw new WisprAdapterError('CANCELLED', 'Transcription was cancelled');
      try {
        const value = await operation();
        this.circuit.recordSuccess();
        return { value, attempts: attempt };
      } catch (error: unknown) {
        const fault = translateWisprError(error, signal);
        if (fault.retryable) this.circuit.recordFailure(this.now());
        if (!fault.retryable || attempt >= this.maxAttempts) throw fault;
        await sleepWithSignal(
          computeFullJitterDelay(attempt - 1, this.random, {
            baseDelayMs: 200,
            maxDelayMs: 2_000,
            maxAttempts: this.maxAttempts,
          }),
          signal,
        );
      }
    }
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
      service: 'wispr-stt',
      event,
      correlationId,
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(outcome === undefined ? {} : { outcome }),
    });
  }
}

function faultForStatus(status: number): WisprAdapterError {
  if (status === 401 || status === 403) {
    return new WisprAdapterError('AUTH_REQUIRED', 'Wispr Flow rejected the API key');
  }
  if (status === 408) return new WisprAdapterError('TIMEOUT', 'Wispr Flow timed out', true);
  if (status === 429) {
    return new WisprAdapterError('RATE_LIMITED', 'Wispr Flow rate limit reached', true);
  }
  if (status >= 500) {
    return new WisprAdapterError('UPSTREAM_UNAVAILABLE', 'Wispr Flow is unavailable', true);
  }
  return new WisprAdapterError('UPSTREAM_REJECTED', `Wispr Flow rejected the clip (${status})`);
}

export function translateWisprError(error: unknown, signal?: AbortSignal): WisprAdapterError {
  if (error instanceof WisprAdapterError) return error;
  if (signal?.aborted) return new WisprAdapterError('CANCELLED', 'Transcription was cancelled');
  const timedOut = error instanceof DOMException && ['TimeoutError', 'AbortError'].includes(error.name);
  if (timedOut) {
    return new WisprAdapterError('TIMEOUT', 'Wispr Flow request deadline elapsed', true);
  }
  return new WisprAdapterError('UPSTREAM_UNAVAILABLE', 'Wispr Flow is unreachable', true);
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
