import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/202607160001_stage6_identity_persistence.sql',
);
const repositoryPath = resolve(process.cwd(), 'packages/adapters-supabase/src/repository.ts');

describe('Stage 13 database query/index contract', () => {
  it('keeps an index prefix for every ordered or cursor-based repository read', async () => {
    const [migration, repository] = await Promise.all([
      readFile(migrationPath, 'utf8'),
      readFile(repositoryPath, 'utf8'),
    ]);
    for (const relation of ['control_profiles', 'tool_grants', 'activity_events']) {
      expect(repository).toContain("from('" + relation + "')");
    }
    for (const index of [
      'control_profiles_user_updated_idx on public.control_profiles(user_id, updated_at desc)',
      'tool_grants_user_updated_idx on public.tool_grants(user_id, updated_at desc)',
      'command_audit_user_occurred_idx on public.command_audit(user_id, occurred_at desc, id)',
      'activity_events_user_cursor_idx on public.activity_events(user_id, occurred_at, id)',
      'sync_outbox_pending_idx on private.sync_outbox(next_attempt_at, id)',
    ]) {
      expect(migration).toContain(index);
    }
  });

  it('keeps retention and deletion scans indexed', async () => {
    const migration = await readFile(migrationPath, 'utf8');
    for (const index of [
      'session_records_expiry_idx on public.session_records(expires_at)',
      'activity_events_expiry_idx on public.activity_events(expires_at)',
      'feedback_records_expiry_idx on public.feedback_records(expires_at)',
      'deletion_due_idx',
      'deletion_processing_lease_idx',
    ]) {
      expect(migration).toContain(index);
    }
  });
});
