import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('corner Pilot IPC startup ordering', () => {
  it('loads the overlay only after all immediately requested projections are registered', async () => {
    const source = await readFile(resolve('apps/desktop/electron/main.ts'), 'utf8');
    const loadIndex = source.indexOf('await loadPilotOverlayWindow(');
    expect(loadIndex).toBeGreaterThan(0);
    for (const channel of [
      'IPC_CHANNELS.handsFreeGetProjection',
      'IPC_CHANNELS.agentGetProjection',
      'IPC_CHANNELS.liveSessionGetProjection',
    ]) {
      const registrationIndex = source.indexOf('channel: ' + channel);
      expect(registrationIndex, channel + ' must be registered').toBeGreaterThan(0);
      expect(registrationIndex, channel + ' must precede overlay loading').toBeLessThan(loadIndex);
    }
  });

  it('does not expose an API that can create and load the overlay in one early call', async () => {
    const source = await readFile(resolve('apps/desktop/electron/window-manager.ts'), 'utf8');
    expect(source).toContain('export function createPilotOverlayWindowShell(');
    expect(source).toContain('export async function loadPilotOverlayWindow(');
    expect(source).not.toContain('export async function createPilotOverlayWindow(');
  });
});
