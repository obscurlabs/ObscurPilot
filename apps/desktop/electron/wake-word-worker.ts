import { parentPort, workerData } from 'node:worker_threads';
import { z } from 'zod';
import { SherpaWakeWord } from './sherpa-wake-word.js';

const ConfigurationSchema = z
  .object({
    modelDirectory: z.string().min(1),
    score: z.number().min(0.1).max(10),
    threshold: z.number().min(0.05).max(0.95),
    cooldownMs: z.number().int().min(250).max(10_000),
  })
  .strict();
const MessageSchema = z
  .object({
    id: z.number().int().positive(),
    samples: z.instanceof(ArrayBuffer),
  })
  .strict();

if (parentPort === null) throw new Error('WAKE_WORD_WORKER_PORT_REQUIRED');
const port = parentPort;

try {
  const detector = new SherpaWakeWord(ConfigurationSchema.parse(workerData));
  port.postMessage({ kind: 'ready' });
  port.on('message', (raw: unknown) => {
    const message = MessageSchema.safeParse(raw);
    if (!message.success) return;
    try {
      const detected = detector.accept(new Int16Array(message.data.samples));
      port.postMessage({ kind: 'result', id: message.data.id, detected });
    } catch {
      port.postMessage({ kind: 'result', id: message.data.id, detected: false });
    }
  });
} catch {
  port.postMessage({ kind: 'error', reasonCode: 'WAKE_WORD_MODEL_INITIALIZATION_FAILED' });
}
