type AudioCommand =
  | { readonly kind: 'start'; readonly sessionId: string; readonly deviceId: string }
  | { readonly kind: 'stop'; readonly sessionId: string }
  | { readonly kind: 'cancel'; readonly sessionId: string }
  | { readonly kind: 'list-devices'; readonly requestId: string }
  | {
      readonly kind: 'monitor-start';
      readonly deviceId: string;
      readonly speechThreshold: number;
      readonly silenceReleaseMs: number;
    }
  | { readonly kind: 'monitor-stop' }
  | { readonly kind: 'suppress'; readonly suppressed: boolean };

export {};

let stream: MediaStream | undefined;
let context: AudioContext | undefined;
let worklet: AudioWorkletNode | undefined;
let activeSessionId: string | undefined;
let captureGeneration = 0;
let monitorActive = false;
let suppressed = false;
let speechThreshold = 0.018;
let silenceReleaseMs = 850;
let lastSpeechAt = 0;
let speechStartedAt = 0;
let preRoll: Float32Array[] = [];
let preRollSamples = 0;
const PRE_ROLL_LIMIT = 4_800;
const MAX_UTTERANCE_MS = 30_000;

window.obscurPilotAudio.onCommand((raw) => {
  const command = raw as AudioCommand;
  if (command.kind === 'start') void startManual(command.sessionId, command.deviceId);
  if (command.kind === 'stop') void stopManual(command.sessionId, true);
  if (command.kind === 'cancel') void stopManual(command.sessionId, false);
  if (command.kind === 'list-devices') void listDevices(command.requestId);
  if (command.kind === 'monitor-start') {
    speechThreshold = command.speechThreshold;
    silenceReleaseMs = command.silenceReleaseMs;
    void startMonitor(command.deviceId);
  }
  if (command.kind === 'monitor-stop') void stopMonitor();
  if (command.kind === 'suppress') {
    suppressed = command.suppressed;
    if (suppressed) finishUtterance();
  }
});

async function startManual(sessionId: string, deviceId: string): Promise<void> {
  monitorActive = false;
  activeSessionId = sessionId;
  const generation = ++captureGeneration;
  const ready = await acquire(deviceId, generation, (samples, level) => {
    if (activeSessionId !== sessionId) return;
    window.obscurPilotAudio.emit({ kind: 'samples', sessionId, samples, level });
  });
  if (ready && generation === captureGeneration) {
    window.obscurPilotAudio.emit({ kind: 'started', sessionId });
  }
}

async function startMonitor(deviceId: string): Promise<void> {
  monitorActive = true;
  activeSessionId = undefined;
  suppressed = false;
  resetVad();
  const generation = ++captureGeneration;
  const ready = await acquire(deviceId, generation, processVad);
  if (ready && generation === captureGeneration && monitorActive) {
    window.obscurPilotAudio.emit({ kind: 'monitoring' });
  }
}

async function acquire(
  deviceId: string,
  generation: number,
  onSamples: (samples: Float32Array, level: number) => void,
): Promise<boolean> {
  await disposeResources();
  if (generation !== captureGeneration) return false;
  try {
    const constraints: MediaTrackConstraints = {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    if (deviceId !== 'default') constraints.deviceId = { exact: deviceId };
    const acquiredStream = await navigator.mediaDevices.getUserMedia({
      audio: constraints,
      video: false,
    });
    if (generation !== captureGeneration) {
      for (const track of acquiredStream.getTracks()) track.stop();
      return false;
    }
    stream = acquiredStream;
    context = new AudioContext({ latencyHint: 'interactive' });
    await context.audioWorklet.addModule('./audio-worklet.js');
    const source = context.createMediaStreamSource(stream);
    worklet = new AudioWorkletNode(context, 'obscurpilot-capture', {
      processorOptions: { targetSampleRate: 16_000 },
    });
    const silent = context.createGain();
    silent.gain.value = 0;
    worklet.port.onmessage = (event: MessageEvent<{ samples: Float32Array; level: number }>) => {
      if (generation === captureGeneration) onSamples(event.data.samples, event.data.level);
    };
    for (const track of stream.getAudioTracks()) {
      track.addEventListener('ended', () => {
        if (generation !== captureGeneration) return;
        if (activeSessionId !== undefined) {
          window.obscurPilotAudio.emit({
            kind: 'interrupted',
            sessionId: activeSessionId,
            reasonCode: 'DEVICE_LOST',
          });
        }
        void disposeCapture();
      });
    }
    source.connect(worklet).connect(silent).connect(context.destination);
    await context.resume();
    return generation === captureGeneration;
  } catch {
    if (generation !== captureGeneration) return false;
    if (activeSessionId !== undefined) {
      window.obscurPilotAudio.emit({
        kind: 'interrupted',
        sessionId: activeSessionId,
        reasonCode: 'CAPTURE_FAILED',
      });
    }
    await disposeCapture();
    return false;
  }
}

function processVad(samples: Float32Array, level: number): void {
  if (!monitorActive || suppressed) return;
  const now = performance.now();
  if (activeSessionId === undefined) {
    rememberPreRoll(samples);
    if (level < speechThreshold) return;
    activeSessionId = crypto.randomUUID();
    speechStartedAt = now;
    lastSpeechAt = now;
    window.obscurPilotAudio.emit({ kind: 'utterance-started', sessionId: activeSessionId });
    for (const chunk of preRoll) {
      window.obscurPilotAudio.emit({
        kind: 'samples',
        sessionId: activeSessionId,
        samples: chunk,
        level,
      });
    }
    preRoll = [];
    preRollSamples = 0;
  }
  const sessionId = activeSessionId;
  window.obscurPilotAudio.emit({ kind: 'samples', sessionId, samples, level });
  if (level >= speechThreshold) lastSpeechAt = now;
  if (now - lastSpeechAt >= silenceReleaseMs || now - speechStartedAt >= MAX_UTTERANCE_MS) {
    finishUtterance();
  }
}

function rememberPreRoll(samples: Float32Array): void {
  const copy = samples.slice();
  preRoll.push(copy);
  preRollSamples += copy.length;
  while (preRollSamples > PRE_ROLL_LIMIT && preRoll.length > 1) {
    preRollSamples -= preRoll.shift()?.length ?? 0;
  }
}

function finishUtterance(): void {
  const sessionId = activeSessionId;
  if (sessionId === undefined || !monitorActive) return;
  activeSessionId = undefined;
  window.obscurPilotAudio.emit({ kind: 'utterance-stopped', sessionId });
  resetVad();
}

function resetVad(): void {
  preRoll = [];
  preRollSamples = 0;
  lastSpeechAt = 0;
  speechStartedAt = 0;
}

async function stopManual(sessionId: string, finalize: boolean): Promise<void> {
  if (activeSessionId !== sessionId) return;
  captureGeneration += 1;
  await disposeCapture();
  window.obscurPilotAudio.emit({ kind: finalize ? 'stopped' : 'cancelled', sessionId });
}

async function stopMonitor(): Promise<void> {
  if (!monitorActive) return;
  finishUtterance();
  monitorActive = false;
  captureGeneration += 1;
  await disposeCapture();
  window.obscurPilotAudio.emit({ kind: 'monitor-stopped' });
}

async function listDevices(requestId: string): Promise<void> {
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices())
      .filter((device) => device.kind === 'audioinput')
      .map((device) => ({
        deviceId: device.deviceId,
        label: device.label || 'Microphone',
        isDefault: device.deviceId === 'default',
      }));
    window.obscurPilotAudio.emit({ kind: 'devices', requestId, devices });
  } catch {
    window.obscurPilotAudio.emit({ kind: 'devices', requestId, devices: [] });
  }
}

async function disposeCapture(): Promise<void> {
  activeSessionId = undefined;
  resetVad();
  await disposeResources();
}

async function disposeResources(): Promise<void> {
  worklet?.disconnect();
  worklet = undefined;
  for (const track of stream?.getTracks() ?? []) track.stop();
  stream = undefined;
  if (context !== undefined) await context.close().catch(() => undefined);
  context = undefined;
}
