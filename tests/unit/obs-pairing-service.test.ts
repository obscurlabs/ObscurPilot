import { describe, expect, it, vi } from 'vitest';
import {
  ObsPairingSecurityError,
  ObsPairingService,
} from '../../apps/desktop/electron/obs-pairing-service';

describe('OBS pairing transaction', () => {
  it('verifies before persistence and compensates a failed replacement', async () => {
    const calls: string[] = [];
    const configure = vi.fn(async (password: string | undefined) => {
      calls.push('configure:' + (password ?? 'none'));
      if (password === 'wrong') throw new Error('AUTH_REQUIRED');
    });
    const persist = vi.fn(async (password: string | undefined) => {
      calls.push('persist:' + (password ?? 'none'));
    });
    const service = new ObsPairingService({
      getStoredPassword: () => 'working',
      encryptionAvailable: () => true,
      configure,
      persist,
    });
    await expect(service.pair('wrong')).rejects.toThrow('AUTH_REQUIRED');
    expect(calls).toEqual(['configure:wrong', 'configure:working']);
    expect(persist).not.toHaveBeenCalled();

    calls.length = 0;
    await service.pair('new-working');
    expect(calls).toEqual(['configure:new-working', 'persist:new-working']);
  });

  it('refuses password-backed pairing without OS encryption', async () => {
    const configure = vi.fn(async () => undefined);
    const service = new ObsPairingService({
      getStoredPassword: () => undefined,
      encryptionAvailable: () => false,
      configure,
      persist: async () => undefined,
    });
    await expect(service.pair('secret')).rejects.toBeInstanceOf(ObsPairingSecurityError);
    expect(configure).not.toHaveBeenCalled();
  });

  it('forgets persistence even when unauthenticated reconnect cannot synchronize', async () => {
    const persist = vi.fn(async () => undefined);
    const service = new ObsPairingService({
      getStoredPassword: () => 'working',
      encryptionAvailable: () => true,
      configure: async () => {
        throw new Error('AUTH_REQUIRED');
      },
      persist,
    });
    await expect(service.clear()).resolves.toBeUndefined();
    expect(persist).toHaveBeenCalledWith(undefined);
  });
});
