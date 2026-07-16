import { useEffect, useState } from 'react';
import type { UiPreferences } from '../lib/ui-preferences';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader } from './ui/card';
import { Switch } from './ui/switch';

function useSpeechVoices() {
  const [voices, setVoices] = useState<readonly SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const refresh = () => setVoices(window.speechSynthesis.getVoices());
    refresh();
    window.speechSynthesis.addEventListener('voiceschanged', refresh);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', refresh);
  }, []);
  return voices;
}

export function ControlSettings({
  preferences,
  onChange,
  onReset,
  onTestSpeech,
}: {
  readonly preferences: UiPreferences;
  readonly onChange: (patch: Partial<Omit<UiPreferences, 'version'>>) => void;
  readonly onReset: () => void;
  readonly onTestSpeech: () => void;
}) {
  const voices = useSpeechVoices();
  const speechSupported =
    'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';

  return (
    <Card className="span-full" id="settings" aria-labelledby="settings-title">
      <CardHeader className="settings-header">
        <div>
          <p className="eyebrow">Local interaction preferences</p>
          <h2 className="panel-title" id="settings-title">
            Control-board settings
          </h2>
        </div>
        <Badge tone={speechSupported ? 'ready' : 'neutral'}>
          {speechSupported ? 'Native speech ready' : 'Visual feedback only'}
        </Badge>
      </CardHeader>
      <CardContent className="settings-layout">
        <fieldset className="settings-group">
          <legend>Voice feedback</legend>
          <Switch
            checked={preferences.speechEnabled}
            disabled={!speechSupported}
            label="Speak important agent outcomes"
            description="Uses the operating system voice for approvals, completion and recovery."
            onCheckedChange={(speechEnabled) => onChange({ speechEnabled })}
          />
          <Switch
            checked={preferences.announceConnectionChanges}
            disabled={!preferences.speechEnabled || !speechSupported}
            label="Announce connection changes"
            description="Speak only ready, authorization-required and degraded transitions."
            onCheckedChange={(announceConnectionChanges) => onChange({ announceConnectionChanges })}
          />
          <label className="setting-field">
            <span>System voice</span>
            <select
              value={preferences.speechVoiceUri}
              disabled={!preferences.speechEnabled || !speechSupported}
              onChange={(event) => onChange({ speechVoiceUri: event.target.value })}
            >
              <option value="">Operating system default</option>
              {voices.map((voice) => (
                <option value={voice.voiceURI} key={voice.voiceURI}>
                  {voice.name} ({voice.lang})
                </option>
              ))}
            </select>
          </label>
          <label className="setting-field setting-range">
            <span>Speech volume: {Math.round(preferences.speechVolume * 100)}%</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={preferences.speechVolume}
              disabled={!preferences.speechEnabled || !speechSupported}
              onChange={(event) => onChange({ speechVolume: Number(event.target.value) })}
            />
          </label>
          <Button
            variant="secondary"
            disabled={!preferences.speechEnabled || !speechSupported}
            onClick={onTestSpeech}
          >
            Test voice feedback
          </Button>
        </fieldset>

        <fieldset className="settings-group">
          <legend>Display and activity</legend>
          <label className="setting-field">
            <span>Motion</span>
            <select
              value={preferences.motion}
              onChange={(event) =>
                onChange({ motion: event.target.value === 'reduced' ? 'reduced' : 'system' })
              }
            >
              <option value="system">Follow operating system</option>
              <option value="reduced">Reduce ambient motion</option>
            </select>
          </label>
          <label className="setting-field">
            <span>Timeline density</span>
            <select
              value={preferences.timelineDensity}
              onChange={(event) =>
                onChange({
                  timelineDensity: event.target.value === 'compact' ? 'compact' : 'comfortable',
                })
              }
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </label>
          <div className="settings-boundary-note">
            <strong>Renderer-safe preferences</strong>
            <p>
              These options affect presentation only. Provider state and protected operations remain
              authoritative in the Electron main process.
            </p>
          </div>
          <Button variant="ghost" onClick={onReset}>
            Restore interface defaults
          </Button>
        </fieldset>
      </CardContent>
    </Card>
  );
}
