import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import WebSocket, { type RawData } from 'ws';
import {
  DeepgramVoiceAgent,
  type VoiceSocket,
} from '../../apps/desktop/electron/deepgram-voice-agent';

class FakeVoiceSocket implements VoiceSocket {
  public readyState: number = WebSocket.CONNECTING;
  public readonly sent: Array<string | Uint8Array> = [];
  private readonly openListeners: Array<() => void> = [];
  private readonly messageListeners: Array<(data: RawData, isBinary: boolean) => void> = [];
  private readonly closeListeners: Array<(code: number, reason: Buffer) => void> = [];
  private readonly errorListeners: Array<(error: Error) => void> = [];

  public on(event: 'open' | 'message' | 'close' | 'error', listener: unknown): this {
    if (event === 'open') this.openListeners.push(listener as () => void);
    if (event === 'message') {
      this.messageListeners.push(listener as (data: RawData, isBinary: boolean) => void);
    }
    if (event === 'close') {
      this.closeListeners.push(listener as (code: number, reason: Buffer) => void);
    }
    if (event === 'error') this.errorListeners.push(listener as (error: Error) => void);
    return this;
  }

  public send(data: string | Uint8Array): void {
    this.sent.push(data);
  }

  public close(code = 1_000, reason = ''): void {
    this.readyState = WebSocket.CLOSED;
    for (const listener of this.closeListeners) listener(code, Buffer.from(reason));
  }

  public terminate(): void {
    this.close(1_006, 'terminated');
  }

  public open(): void {
    this.readyState = WebSocket.OPEN;
    for (const listener of this.openListeners) listener();
  }

  public json(value: unknown): void {
    const data = Buffer.from(JSON.stringify(value));
    for (const listener of this.messageListeners) listener(data, false);
  }

  public audio(value: Uint8Array): void {
    const data = Buffer.from(value);
    for (const listener of this.messageListeners) listener(data, true);
  }
}

describe('Deepgram realtime voice agent', () => {
  it('waits for the protocol handshake before streaming audio', () => {
    const socket = new FakeVoiceSocket();
    const ready = vi.fn();
    const agent = createAgent(socket, { onReadyChanged: ready });
    agent.start();
    socket.open();
    expect(socket.sent).toHaveLength(0);

    socket.json({ type: 'Welcome', request_id: 'session-1' });
    const settings = JSON.parse(String(socket.sent[0])) as Record<string, unknown>;
    expect(settings).toMatchObject({
      type: 'Settings',
      audio: {
        input: { encoding: 'linear16', sample_rate: 16_000 },
        output: { encoding: 'linear16', sample_rate: 24_000, container: 'none' },
      },
    });
    expect(agent.sendAudio(new Int16Array([1, 2]))).toBe(false);

    socket.json({ type: 'SettingsApplied' });
    expect(ready).toHaveBeenCalledWith(true);
    expect(agent.sendAudio(new Int16Array([1, 2]))).toBe(true);
    expect(socket.sent.at(-1)).toBeInstanceOf(Uint8Array);
    agent.dispose();
  });

  it('executes one client tool call once and returns correlated receipts', async () => {
    const socket = new FakeVoiceSocket();
    const invokeTool = vi.fn(async () => ({ phase: 'verifying_live', startAccepted: true }));
    const agent = createAgent(socket, { invokeTool });
    agent.start();
    socket.open();
    socket.json({ type: 'Welcome' });
    socket.json({ type: 'SettingsApplied' });
    const request = {
      type: 'FunctionCallRequest',
      functions: [
        {
          id: 'fc-1',
          name: 'live_session_auto_prepare_v1',
          arguments: JSON.stringify({
            categoryQuery: 'Sekiro',
            mode: 'live',
            startNow: true,
            countdownSeconds: 0,
          }),
          client_side: true,
        },
      ],
    };
    socket.json(request);
    await vi.waitFor(() => expect(invokeTool).toHaveBeenCalledTimes(1));
    socket.json(request);
    await vi.waitFor(() => {
      const responses = socket.sent
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => JSON.parse(entry) as { type?: string })
        .filter((entry) => entry.type === 'FunctionCallResponse');
      expect(responses).toHaveLength(2);
    });
    expect(invokeTool).toHaveBeenCalledTimes(1);
    agent.dispose();
  });

  it('stops playback on barge-in and publishes latency truth', () => {
    const socket = new FakeVoiceSocket();
    const onBargeIn = vi.fn();
    const onLatency = vi.fn();
    const onAudio = vi.fn();
    const agent = createAgent(socket, { onBargeIn, onLatency, onAudio });
    agent.start();
    socket.open();
    socket.json({ type: 'Welcome' });
    socket.json({ type: 'SettingsApplied' });
    socket.audio(new Uint8Array([1, 0, 2, 0]));
    socket.json({ type: 'UserStartedSpeaking' });
    socket.json({ type: 'LatencyReport', total_latency: 0.642 });
    expect(onAudio).toHaveBeenCalledWith(expect.any(Uint8Array), 24_000);
    expect(onBargeIn).toHaveBeenCalledOnce();
    expect(onLatency).toHaveBeenCalledWith(642);
    agent.dispose();
  });
});

function createAgent(
  socket: FakeVoiceSocket,
  overrides: Partial<ConstructorParameters<typeof DeepgramVoiceAgent>[0]> = {},
): DeepgramVoiceAgent {
  return new DeepgramVoiceAgent({
    apiKey: 'test-key',
    endpoint: 'wss://agent.deepgram.com/v1/agent/converse',
    listenModel: 'flux-general-en',
    thinkModel: 'gpt-4o-mini',
    voiceModel: 'aura-2-thalia-en',
    tools: [
      {
        modelName: 'live_session_auto_prepare_v1',
        description: 'Prepare and start a complete live production session.',
        parameters: { type: 'object' },
      },
    ],
    invokeTool: async () => ({ accepted: true }),
    onPhase: () => undefined,
    onReadyChanged: () => undefined,
    onAudio: () => undefined,
    onAudioDone: () => undefined,
    onBargeIn: () => undefined,
    createSocket: () => socket,
    ...overrides,
  });
}
