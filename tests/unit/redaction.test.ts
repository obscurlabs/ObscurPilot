import { describe, expect, it, vi } from 'vitest';
import {
  redactSensitive,
  redactText,
  safeErrorMessage,
  secureLogError,
} from '../../apps/desktop/electron/redaction';

const CANARIES = [
  'Bearer live_access_token_1234567890',
  'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature123',
  'sb_secret_stage13Canary_123456789',
  'TWITCH_TOKEN_ENCRYPTION_KEY=stage13-encryption-canary',
  'https://example.test/callback?code=oauth-canary-123&state=state-canary-456',
] as const;

describe('runtime secret redaction', () => {
  it.each(CANARIES)('removes a text canary without exposing the original value', (canary) => {
    const result = redactText('failure: ' + canary);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('canary');
  });

  it('redacts sensitive object fields, nested values, errors, and cycles', () => {
    const input: Record<string, unknown> = {
      account: 'creator',
      accessToken: 'access-canary-123456',
      nested: { password: 'password-canary', url: CANARIES[4] },
      error: new Error(CANARIES[0]),
    };
    input.self = input;
    const serialized = JSON.stringify(redactSensitive(input));
    expect(serialized).toContain('creator');
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).toContain('[CIRCULAR]');
    expect(serialized).not.toContain('canary');
  });

  it('sanitizes public error messages and terminal logging', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const message = safeErrorMessage(new Error(CANARIES[2]));
    secureLogError('Stage 13 diagnostic', { authorization: CANARIES[0], message });
    expect(message).not.toContain('canary');
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('canary');
    expect(JSON.stringify(consoleError.mock.calls)).toContain('[REDACTED]');
  });
});
