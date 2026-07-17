import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from 'groq-sdk';

export type GroqFaultCode =
  | 'NOT_CONFIGURED'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'AUTH_REQUIRED'
  | 'RATE_LIMITED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_REJECTED'
  | 'MALFORMED_RESPONSE'
  | 'NO_SPEECH'
  | 'CIRCUIT_OPEN';

export class GroqAdapterError extends Error {
  public constructor(
    public readonly code: GroqFaultCode,
    message: string,
    public readonly retryable = false,
    /**
     * Provider-directed delay before a retry. This is deliberately kept on the
     * boundary fault, rather than surfaced to the renderer, so callers cannot
     * accidentally retry a command ahead of the provider's reset window.
     */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'GroqAdapterError';
  }
}

export function translateGroqError(error: unknown, externalSignal?: AbortSignal): GroqAdapterError {
  if (error instanceof GroqAdapterError) return error;
  if (externalSignal?.aborted) {
    return new GroqAdapterError('CANCELLED', 'Groq operation was cancelled');
  }
  if (error instanceof APIConnectionTimeoutError) {
    return new GroqAdapterError('TIMEOUT', 'Groq request deadline elapsed', true);
  }
  if (error instanceof APIUserAbortError || isAbortError(error)) {
    return new GroqAdapterError('TIMEOUT', 'Groq request deadline elapsed', true);
  }
  if (error instanceof APIConnectionError) {
    return new GroqAdapterError('UPSTREAM_UNAVAILABLE', 'Groq transport is unavailable', true);
  }
  if (error instanceof APIError) {
    const status = error.status;
    if (status === 401 || status === 403) {
      return new GroqAdapterError('AUTH_REQUIRED', 'Groq credentials were rejected');
    }
    if (status === 408) {
      return new GroqAdapterError('TIMEOUT', 'Groq request deadline elapsed', true);
    }
    if (status === 429) {
      return new GroqAdapterError(
        'RATE_LIMITED',
        'Groq rate limit reached',
        true,
        retryAfterMs(error.headers),
      );
    }
    if (typeof status === 'number' && status >= 500) {
      return new GroqAdapterError(
        'UPSTREAM_UNAVAILABLE',
        'Groq service is temporarily unavailable',
        true,
      );
    }
    return new GroqAdapterError('UPSTREAM_REJECTED', 'Groq rejected the request');
  }
  return new GroqAdapterError('UPSTREAM_UNAVAILABLE', 'Groq operation failed');
}

function retryAfterMs(headers: Headers | undefined): number | undefined {
  if (headers === undefined) return undefined;
  const retryAfter = headers.get('retry-after');
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
    const dateMs = Date.parse(retryAfter);
    if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  }

  // Groq also returns this duration-form reset header on quota responses.
  return parseDurationHeader(headers.get('x-ratelimit-reset-requests'));
}

function parseDurationHeader(value: string | null): number | undefined {
  if (value === null) return undefined;
  const match = /^(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/u.exec(value.trim());
  if (match === null || (match[1] === undefined && match[2] === undefined)) return undefined;
  const minutes = Number(match[1] ?? 0);
  const seconds = Number(match[2] ?? 0);
  const durationMs = Math.round((minutes * 60 + seconds) * 1_000);
  return Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
