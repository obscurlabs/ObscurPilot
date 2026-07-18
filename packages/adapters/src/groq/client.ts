import Groq from 'groq-sdk';

export interface GroqClientOptions {
  readonly apiKey: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

export function createGroqClient(options: GroqClientOptions): Groq {
  if (options.apiKey.trim() === '') throw new Error('Groq API key is required');
  return new Groq({
    apiKey: options.apiKey,
    maxRetries: 0,
    timeout: options.timeoutMs ?? 12_000,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    logLevel: 'off',
  });
}
