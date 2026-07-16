import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Stage 9 default tool-policy migration', () => {
  it('creates an active profile with exact least-privilege tool grants', async () => {
    const sql = await readFile(
      'supabase/migrations/202607160005_stage9_default_tool_policy.sql',
      'utf8',
    );
    for (const tool of [
      'obs.read_snapshot',
      'obs.set_program_scene',
      'obs.set_input_mute',
      'obs.start_stream',
      'obs.stop_stream',
      'obs.start_record',
      'obs.stop_record',
      'twitch.read_connection',
    ]) {
      expect(sql).toContain(`('${tool}'`);
    }
    expect(sql).toContain("'obs.start_stream', 2::smallint, 'always'");
    expect(sql).toContain("'obs.stop_stream', 2::smallint, 'always'");
    expect(sql).toContain('private.ensure_default_control_profile(new.id)');
    expect(sql).toContain(
      'revoke execute on function private.ensure_default_control_profile(uuid)',
    );
  });
});
