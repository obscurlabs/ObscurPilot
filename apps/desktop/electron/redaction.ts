const REDACTED = '[REDACTED]';
const MAX_TEXT_LENGTH = 8_192;
const MAX_DEPTH = 8;
const MAX_COLLECTION_SIZE = 100;

const SENSITIVE_FIELD =
  /(?:authorization|cookie|password|passphrase|secret|private.?key|api.?key|access.?token|refresh.?token|client.?secret|service.?role|oauth.?code|encryption.?key)/iu;

export function redactText(input: string): string {
  const bounded = input.slice(0, MAX_TEXT_LENGTH);
  const redacted = bounded
    .replace(/\b(Bearer|Token|OAuth)\s+[A-Za-z0-9._~+\-/=]{8,}/giu, '$1 ' + REDACTED)
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu, REDACTED)
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}\b/giu, REDACTED)
    .replace(
      /([?&](?:code|state|token|access_token|refresh_token|password|secret|key)=)[^&#\s]+/giu,
      '$1' + REDACTED,
    )
    .replace(
      /\b([A-Z][A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|PASSPHRASE)[A-Z0-9_]*)\s*=\s*([^\s,;]+)/gu,
      '$1=' + REDACTED,
    );
  return replaceControlCharacters(redacted);
}

function replaceControlCharacters(value: string): string {
  let result = '';
  for (const character of value) {
    const code = character.charCodeAt(0);
    result +=
      (code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f
        ? ' '
        : character;
  }
  return result;
}

export function redactSensitive(value: unknown): unknown {
  return redactValue(value, 0, new WeakSet<object>());
}

export function safeErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  return redactText(
    error instanceof Error ? error.message : typeof error === 'string' ? error : fallback,
  );
}

export function secureLogError(message: string, ...details: readonly unknown[]): void {
  console.error(redactText(message), ...details.map((detail) => redactSensitive(detail)));
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactText(value);
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'undefined'
  ) {
    return value;
  }
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    return String(value);
  }
  if (value instanceof Error) {
    return {
      name: redactText(value.name),
      message: safeErrorMessage(value),
      ...(value.stack === undefined ? {} : { stack: redactText(value.stack) }),
    };
  }
  if (value instanceof Date)
    return Number.isNaN(value.valueOf()) ? 'Invalid Date' : value.toISOString();
  if (depth >= MAX_DEPTH) return '[MAX_DEPTH]';
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, MAX_COLLECTION_SIZE).map((item) => redactValue(item, depth + 1, seen));
  }

  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, child] of Object.entries(value).slice(0, MAX_COLLECTION_SIZE)) {
    result[key] = SENSITIVE_FIELD.test(key) ? REDACTED : redactValue(child, depth + 1, seen);
  }
  return result;
}
