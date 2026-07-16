import { readFile } from 'node:fs/promises';
import { TwitchActivitySchema, TwitchProjectionSchema } from '@obscurpilot/contracts/twitch';
import { describe, expect, it } from 'vitest';

describe('Stage 7 Twitch security contracts', () => {
  it('keeps renderer projections token-free and strictly bounded', () => {
    const projection = TwitchProjectionSchema.parse({
      configured: true,
      phase: 'connected',
      account: {
        providerUserId: '1234',
        displayName: 'Creator',
        scopes: [],
        tokenExpiresAt: new Date().toISOString(),
      },
      reasonCode: 'READY',
    });
    expect(JSON.stringify(projection)).not.toMatch(/accessToken|refreshToken|clientSecret/iu);
    expect(() => TwitchProjectionSchema.parse({ ...projection, accessToken: 'never' })).toThrow();
    expect(() =>
      TwitchActivitySchema.parse({
        id: 'event',
        type: 'stream.online',
        occurredAt: new Date().toISOString(),
        summary: 'Online',
        metadata: {},
        rawPayload: {},
      }),
    ).toThrow();
  });

  it('enforces private token custody, single-use OAuth state, and serialized refresh leases', async () => {
    const migration = await readFile(
      'supabase/migrations/202607160002_stage7_twitch_oauth.sql',
      'utf8',
    );
    expect(migration).toContain('alter table private.oauth_flows force row level security');
    expect(migration).toContain("status = 'exchanging'");
    expect(migration).toContain('refresh_lease_owner');
    expect(migration).toContain('grant execute on function');
    expect(migration).toMatch(/revoke all on function[\s\S]+from public, anon, authenticated/iu);
  });

  it('keeps secrets server-side and validates callback identity before persistence', async () => {
    const shared = await readFile('supabase/functions/_shared/twitch.ts', 'utf8');
    const callback = await readFile('supabase/functions/twitch-oauth-callback/index.ts', 'utf8');
    expect(shared).toContain("requireEnv('TWITCH_CLIENT_SECRET')");
    expect(shared).toContain("crypto.subtle.encrypt({ name: 'AES-GCM'");
    expect(shared).toContain('https://id.twitch.tv/oauth2/validate');
    expect(callback).toContain('stage7_claim_twitch_oauth_callback');
    expect(callback).toContain('stage7_complete_twitch_oauth');
    expect(callback).not.toMatch(/console\.(log|error)/u);
  });
});
