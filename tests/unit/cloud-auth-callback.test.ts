import { parseCloudAuthCallback } from '../../apps/desktop/electron/cloud-bridge';
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
