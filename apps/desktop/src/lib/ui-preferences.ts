export const UI_PREFERENCES_STORAGE_KEY = 'obscurpilot.ui-preferences.v1';

export interface UiPreferences {
  readonly version: 1;
  readonly speechEnabled: boolean;
  readonly speechVoiceUri: string;
  readonly speechVolume: number;
  readonly announceConnectionChanges: boolean;
  readonly motion: 'system' | 'reduced';
  readonly timelineDensity: 'compact' | 'comfortable';
}

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  version: 1,
  speechEnabled: true,
  speechVoiceUri: '',
  speechVolume: 0.75,
  announceConnectionChanges: false,
  motion: 'system',
  timelineDensity: 'comfortable',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseUiPreferences(raw: string | null): UiPreferences {
  if (raw === null) return DEFAULT_UI_PREFERENCES;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 1) return DEFAULT_UI_PREFERENCES;
    return {
      version: 1,
      speechEnabled:
        typeof value.speechEnabled === 'boolean'
          ? value.speechEnabled
          : DEFAULT_UI_PREFERENCES.speechEnabled,
      speechVoiceUri:
        typeof value.speechVoiceUri === 'string'
          ? value.speechVoiceUri.slice(0, 512)
          : DEFAULT_UI_PREFERENCES.speechVoiceUri,
      speechVolume:
        typeof value.speechVolume === 'number' && Number.isFinite(value.speechVolume)
          ? Math.min(1, Math.max(0, value.speechVolume))
          : DEFAULT_UI_PREFERENCES.speechVolume,
      announceConnectionChanges:
        typeof value.announceConnectionChanges === 'boolean'
          ? value.announceConnectionChanges
          : DEFAULT_UI_PREFERENCES.announceConnectionChanges,
      motion: value.motion === 'reduced' ? 'reduced' : 'system',
      timelineDensity: value.timelineDensity === 'compact' ? 'compact' : 'comfortable',
    };
  } catch {
    return DEFAULT_UI_PREFERENCES;
  }
}

export function serializeUiPreferences(preferences: UiPreferences): string {
  return JSON.stringify(preferences);
}
