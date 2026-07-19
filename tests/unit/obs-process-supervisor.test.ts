import { resolveObsExecutable } from '../../apps/desktop/electron/obs-process-supervisor.js';
import { describe, expect, it } from 'vitest';

describe('OBS process executable resolution', () => {
  it('uses a configured executable when it exists', () => {
    const configured = 'D:\\OBS\\bin\\64bit\\obs64.exe';
    expect(resolveObsExecutable(configured, {}, (path) => path === configured)).toBe(configured);
  });

  it('replaces a desktop shortcut with the standard installed executable', () => {
    const installed = 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe';
    expect(
      resolveObsExecutable(
        'C:\\Users\\Public\\Desktop\\OBS Studio.lnk',
        { ProgramFiles: 'C:\\Program Files' },
        (path) => path === installed,
      ),
    ).toBe(installed);
  });

  it('returns undefined when no real executable can be verified', () => {
    expect(resolveObsExecutable('C:\\OBS Studio.lnk', {}, () => false)).toBeUndefined();
  });
});
