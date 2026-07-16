import {
  DEFAULT_UI_PREFERENCES,
  parseUiPreferences,
  serializeUiPreferences,
} from '../../apps/desktop/src/lib/ui-preferences';
import { describe, expect, it } from 'vitest';

describe('versioned UI preferences', () => {
  it('round-trips valid local presentation preferences', () => {
    const preferences = {
      ...DEFAULT_UI_PREFERENCES,
      speechVolume: 0.4,
      motion: 'reduced' as const,
      timelineDensity: 'compact' as const,
    };
    expect(parseUiPreferences(serializeUiPreferences(preferences))).toEqual(preferences);
  });

  it('fails safely to defaults for invalid JSON or an unknown version', () => {
    expect(parseUiPreferences('{invalid')).toEqual(DEFAULT_UI_PREFERENCES);
    expect(parseUiPreferences('{"version":2}')).toEqual(DEFAULT_UI_PREFERENCES);
  });

  it('clamps volume and ignores malformed fields', () => {
    expect(
      parseUiPreferences(
        JSON.stringify({
          version: 1,
          speechEnabled: 'yes',
          speechVolume: 7,
          motion: 'unexpected',
        }),
      ),
    ).toMatchObject({ speechEnabled: true, speechVolume: 1, motion: 'system' });
  });
});
