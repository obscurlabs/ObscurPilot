import {
  extractFunctionFaultReason,
  parseCloudAuthCallback,
} from '../../apps/desktop/electron/cloud-bridge';
import { describe, expect, it } from 'vitest';

describe('cloud authentication callback', () => {
  it('accepts only the exact PKCE desktop callback', () => {
    expect(parseCloudAuthCallback('obscurpilot://auth/callback?code=valid-code_123')).toEqual({
      code: 'valid-code_123',
    });
    expect(
      parseCloudAuthCallback('obscurpilot://oauth/callback?code=valid-code_123'),
    ).toBeUndefined();
    expect(parseCloudAuthCallback('https://auth/callback?code=valid-code_123')).toBeUndefined();
  });

  it('projects provider errors without accepting credential fragments', () => {
    expect(parseCloudAuthCallback('obscurpilot://auth/callback?error=access_denied')).toEqual({
      error: true,
    });
    expect(
      parseCloudAuthCallback('obscurpilot://auth/callback#access_token=must-not-be-consumed'),
    ).toEqual({ error: true });
  });
});

describe('cloud function fault projection', () => {
  it('extracts only a bounded server reason code', async () => {
    const error = {
      context: new Response(JSON.stringify({ reasonCode: 'TWITCH_TOKEN_INVALID', secret: 'no' }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      }),
    };
    await expect(extractFunctionFaultReason(error)).resolves.toBe('TWITCH_TOKEN_INVALID');
  });

  it('fails closed for untrusted function error bodies', async () => {
    const error = { context: new Response(JSON.stringify({ reasonCode: 'bad reason' })) };
    await expect(extractFunctionFaultReason(error)).resolves.toBe('CLOUD_FUNCTION_FAILED');
  });
});
