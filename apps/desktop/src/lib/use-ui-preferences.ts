import { useEffect, useState } from 'react';
import {
  DEFAULT_UI_PREFERENCES,
  parseUiPreferences,
  serializeUiPreferences,
  UI_PREFERENCES_STORAGE_KEY,
  type UiPreferences,
} from './ui-preferences';

export function useUiPreferences() {
  const [preferences, setPreferences] = useState<UiPreferences>(() => {
    if (typeof window === 'undefined') return DEFAULT_UI_PREFERENCES;
    return parseUiPreferences(window.localStorage.getItem(UI_PREFERENCES_STORAGE_KEY));
  });

  useEffect(() => {
    window.localStorage.setItem(UI_PREFERENCES_STORAGE_KEY, serializeUiPreferences(preferences));
    document.documentElement.dataset.motion = preferences.motion;
    document.documentElement.dataset.timelineDensity = preferences.timelineDensity;
  }, [preferences]);

  const updatePreferences = (patch: Partial<Omit<UiPreferences, 'version'>>) => {
    setPreferences((current) => ({ ...current, ...patch, version: 1 }));
  };

  const resetPreferences = () => setPreferences(DEFAULT_UI_PREFERENCES);

  return { preferences, updatePreferences, resetPreferences } as const;
}
