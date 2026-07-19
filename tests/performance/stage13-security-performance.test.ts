import { performance } from 'node:perf_hooks';
import { redactSensitive } from '../../apps/desktop/electron/redaction';
import { expect, it } from 'vitest';

it('redacts ten thousand structured diagnostics within the local processing budget', () => {
  const diagnostic = {
    provider: 'twitch',
    authorization: 'Bearer stage13-canary-token-123456789',
    callback: 'https://example.test/callback?code=canary-code&state=canary-state',
    nested: { password: 'canary-password', attempts: [1, 2, 3] },
  };
  const startedAt = performance.now();
  for (let index = 0; index < 10_000; index += 1) redactSensitive({ ...diagnostic, index });
  expect(performance.now() - startedAt).toBeLessThan(1_500);
});
