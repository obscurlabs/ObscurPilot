type AudioCommand =
  | { readonly kind: 'start'; readonly sessionId: string; readonly deviceId: string }
  | { readonly kind: 'stop'; readonly sessionId: string }
  | { readonly kind: 'cancel'; readonly sessionId: string }
  | { readonly kind: 'list-devices'; readonly requestId: string };

export {};

let stream: MediaStream | undefined;
let context: AudioContext | undefined;
let worklet: AudioWorkletNode | undefined;
let activeSessionId: string | undefined;
let captureGeneration = 0;

window.obscurPilotAudio.onCommand((raw) => {
  const command = raw as AudioCommand;
  if (command.kind === 'start') void start(command.sessionId, command.deviceId);
  if (command.kind === 'stop') void stop(command.sessionId, true);
  if (command.kind === 'cancel') void stop(command.sessionId, false);
  if (command.kind === 'list-devices') void listDevices(command.requestId);
});

async function start(sessionId: string, deviceId: string): Promise<void> {
  const generation = ++captureGeneration;
  activeSessionId = sessionId;
  await disposeResources();
  if (generation !== captureGeneration) return;
  try {
    const constraints: MediaTrackConstraints = {
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };
    if (deviceId !== 'default') constraints.deviceId = { exact: deviceId };
    const acquiredStream = await navigator.mediaDevices.getUserMedia({
      audio: constraints,
      video: false,
    });
    if (generation !== captureGeneration || activeSessionId !== sessionId) {
      for (const track of acquiredStream.getTracks()) track.stop();
      return;
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
      if (activeSessionId !== sessionId) return;
      window.obscurPilotAudio.emit({
        kind: 'samples',
        sessionId,
        samples: event.data.samples,
        level: event.data.level,
      });
    };
    for (const track of stream.getAudioTracks()) {
      track.addEventListener('ended', () => {
        if (activeSessionId === sessionId) {
          window.obscurPilotAudio.emit({
            kind: 'interrupted',
            sessionId,
            reasonCode: 'DEVICE_LOST',
          });
          void disposeCapture();
        }
      });
    }
    source.connect(worklet).connect(silent).connect(context.destination);
    await context.resume();
    if (generation === captureGeneration) {
      window.obscurPilotAudio.emit({ kind: 'started', sessionId });
    }
  } catch {
    if (generation !== captureGeneration) return;
    window.obscurPilotAudio.emit({ kind: 'interrupted', sessionId, reasonCode: 'CAPTURE_FAILED' });
    await disposeCapture();
  }
}

async function stop(sessionId: string, finalize: boolean): Promise<void> {
  if (activeSessionId !== sessionId) return;
  captureGeneration += 1;
  await disposeCapture();
  window.obscurPilotAudio.emit({ kind: finalize ? 'stopped' : 'cancelled', sessionId });
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
