import { describe, expect, it } from 'vitest';
import type { Session } from 'electron';
import {
  installPermissionDenial,
  isTrustedRendererUrl,
} from '../../apps/desktop/electron/security';

describe('renderer sender validation', () => {
  it('accepts only the packaged application origin in production', () => {
    expect(isTrustedRendererUrl('app://bundle/index.html', false, '')).toBe(true);
    expect(isTrustedRendererUrl('app://bundle.attacker/index.html', false, '')).toBe(false);
    expect(isTrustedRendererUrl('app://bundle@attacker/index.html', false, '')).toBe(false);
    expect(isTrustedRendererUrl('https://attacker.example', false, '')).toBe(false);
  });

  it('requires an exact development origin', () => {
    expect(
      isTrustedRendererUrl('http://127.0.0.1:5173/settings', true, 'http://127.0.0.1:5173'),
    ).toBe(true);
    expect(
      isTrustedRendererUrl('http://127.0.0.1:5174/settings', true, 'http://127.0.0.1:5173'),
    ).toBe(false);
  });

  it('denies renderer permission checks and requests by default', () => {
    const checkResults: boolean[] = [];
    const requestResults: boolean[] = [];
    const fakeSession = {
      setPermissionCheckHandler: (handler: Parameters<Session['setPermissionCheckHandler']>[0]) => {
        if (handler !== null) {
          checkResults.push(handler({} as never, 'media', 'app://bundle', {} as never));
        }
      },
      setPermissionRequestHandler: (
        handler: Parameters<Session['setPermissionRequestHandler']>[0],
      ) => {
        if (handler !== null) {
          handler({} as never, 'media', (allowed) => requestResults.push(allowed), {
            requestingUrl: 'app://bundle',
            isMainFrame: true,
          });
        }
      },
    };
    const dispose = installPermissionDenial(fakeSession as never);
    expect(checkResults).toEqual([false]);
    expect(requestResults).toEqual([false]);
    dispose();
  });
});
