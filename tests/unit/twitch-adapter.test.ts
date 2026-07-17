import {
  DelegatedTwitchAuthProvider,
  SlidingWindowEventDedupe,
  TwitchRateLimitScheduler,
} from '@obscurpilot/adapters-twitch/boundary';
import { describe, expect, it, vi } from 'vitest';

describe('delegated Twitch authentication', () => {
  it('coalesces concurrent token acquisition and never exposes a refresh token', async () => {
    const acquire = vi.fn(async () => ({
      accessToken: 'abcdefghijklmnop1234567890',
      userId: '12345',
      scopes: ['user:read:email'],
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    }));
    const provider = new DelegatedTwitchAuthProvider('abcdefgh12345678', '12345', { acquire });
    const [first, second] = await Promise.all([
      provider.getAccessTokenForUser('12345'),
      provider.getAccessTokenForUser('12345'),
    ]);
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(first?.refreshToken).toBeNull();
    expect(second?.accessToken).toBe(first?.accessToken);
    await expect(provider.getAccessTokenForUser('99999')).resolves.toBeNull();
  });

  it('rejects delegated tokens for a substituted account', async () => {
    const provider = new DelegatedTwitchAuthProvider('abcdefgh12345678', '12345', {
      acquire: async () => ({
        accessToken: 'abcdefghijklmnop1234567890',
        userId: '99999',
        scopes: [],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    });
    await expect(provider.getAccessTokenForUser('12345')).rejects.toThrow('invalid delegated');
  });

  it('accepts opaque RFC 6750 bearer-token characters returned by Twitch', async () => {
    const provider = new DelegatedTwitchAuthProvider('abcdefgh12345678', '12345', {
      acquire: async () => ({
        accessToken: 'AbCdEf_gh-ij.kl~mn+op/12==',
        userId: '12345',
        scopes: ['user:read:chat'],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    });

    await expect(provider.getAccessTokenForUser('12345')).resolves.toMatchObject({
      accessToken: 'AbCdEf_gh-ij.kl~mn+op/12==',
      userId: '12345',
    });
  });
});

describe('Twitch event resilience primitives', () => {
  it('deduplicates within TTL and evicts with bounded LRU behavior', () => {
    let now = 1_000;
    const dedupe = new SlidingWindowEventDedupe(1_000, 2, () => now);
    expect(dedupe.accept('a')).toBe(true);
    expect(dedupe.accept('a')).toBe(false);
    expect(dedupe.accept('b')).toBe(true);
    expect(dedupe.accept('c')).toBe(true);
    expect(dedupe.accept('a')).toBe(true);
    now += 1_001;
    expect(dedupe.accept('c')).toBe(true);
  });

  it('serializes scheduled Helix work and applies minimum spacing', async () => {
    let now = 0;
    const sleeps: number[] = [];
    const scheduler = new TwitchRateLimitScheduler(
      50,
      () => now,
      async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    );
    const order: number[] = [];
    await Promise.all([
      scheduler.schedule(async () => order.push(1)),
      scheduler.schedule(async () => order.push(2)),
      scheduler.schedule(async () => order.push(3)),
    ]);
    expect(order).toEqual([1, 2, 3]);
    expect(sleeps).toEqual([50, 50]);
  });
});
