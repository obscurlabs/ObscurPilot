import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/202607160001_stage6_identity_persistence.sql',
);

describe('Stage 6 Supabase migration contract', () => {
  it('forces RLS on every application table and keeps secret tables private', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    for (const table of [
      'profiles',
      'devices',
      'provider_accounts',
      'obs_endpoints',
      'control_profiles',
      'tool_grants',
      'event_subscriptions',
      'session_records',
      'command_audit',
      'activity_events',
      'feedback_records',
      'account_deletion_requests',
    ]) {
      expect(sql).toContain("'" + table + "'");
    }
    for (const table of ['oauth_token_secrets', 'client_mutations', 'sync_outbox']) {
      expect(sql).toContain('alter table private.' + table + ' force row level security');
    }
    expect(sql).toContain('revoke all on all tables in schema private from anon, authenticated');
    expect(sql).not.toMatch(/grant\s+.+private\.oauth_token_secrets\s+to\s+authenticated/iu);
  });

  it('pins security-definer search paths and explicit function grants', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    const definers = sql.match(/security definer/gu) ?? [];
    const emptySearchPaths = sql.match(/security definer\s+set search_path = ''/gu) ?? [];
    expect(emptySearchPaths).toHaveLength(definers.length);
    expect(sql).toContain(
      'revoke execute on function public.update_creator_profile(uuid, bigint, text, text, text) from public, anon',
    );
    expect(sql).toContain(
      'grant execute on function public.update_creator_profile(uuid, bigint, text, text, text) to authenticated',
    );
  });

  it('implements revision conflicts, server idempotency, retention, and deletion requests', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    expect(sql).toContain('p.revision = p_expected_revision');
    expect(sql).toContain('private.client_mutations');
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('private.purge_expired_content');
    expect(sql).toContain('public.run_retention_maintenance');
    expect(sql).toContain('public.account_deletion_requests');
    expect(sql).toContain('public.claim_account_deletions');
    expect(sql).toContain('for update skip locked');
  });

  it('prevents direct writes from bypassing guarded profile and device RPCs', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    expect(sql).toContain('grant select on public.profiles to authenticated');
    expect(sql).toContain('grant select on public.devices to authenticated');
    expect(sql).not.toContain(
      'grant select, insert, update, delete on public.profiles to authenticated',
    );
    expect(sql).not.toContain(
      'grant select, insert, update, delete on public.devices to authenticated',
    );
    const registerDevice = sql.slice(
      sql.indexOf('create or replace function public.register_device'),
    );
    expect(registerDevice).toContain('security definer');
  });
});
