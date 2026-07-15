import { describe, expect, it } from 'vitest';
import {
  APP_GET_BOOTSTRAP_CHANNEL,
  BootstrapProjectionSchema,
} from '@obscurpilot/contracts/bootstrap';

const validProjection = {
  protocolVersion: 1,
  app: { name: 'ObscurPilot', version: '0.1.0' },
  runtime: {
    platform: 'win32',
    electron: '43.1.1',
    chrome: '142.0.0',
    node: '24.0.0',
  },
  configuration: {
    groqConfigured: false,
    supabaseConfigured: false,
    twitchConfigured: false,
  },
} as const;

describe('bootstrap IPC contract', () => {
  it('uses a versioned allowlisted channel', () => {
    expect(APP_GET_BOOTSTRAP_CHANNEL).toBe('app:get-bootstrap:v1');
  });

  it('accepts the exact bootstrap projection', () => {
    expect(BootstrapProjectionSchema.parse(validProjection)).toEqual(validProjection);
  });

  it('rejects unknown fields', () => {
    expect(() =>
      BootstrapProjectionSchema.parse({ ...validProjection, secret: 'must-not-cross-ipc' }),
    ).toThrow();
  });
});
