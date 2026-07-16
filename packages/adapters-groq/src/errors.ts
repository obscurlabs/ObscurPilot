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
      return new GroqAdapterError('RATE_LIMITED', 'Groq rate limit reached', true);
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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
