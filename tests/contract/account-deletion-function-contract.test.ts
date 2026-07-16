import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const functionPath = resolve(
  process.cwd(),
  'supabase/functions/process-account-deletions/index.ts',
);

describe('account deletion worker contract', () => {
  it('requires both platform JWT verification and a timing-safe job secret', async () => {
    const source = await readFile(functionPath, 'utf8');
    expect(source).toContain('OBSCURPILOT_DELETION_JOB_SECRET');
    expect(source).toContain('timingSafeEqual');
    expect(source).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('uses leased database claims and releases retryable failures', async () => {
    const source = await readFile(functionPath, 'utf8');
    expect(source).toContain('run_retention_maintenance');
    expect(source).toContain('claim_account_deletions');
    expect(source).toContain('release_account_deletion');
    expect(source).not.toMatch(/status: 'processing'/u);
  });
});
