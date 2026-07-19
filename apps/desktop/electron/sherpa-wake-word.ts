import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

interface SherpaStream {
  acceptWaveform(input: { readonly samples: Float32Array; readonly sampleRate: number }): void;
}

interface SherpaKeywordSpotter {
  createStream(): SherpaStream;
  isReady(stream: SherpaStream): boolean;
  decode(stream: SherpaStream): void;
  reset(stream: SherpaStream): void;
  getResult(stream: SherpaStream): { readonly keyword?: string };
}

interface SherpaModule {
  readonly KeywordSpotter: new (configuration: unknown) => SherpaKeywordSpotter;
}

export interface SherpaWakeWordOptions {
  readonly modelDirectory: string;
  readonly score: number;
  readonly threshold: number;
  readonly cooldownMs?: number;
  readonly now?: () => number;
  readonly loadModule?: () => SherpaModule;
}

const MODEL_FILES = {
  encoder: 'encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
  decoder: 'decoder-epoch-12-avg-2-chunk-16-left-64.onnx',
  joiner: 'joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
  tokens: 'tokens.txt',
  keywords: 'obscurpilot-keywords.txt',
} as const;

export class SherpaWakeWord {
  private readonly spotter: SherpaKeywordSpotter;
  private readonly stream: SherpaStream;
  private readonly now: () => number;
  private readonly cooldownMs: number;
  private lastDetectionAt = Number.NEGATIVE_INFINITY;

  public constructor(options: SherpaWakeWordOptions) {
    const paths = Object.fromEntries(
      Object.entries(MODEL_FILES).map(([name, file]) => [name, join(options.modelDirectory, file)]),
    ) as Record<keyof typeof MODEL_FILES, string>;
    for (const path of Object.values(paths)) {
      if (!existsSync(path)) throw new Error('WAKE_WORD_MODEL_INCOMPLETE');
    }
    this.now = options.now ?? Date.now;
    this.cooldownMs = options.cooldownMs ?? 2_000;
    const module = (options.loadModule ?? loadSherpa)();
    this.spotter = new module.KeywordSpotter({
      featConfig: { sampleRate: 16_000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: paths.encoder,
          decoder: paths.decoder,
          joiner: paths.joiner,
        },
        tokens: paths.tokens,
        numThreads: 1,
        provider: 'cpu',
        debug: 0,
      },
      maxActivePaths: 4,
      numTrailingBlanks: 1,
      keywordsScore: options.score,
      keywordsThreshold: options.threshold,
      keywordsFile: paths.keywords,
    });
    this.stream = this.spotter.createStream();
  }

  public accept(samples: Int16Array): boolean {
    if (samples.length === 0) return false;
    const waveform = new Float32Array(samples.length);
    for (let index = 0; index < samples.length; index += 1) {
      waveform[index] = (samples[index] ?? 0) / 0x8000;
    }
    this.stream.acceptWaveform({ samples: waveform, sampleRate: 16_000 });
    while (this.spotter.isReady(this.stream)) this.spotter.decode(this.stream);
    const keyword = this.spotter.getResult(this.stream).keyword?.trim() ?? '';
    if (keyword === '' || this.now() - this.lastDetectionAt < this.cooldownMs) return false;
    this.lastDetectionAt = this.now();
    this.spotter.reset(this.stream);
    return true;
  }
}

export class WakeWordAudioGate {
  private readonly buffered: Int16Array[] = [];
  private bufferedSamples = 0;

  public constructor(
    private readonly detector:
      { accept(samples: Int16Array): boolean | Promise<boolean> } | undefined,
    private readonly isConversationActive: () => boolean,
    private readonly onWake: () => void,
    private readonly downstream: (samples: Int16Array) => void,
    private readonly bufferLimitSamples = 32_000,
  ) {}

  public accept(samples: Int16Array): void {
    if (this.detector === undefined || this.isConversationActive()) {
      this.clear();
      this.downstream(samples);
      return;
    }
    const copy = samples.slice();
    this.buffered.push(copy);
    this.bufferedSamples += copy.length;
    while (this.bufferedSamples > this.bufferLimitSamples && this.buffered.length > 1) {
      this.bufferedSamples -= this.buffered.shift()?.length ?? 0;
    }
    const detection = this.detector.accept(samples);
    if (typeof detection === 'boolean') {
      if (detection) this.release();
      return;
    }
    void detection.then((detected) => {
      if (detected) this.release();
    });
  }

  private release(): void {
    this.onWake();
    for (const chunk of this.buffered) this.downstream(chunk);
    this.clear();
  }

  private clear(): void {
    this.buffered.length = 0;
    this.bufferedSamples = 0;
  }
}

function loadSherpa(): SherpaModule {
  const require = createRequire(__filename);
  return require('sherpa-onnx-node') as SherpaModule;
}
