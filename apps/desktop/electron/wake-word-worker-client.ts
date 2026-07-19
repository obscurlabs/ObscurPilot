import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import type { SherpaWakeWordOptions } from './sherpa-wake-word.js';

const WorkerEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ready') }).strict(),
  z
    .object({
      kind: z.literal('result'),
      id: z.number().int().positive(),
      detected: z.boolean(),
    })
    .strict(),
  z.object({ kind: z.literal('error'), reasonCode: z.string().min(1).max(96) }).strict(),
]);

export class SherpaWakeWordWorker {
  private static readonly BATCH_SAMPLES = 1_600;
  private readonly worker: Worker;
  private readonly pending = new Map<
    number,
    { resolve: (detected: boolean) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly readyPromise: Promise<void>;
  private resolveReady: (() => void) | undefined;
  private rejectReady: ((error: Error) => void) | undefined;
  private sequence = 0;
  private disposed = false;
  private queuedSamples: Int16Array[] = [];
  private queuedSampleCount = 0;

  public constructor(options: SherpaWakeWordOptions) {
    this.readyPromise = new Promise((resolvePromise, rejectPromise) => {
      this.resolveReady = resolvePromise;
      this.rejectReady = rejectPromise;
    });
    this.worker = new Worker(resolve(__dirname, 'wake-word-worker.cjs'), {
      workerData: {
        modelDirectory: options.modelDirectory,
        score: options.score,
        threshold: options.threshold,
        cooldownMs: options.cooldownMs ?? 2_000,
      },
    });
    // Native KWS teardown is best-effort. It must never keep Electron alive after
    // the control board closes, even if the native runtime is inside inference.
    this.worker.unref();
    this.worker.on('message', this.onMessage);
    this.worker.once('error', (error: unknown) =>
      this.fail(error instanceof Error ? error : new Error('WAKE_WORD_WORKER_ERROR')),
    );
    this.worker.once('exit', (code) => {
      if (!this.disposed && code !== 0) this.fail(new Error('Wake worker exited ' + code));
    });
  }

  public ready(): Promise<void> {
    return this.readyPromise;
  }

  public accept(samples: Int16Array): Promise<boolean> {
    if (this.disposed || samples.length === 0) return Promise.resolve(false);
    this.queuedSamples.push(samples.slice());
    this.queuedSampleCount += samples.length;
    if (this.queuedSampleCount < SherpaWakeWordWorker.BATCH_SAMPLES) {
      return Promise.resolve(false);
    }
    const copy = new Int16Array(this.queuedSampleCount);
    let offset = 0;
    for (const chunk of this.queuedSamples) {
      copy.set(chunk, offset);
      offset += chunk.length;
    }
    this.queuedSamples = [];
    this.queuedSampleCount = 0;
    const id = ++this.sequence;
    return new Promise((resolvePromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolvePromise(false);
      }, 1_000);
      timer.unref?.();
      this.pending.set(id, { resolve: resolvePromise, timer });
      this.worker.postMessage({ id, samples: copy.buffer }, [copy.buffer]);
    });
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.queuedSamples = [];
    this.queuedSampleCount = 0;
    this.worker.off('message', this.onMessage);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve(false);
    }
    this.pending.clear();
    void this.worker.terminate().catch(() => undefined);
  }

  private readonly onMessage = (raw: unknown): void => {
    const event = WorkerEventSchema.safeParse(raw);
    if (!event.success) return;
    if (event.data.kind === 'ready') {
      this.resolveReady?.();
      this.resolveReady = undefined;
      this.rejectReady = undefined;
      return;
    }
    if (event.data.kind === 'error') {
      this.fail(new Error(event.data.reasonCode));
      return;
    }
    const pending = this.pending.get(event.data.id);
    if (pending === undefined) return;
    clearTimeout(pending.timer);
    this.pending.delete(event.data.id);
    pending.resolve(event.data.detected);
  };

  private fail(error: Error): void {
    this.rejectReady?.(error);
    this.resolveReady = undefined;
    this.rejectReady = undefined;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve(false);
    }
    this.pending.clear();
  }
}
