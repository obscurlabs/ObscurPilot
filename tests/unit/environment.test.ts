import { describe, expect, it } from 'vitest';
import { getDevelopmentServerUrl, parseEnvironment } from '../../apps/desktop/electron/environment';

describe('main-process environment configuration', () => {
  it('treats blank credentials as unconfigured', () => {
    const environment = parseEnvironment({
      GROQ_API_KEY: '',
      SUPABASE_URL: '',
      SUPABASE_ANON_KEY: '',
      TWITCH_CLIENT_ID: '',
    });

    expect(environment.GROQ_API_KEY).toBeUndefined();
    expect(environment.SUPABASE_URL).toBeUndefined();
    expect(environment.OBS_WEBSOCKET_PASSWORD).toBeUndefined();
    expect(environment.GROQ_STT_MODEL).toBe('whisper-large-v3-turbo');
    expect(environment.GROQ_REASONING_MODEL).toBe('openai/gpt-oss-120b');
    expect(environment.OBS_WEBSOCKET_URL).toBe('ws://127.0.0.1:4455');
    expect(environment.WAKE_WORD_ENGINE).toBe('sherpa_onnx');
    expect(environment.WAKE_WORD_COOLDOWN_MS).toBe(2_000);
  });

  it('normalizes the documented hyphenated offline wake engine alias', () => {
    const environment = parseEnvironment({
      WAKE_WORD_ENGINE: 'sherpa-onnx',
      WAKE_WORD_PHRASE: 'hi obscur',
      WAKE_WORD_THRESHOLD: '0.55',
      WAKE_WORD_COOLDOWN_MS: '2000',
    });
    expect(environment).toMatchObject({
      WAKE_WORD_ENGINE: 'sherpa_onnx',
      WAKE_WORD_PHRASE: 'hi obscur',
      WAKE_WORD_THRESHOLD: 0.55,
      WAKE_WORD_COOLDOWN_MS: 2_000,
    });
  });

  it('rejects a non-loopback development server', () => {
    const environment = parseEnvironment({
      OBSCURPILOT_DEV_SERVER_URL: 'https://attacker.example',
    });

    expect(() => getDevelopmentServerUrl(environment)).toThrow('must be a loopback HTTP URL');
  });

  it('accepts the fixed loopback Vite origin', () => {
    const environment = parseEnvironment({
      OBSCURPILOT_DEV_SERVER_URL: 'http://127.0.0.1:5173',
    });

    expect(getDevelopmentServerUrl(environment).origin).toBe('http://127.0.0.1:5173');
  });

  it('rejects remote or credential-bearing OBS WebSocket URLs', () => {
    expect(() => parseEnvironment({ OBS_WEBSOCKET_URL: 'ws://obs.example:4455' })).toThrow(
      'Invalid ObscurPilot environment fields: OBS_WEBSOCKET_URL',
    );

    expect(() =>
      parseEnvironment({ OBS_WEBSOCKET_URL: 'ws://user:secret@127.0.0.1:4455' }),
    ).toThrow('Invalid ObscurPilot environment fields: OBS_WEBSOCKET_URL');
  });
});
