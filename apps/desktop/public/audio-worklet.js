/* global AudioWorkletProcessor, sampleRate, registerProcessor */

class ObscurPilotCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = options.processorOptions.targetSampleRate || 16000;
    this.pending = [];
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    const ratio = sampleRate / this.targetRate;
    for (let outputIndex = 0; outputIndex * ratio < input.length; outputIndex += 1) {
      const start = Math.floor(outputIndex * ratio);
      const end = Math.max(start + 1, Math.floor((outputIndex + 1) * ratio));
      let sum = 0;
      for (let index = start; index < Math.min(end, input.length); index += 1) sum += input[index];
      this.pending.push(sum / Math.max(1, Math.min(end, input.length) - start));
    }
    if (this.pending.length >= 2048) {
      const samples = Float32Array.from(this.pending.splice(0, 2048));
      let energy = 0;
      for (const value of samples) energy += value * value;
      this.port.postMessage(
        { samples, level: Math.min(1, Math.sqrt(energy / samples.length) * 4) },
        [samples.buffer],
      );
    }
    return true;
  }
}

registerProcessor('obscurpilot-capture', ObscurPilotCaptureProcessor);
