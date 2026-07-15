# System Architecture

## 1. Runtime topology

```text
Global shortcut / audio device
          |
          v
Electron Main -----------------------------------------------------+
| NativeInput -> AudioSession -> Groq STT -> Intent Orchestrator   |
|                                      |                            |
|                              Policy + Tool Registry               |
|                                /              \                   |
|                          OBS Adapter       Twitch Adapter          |
|                                \              /                   |
|                         Event/State Coordinator -> Sync Outbox    |
|                                                       |           |
+---------------- typed IPC -----------------------------|-----------+
                         |                               v
                      Preload                        Supabase
                         |
                         v
React Renderer: stores, control board, health, timeline, orb, dialogs
```

### Electron main process

The main process is the composition root. It creates and disposes service instances, owns secrets, registers global shortcuts, manages the audio session, executes network SDK calls, maintains authoritative connection state, and publishes redacted projections to renderer windows.

Required hardening:

```ts
new BrowserWindow({
  webPreferences: {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
  },
});
```

Navigation, new-window creation, permission requests, and external URL opening are denied by default. Production content loads only packaged application assets. DevTools are disabled in production unless a signed diagnostic mode is activated.

### Preload process

Preload contains no domain logic. It maps explicit request methods and event subscriptions to IPC, validates returned payloads, and returns unsubscribe functions. It never exposes raw `ipcRenderer`, channel selection, filesystem paths, or generic invoke/send methods.

### React renderer

The renderer owns ephemeral presentation state only. TanStack Query may cache request results; a small Zustand store may hold connection projections, push-to-talk UI phase, and timeline cursors. Durable truth remains in the main process or Supabase. High-frequency visual state uses animation frames and refs rather than causing whole-tree React renders.

## 2. Proposed repository layout

```text
apps/desktop/
  electron/main.ts
  electron/preload.ts
  src/app/                  # React composition and routes
  src/components/           # shadcn-based presentation
packages/
  contracts/                # Zod schemas, IPC and tool types
  domain/                   # state machines, policies, use cases
  adapters-obs/
  adapters-twitch/
  adapters-groq/
  adapters-supabase/
  observability/
supabase/
  migrations/
  functions/                # token exchange/rotation where required
  seed.sql
tests/
  contract/ integration/ e2e/ chaos/ performance/
docs/
```

Use npm workspaces with one lockfile. Package dependency direction is `desktop -> adapters -> domain -> contracts`; contracts never import Electron or SDK packages.

## 3. Voice-to-action lifecycle

1. Main registers a user-configurable global push-to-talk accelerator and publishes readiness.
2. Press creates an `audioSessionId`, starts a bounded PCM capture/ring buffer, and signals `capturing`.
3. Release atomically stops capture. Audio shorter than the configured minimum is rejected locally; audio exceeding maximum duration is truncated and reported.
4. The Groq adapter uploads a supported encoded audio blob to `whisper-large-v3-turbo`, with an abort signal and request deadline.
5. The transcript is normalized but preserved for audit according to user privacy settings.
6. The orchestrator receives a system policy, current redacted state snapshot, transcript, and versioned tool schemas through an OpenAI-compatible request.
7. The model may propose tools but never executes them. The Tool Gateway validates schema, permission, resource existence, current state, risk level, rate limits, and idempotency key.
8. Safe operations execute; confirmation-required operations become pending intents with expiration and renderer approval.
9. Results are fed back into the bounded tool loop. Maximum turns, tools per turn, wall-clock time, and cumulative argument bytes are enforced.
10. A concise response is published to the renderer. The renderer may use `window.speechSynthesis`; speech is cancelled when a new capture starts.
11. Audit records and non-critical state changes enter the durable outbox asynchronously.

Default loop limits: 4 model turns, 6 tool calls, 15-second wall clock excluding explicit confirmation wait, 32 KiB cumulative arguments. These values are configuration with hard ceilings.

## 4. Core service interfaces

```ts
interface ManagedConnection<S, E> {
  start(signal: AbortSignal): Promise<void>;
  stop(): Promise<void>;
  snapshot(): Readonly<S>;
  subscribe(listener: (event: E) => void): () => void;
}

interface ToolDefinition<I, O> {
  readonly name: string;
  readonly version: number;
  readonly risk: 'observe' | 'reversible' | 'confirm';
  parse(input: unknown): I;
  authorize(ctx: ExecutionContext, input: I): Promise<void>;
  execute(ctx: ExecutionContext, input: I): Promise<O>;
}

interface DurableOutbox {
  enqueue(event: OutboxEvent): Promise<void>;
  flush(signal: AbortSignal): Promise<FlushResult>;
}
```

## 5. State ownership and synchronization

- OBS is authoritative for current OBS runtime state.
- Twitch is authoritative for Twitch resource state and incoming EventSub facts.
- Main process is authoritative for connectivity, active voice session, pending intent, and in-flight command state.
- Supabase is authoritative for durable user profiles, configurations, grants, device registrations, preferences, and historical audit data.
- Renderer projections are disposable caches.

On startup, render cached non-sensitive configuration immediately, authenticate Supabase, load durable configuration, connect OBS, initialize Twitch credentials, establish EventSub, then publish one monotonic `AppSnapshot`. Increment `snapshotVersion` for every main-owned state mutation. Renderer events carry the version; a gap triggers `state:get-snapshot` rather than attempting to infer missing state.

## 6. Process lifecycle

- A single-instance lock prevents duplicate hotkeys and command execution.
- Startup services are supervised independently; one degraded integration does not crash the app.
- Window closure unsubscribes all renderer listeners but does not leak service listeners.
- App shutdown disables new commands, aborts requests, stops capture, drains the outbox for at most two seconds, disconnects adapters, unregisters shortcuts, and exits.
- Unexpected renderer crashes do not terminate main-owned connections. A recreated renderer requests a fresh snapshot.
