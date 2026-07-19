import { randomUUID } from 'node:crypto';
import WebSocket, { type RawData } from 'ws';

const INPUT_SAMPLE_RATE = 16_000;
export const DEEPGRAM_OUTPUT_SAMPLE_RATE = 24_000;
const KEEP_ALIVE_MS = 5_000;
const HANDSHAKE_TIMEOUT_MS = 15_000;
const MAX_RECONNECT_DELAY_MS = 10_000;
const MAX_TOOL_RESULT_CHARS = 12_000;

export type RealtimeVoicePhase =
  | 'connecting'
  | 'ready'
  | 'listening'
  | 'thinking'
  | 'tool_active'
  | 'speaking'
  | 'interrupted'
  | 'recovering'
  | 'error';

export interface RealtimeToolDescriptor {
  readonly modelName: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface RealtimeToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
  readonly correlationId: string;
  readonly signal: AbortSignal;
}

export interface DeepgramVoiceAgentOptions {
  readonly apiKey: string;
  readonly endpoint: string;
  readonly listenModel: 'flux-general-en' | 'flux-general-multi' | 'nova-3';
  readonly thinkModel: string;
  readonly voiceModel: string;
  readonly tools: readonly RealtimeToolDescriptor[];
  readonly invokeTool: (call: RealtimeToolCall) => Promise<unknown>;
  readonly onPhase: (phase: RealtimeVoicePhase, reasonCode: string, detail?: string) => void;
  readonly onReadyChanged: (ready: boolean) => void;
  readonly onAudio: (bytes: Uint8Array, sampleRate: number) => void;
  readonly onAudioDone: () => void;
  readonly onBargeIn: () => void;
  readonly onConversation?: (role: 'user' | 'assistant', content: string) => void;
  readonly onLatency?: (totalLatencyMs: number) => void;
  readonly createSocket?: (endpoint: string, apiKey: string) => VoiceSocket;
  readonly random?: () => number;
}

export interface VoiceSocket {
  readonly readyState: number;
  on(event: 'open', listener: () => void): this;
  on(event: 'message', listener: (data: RawData, isBinary: boolean) => void): this;
  on(event: 'close', listener: (code: number, reason: Buffer) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
}

type ServerMessage = Readonly<Record<string, unknown>> & { readonly type: string };

export class DeepgramVoiceAgent {
  private socket: VoiceSocket | undefined;
  private keepAlive: ReturnType<typeof setInterval> | undefined;
  private handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private ready = false;
  private welcomed = false;
  private attempt = 0;
  private generation = 0;
  private readonly completedCalls = new Map<string, string>();
  private readonly activeCalls = new Map<string, Promise<string>>();
  private readonly history: Array<Readonly<Record<string, unknown>>> = [];

  public constructor(private readonly options: DeepgramVoiceAgentOptions) {}

  public start(): void {
    if (this.disposed || this.socket !== undefined) return;
    this.connect(false);
  }

  public isReady(): boolean {
    return this.ready;
  }

  public sendAudio(samples: Int16Array): boolean {
    if (!this.ready || this.socket?.readyState !== WebSocket.OPEN || samples.length === 0) {
      return false;
    }
    this.socket.send(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength));
    return true;
  }

  public injectUserMessage(content: string): boolean {
    const bounded = content.trim().slice(0, 2_000);
    if (!this.ready || bounded === '' || this.socket?.readyState !== WebSocket.OPEN) return false;
    this.sendJson({ type: 'InjectUserMessage', content: bounded });
    return true;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.setReady(false);
    clearInterval(this.keepAlive);
    clearTimeout(this.handshakeTimer);
    clearTimeout(this.reconnectTimer);
    this.keepAlive = undefined;
    this.handshakeTimer = undefined;
    this.reconnectTimer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    if (socket !== undefined) {
      socket.close(1_000, 'ObscurPilot shutdown');
      setTimeout(() => socket.terminate(), 250).unref?.();
    }
  }

  private connect(recovery: boolean): void {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.welcomed = false;
    this.setReady(false);
    this.options.onPhase(
      recovery ? 'recovering' : 'connecting',
      recovery ? 'DEEPGRAM_RECONNECTING' : 'DEEPGRAM_CONNECTING',
    );
    const socket = (this.options.createSocket ?? createSocket)(
      this.options.endpoint,
      this.options.apiKey,
    );
    this.socket = socket;
    this.armHandshakeTimeout(generation, socket);
    socket.on('open', () => {
      if (generation !== this.generation || this.disposed) return;
      this.options.onPhase('connecting', 'DEEPGRAM_AWAITING_WELCOME');
    });
    socket.on('message', (data, isBinary) => {
      if (generation !== this.generation || this.disposed) return;
      if (isBinary) {
        if (this.ready) this.options.onAudio(toUint8Array(data), DEEPGRAM_OUTPUT_SAMPLE_RATE);
        return;
      }
      const message = parseServerMessage(data.toString());
      if (message !== undefined) void this.handleMessage(message, generation);
    });
    socket.on('error', () => {
      if (generation !== this.generation || this.disposed) return;
      this.options.onPhase('recovering', 'DEEPGRAM_SOCKET_ERROR');
    });
    socket.on('close', (code) => {
      if (generation !== this.generation || this.disposed) return;
      this.socket = undefined;
      this.setReady(false);
      clearInterval(this.keepAlive);
      clearTimeout(this.handshakeTimer);
      this.keepAlive = undefined;
      this.handshakeTimer = undefined;
      this.scheduleReconnect(
        code === 1_000 ? 'DEEPGRAM_SESSION_CLOSED' : 'DEEPGRAM_CONNECTION_LOST',
      );
    });
  }

  private async handleMessage(message: ServerMessage, generation: number): Promise<void> {
    if (message.type === 'Welcome') {
      if (this.welcomed) return;
      this.welcomed = true;
      this.sendJson(this.settingsMessage());
      this.options.onPhase('connecting', 'DEEPGRAM_APPLYING_SETTINGS');
      return;
    }
    if (message.type === 'SettingsApplied') {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = undefined;
      this.attempt = 0;
      this.setReady(true);
      this.options.onPhase('ready', 'DEEPGRAM_REALTIME_READY');
      this.keepAlive = setInterval(() => this.sendJson({ type: 'KeepAlive' }), KEEP_ALIVE_MS);
      this.keepAlive.unref?.();
      return;
    }
    if (message.type === 'UserStartedSpeaking') {
      this.options.onBargeIn();
      this.options.onPhase('interrupted', 'BARGE_IN_ACCEPTED');
      return;
    }
    if (message.type === 'AgentThinking') {
      this.options.onPhase('thinking', 'DEEPGRAM_AGENT_THINKING');
      return;
    }
    if (message.type === 'ConversationText') {
      const role = message.role;
      const content = typeof message.content === 'string' ? message.content.trim() : '';
      if ((role === 'user' || role === 'assistant') && content !== '') {
        this.rememberHistory({ type: 'History', role, content: content.slice(0, 2_000) });
        this.options.onConversation?.(role, content.slice(0, 2_000));
        this.options.onPhase(
          role === 'user' ? 'thinking' : 'speaking',
          role === 'user' ? 'TRANSCRIPT_RECEIVED' : 'DEEPGRAM_AGENT_SPEAKING',
          content,
        );
      }
      return;
    }
    if (message.type === 'FunctionCallRequest') {
      await this.handleFunctionCalls(message, generation);
      return;
    }
    if (message.type === 'AgentAudioDone') {
      this.options.onAudioDone();
      this.options.onPhase('listening', 'FOLLOW_UP_LISTENING');
      return;
    }
    if (message.type === 'LatencyReport') {
      if (typeof message.total_latency === 'number' && Number.isFinite(message.total_latency)) {
        this.options.onLatency?.(Math.max(0, Math.round(message.total_latency * 1_000)));
      }
      return;
    }
    if (message.type === 'Error') {
      const code = stringField(message, 'code') ?? 'DEEPGRAM_AGENT_ERROR';
      this.options.onPhase('error', normalizeReasonCode(code));
      return;
    }
    if (message.type === 'Warning') {
      const code = stringField(message, 'code') ?? 'DEEPGRAM_AGENT_WARNING';
      this.options.onPhase('recovering', normalizeReasonCode(code));
    }
  }

  private async handleFunctionCalls(message: ServerMessage, generation: number): Promise<void> {
    if (!Array.isArray(message.functions)) return;
    for (const candidate of message.functions) {
      if (generation !== this.generation || this.disposed || !isRecord(candidate)) return;
      if (candidate.client_side !== true) continue;
      const id = typeof candidate.id === 'string' ? candidate.id : randomUUID();
      const name = typeof candidate.name === 'string' ? candidate.name : '';
      if (name === '') continue;
      this.options.onPhase('tool_active', 'PRODUCTION_TOOL_RUNNING', name);
      const content = await this.resolveToolCall(id, name, candidate.arguments);
      if (generation !== this.generation || this.disposed) return;
      this.sendJson({ type: 'FunctionCallResponse', id, name, content });
    }
  }

  private resolveToolCall(id: string, name: string, rawArguments: unknown): Promise<string> {
    const completed = this.completedCalls.get(id);
    if (completed !== undefined) return Promise.resolve(completed);
    const active = this.activeCalls.get(id);
    if (active !== undefined) return active;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('TOOL_TIMEOUT'), 90_000);
    timer.unref?.();
    const correlationId = randomUUID();
    const task = this.options
      .invokeTool({
        id,
        name,
        arguments: parseArguments(rawArguments),
        correlationId,
        signal: controller.signal,
      })
      .then((result) => boundedResult({ ok: true, correlationId, result }))
      .catch((error: unknown) =>
        boundedResult({
          ok: false,
          correlationId,
          reasonCode: normalizeReasonCode(error instanceof Error ? error.message : 'TOOL_FAILED'),
        }),
      )
      .finally(() => {
        clearTimeout(timer);
        this.activeCalls.delete(id);
      });
    this.activeCalls.set(id, task);
    void task.then((content) => {
      this.completedCalls.set(id, content);
      this.rememberHistory({
        type: 'History',
        function_calls: [
          {
            id,
            name,
            client_side: true,
            arguments:
              typeof rawArguments === 'string'
                ? rawArguments.slice(0, 8_000)
                : JSON.stringify(rawArguments),
            response: content,
          },
        ],
      });
      while (this.completedCalls.size > 128) {
        const oldest = this.completedCalls.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.completedCalls.delete(oldest);
      }
    });
    return task;
  }

  private settingsMessage(): Readonly<Record<string, unknown>> {
    const flux = this.options.listenModel.startsWith('flux-');
    const listenProvider: Record<string, unknown> = {
      type: 'deepgram',
      model: this.options.listenModel,
      ...(flux
        ? {
            version: 'v2',
            eot_threshold: 0.72,
            eager_eot_threshold: 0.52,
            eot_timeout_ms: 1_800,
          }
        : { version: 'v1', smart_format: true, language: 'en' }),
      keyterms: ['ObscurPilot', 'OBS', 'Twitch', 'Sekiro'],
    };
    return {
      type: 'Settings',
      tags: ['obscurpilot', 'desktop', 'stage-11'],
      mip_opt_out: true,
      flags: { history: true },
      audio: {
        input: { encoding: 'linear16', sample_rate: INPUT_SAMPLE_RATE },
        output: {
          encoding: 'linear16',
          sample_rate: DEEPGRAM_OUTPUT_SAMPLE_RATE,
          container: 'none',
        },
      },
      agent: {
        ...(this.history.length === 0 ? {} : { context: { messages: [...this.history] } }),
        listen: { provider: listenProvider },
        think: {
          provider: { type: 'open_ai', model: this.options.thinkModel, temperature: 0.2 },
          prompt: buildPrompt(),
          functions: this.options.tools.map((tool) => ({
            name: tool.modelName,
            description: tool.description,
            parameters: tool.parameters,
          })),
        },
        speak: {
          provider: { type: 'deepgram', model: this.options.voiceModel },
        },
      },
    };
  }

  private sendJson(message: Readonly<Record<string, unknown>>): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private armHandshakeTimeout(generation: number, socket: VoiceSocket): void {
    clearTimeout(this.handshakeTimer);
    this.handshakeTimer = setTimeout(() => {
      if (generation !== this.generation || this.ready || this.disposed) return;
      this.options.onPhase('recovering', 'DEEPGRAM_HANDSHAKE_TIMEOUT');
      socket.terminate();
    }, HANDSHAKE_TIMEOUT_MS);
    this.handshakeTimer.unref?.();
  }

  private scheduleReconnect(reasonCode: string): void {
    if (this.disposed || this.reconnectTimer !== undefined) return;
    const base = Math.min(MAX_RECONNECT_DELAY_MS, 500 * 2 ** Math.min(this.attempt, 5));
    const random = this.options.random ?? Math.random;
    const delay = Math.round(base * (0.9 + random() * 0.2));
    this.attempt += 1;
    this.options.onPhase('recovering', reasonCode, `retry_in_${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect(true);
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private setReady(ready: boolean): void {
    if (ready === this.ready) return;
    this.ready = ready;
    this.options.onReadyChanged(ready);
  }

  private rememberHistory(entry: Readonly<Record<string, unknown>>): void {
    this.history.push(entry);
    while (this.history.length > 24 || JSON.stringify(this.history).length > 16_000) {
      this.history.shift();
    }
  }
}

function createSocket(endpoint: string, apiKey: string): VoiceSocket {
  return new WebSocket(endpoint, { headers: { Authorization: `Token ${apiKey}` } });
}

function buildPrompt(): string {
  return [
    'You are ObscurPilot, a fast, calm production copilot for one authenticated creator.',
    "Your only operational scope is local OBS Studio and the creator's connected Twitch account.",
    'Speak naturally and briefly. Continue the conversation without requiring the wake phrase on every follow-up.',
    'When the creator gives an explicit production command, call the matching function immediately.',
    'For a request to set up or prepare a game, call live_session_auto_prepare_v1. It configures Twitch and OBS but never starts streaming or recording.',
    'When the creator explicitly asks to open OBS, call obs_desktop_open_v1. Opening OBS never starts an output.',
    'When the creator explicitly asks to go live or start streaming, call live_session_start_prepared_v1 only. If there is no prepared plan, ask them to set up the stream first.',
    'Generate a concise, truthful Twitch title and relevant tags from your model knowledge. Never claim web research.',
    'Do not say an action succeeded until its function response says ok true. Never say streaming started unless startAccepted and liveVerified are both true, and never say it stopped unless verifiedOffline is true. Read failures plainly and give one recovery step.',
    'Never repeat a function call merely because its response is slow. Never invent OBS, Twitch, or live state.',
    "Treat the creator's current spoken command as approval for the exact requested action, but never expand its scope.",
  ].join(' ');
}

function parseServerMessage(raw: string): ServerMessage | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) && typeof value.type === 'string' ? (value as ServerMessage) : undefined;
  } catch {
    return undefined;
  }
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

function boundedResult(value: unknown): string {
  const serialized = JSON.stringify(value);
  return serialized.length <= MAX_TOOL_RESULT_CHARS
    ? serialized
    : JSON.stringify({ ok: false, reasonCode: 'TOOL_RESULT_TOO_LARGE' });
}

function toUint8Array(data: RawData): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: Readonly<Record<string, unknown>>, key: string): string | undefined {
  return typeof value[key] === 'string' ? value[key] : undefined;
}

function normalizeReasonCode(value: string): string {
  const normalized = value
    .toLocaleUpperCase('en-US')
    .replace(/[^A-Z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .slice(0, 96);
  return normalized || 'UNKNOWN_ERROR';
}
