import { ObsBridge } from '@obscurpilot/adapters-obs/boundary';
import { describe, expect, it, vi } from 'vitest';
import { loadDevelopmentEnvironment } from '../../apps/desktop/electron/environment.js';

loadDevelopmentEnvironment(process.cwd(), false);
const enabled = process.env.OBSCURPILOT_OBS_INTEGRATION === '1';

describe.skipIf(!enabled)('real OBS fixture', () => {
  it('connects to port 4455 and returns a validated read-only snapshot', async () => {
    const bridge = new ObsBridge({
      url: process.env.OBS_WEBSOCKET_URL ?? 'ws://127.0.0.1:4455',
      ...(process.env.OBS_WEBSOCKET_PASSWORD
        ? { password: process.env.OBS_WEBSOCKET_PASSWORD }
        : {}),
      onConnection: () => undefined,
    });
    bridge.start();
    await vi.waitFor(() => expect(bridge.snapshot()).toBeDefined(), { timeout: 10_000 });
    expect(bridge.snapshot()?.rpcVersion).toBe(1);
    await bridge.dispose();
  });
});
