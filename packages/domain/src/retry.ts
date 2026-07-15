export interface Clock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface BackoffPolicy {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly maxAttempts: number;
}

export const DEFAULT_BACKOFF_POLICY: BackoffPolicy = {
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  maxAttempts: 8,
};

export function computeFullJitterDelay(
  attempt: number,
  random: () => number,
  policy: BackoffPolicy = DEFAULT_BACKOFF_POLICY,
): number {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new RangeError('attempt must be a non-negative integer');
  }
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new RangeError('random must return a value in [0, 1)');
  }
  const cap = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
  return Math.floor(sample * (cap + 1));
}

export function sleepWithSignal(
  delayMs: number,
  signal: AbortSignal,
  clock: Clock = systemClock,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clock.clearTimeout(handle);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    const handle = clock.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
