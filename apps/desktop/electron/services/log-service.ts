import type { LogEntry, LogLevel } from '@obscurpilot/contracts/observability';

const CAPACITY = 1_000;
const RANK: Readonly<Record<LogLevel, number>> = { debug: 0, info: 1, warn: 2, error: 3 };
const COLOR: Readonly<Record<LogLevel, string>> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

export interface LogServiceOptions {
  /** Lowest level printed to the terminal; the Logs page always receives everything. */
  readonly consoleLevel: LogLevel;
  /** Configured credential values, scrubbed from every line as a last line of defence. */
  readonly secrets: readonly (string | undefined)[];
  readonly onEntry: (entry: LogEntry) => void;
  readonly now?: () => Date;
}

/** Main-process log: a bounded ring for the Logs page, mirrored to the terminal. */
export class LogService {
  private readonly entries: LogEntry[] = [];
  private readonly lastTransition = new Map<string, string>();
  private readonly secrets: readonly string[];
  private readonly now: () => Date;
  private readonly color: boolean;
  private nextId = 1;

  public constructor(private readonly options: LogServiceOptions) {
    this.secrets = options.secrets.filter(
      (secret): secret is string => secret !== undefined && secret.length >= 6,
    );
    this.now = options.now ?? (() => new Date());
    this.color = process.stdout.isTTY === true || process.env.FORCE_COLOR !== undefined;
  }

  public debug(source: string, message: string, detail?: string): void {
    this.write('debug', source, message, detail);
  }

  public info(source: string, message: string, detail?: string): void {
    this.write('info', source, message, detail);
  }

  public warn(source: string, message: string, detail?: string): void {
    this.write('warn', source, message, detail);
  }

  public error(source: string, message: string, detail?: string): void {
    this.write('error', source, message, detail);
  }

  public write(level: LogLevel, source: string, message: string, detail?: string): void {
    const cleanDetail = detail === undefined ? undefined : this.clean(detail, 1_000);
    const entry: LogEntry = {
      id: this.nextId++,
      timestamp: this.now().toISOString(),
      level,
      source: this.clean(source, 32) || 'app',
      message: this.clean(message, 500) || '(empty)',
      ...(cleanDetail ? { detail: cleanDetail } : {}),
    };
    this.entries.push(entry);
    if (this.entries.length > CAPACITY) this.entries.shift();
    if (RANK[level] >= RANK[this.options.consoleLevel]) this.print(entry);
    this.options.onEntry(entry);
  }

  /** Logs a state-machine step once; repeats of the same phase and reason are dropped. */
  public transition(
    source: string,
    message: string,
    reasonCode: string,
    level: LogLevel = 'info',
  ): void {
    const key = `${message}|${reasonCode}`;
    if (this.lastTransition.get(source) === key) return;
    this.lastTransition.set(source, key);
    this.write(level, source, message, reasonCode);
  }

  public snapshot(): LogEntry[] {
    return [...this.entries];
  }

  public clear(): void {
    this.entries.length = 0;
  }

  private print(entry: LogEntry): void {
    const at = new Date(entry.timestamp);
    const pad = (value: number, size = 2) => String(value).padStart(size, '0');
    const time = `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}.${pad(at.getMilliseconds(), 3)}`;
    const level = entry.level.toUpperCase().padEnd(5);
    const source = entry.source.padEnd(10);
    const detail = entry.detail === undefined ? '' : ` - ${entry.detail}`;
    const line = this.color
      ? `${DIM}${time}${RESET} ${COLOR[entry.level]}${level}${RESET} ${source} ${entry.message}${DIM}${detail}${RESET}`
      : `${time} ${level} ${source} ${entry.message}${detail}`;
    if (entry.level === 'error') console.error(line);
    else if (entry.level === 'warn') console.warn(line);
    else process.stdout.write(line + '\n');
  }

  private clean(value: string, max: number): string {
    let text = '';
    for (const character of value.normalize('NFKC')) {
      const code = character.codePointAt(0) ?? 0;
      text += code < 32 || code === 127 ? ' ' : character;
    }
    for (const secret of this.secrets) text = text.replaceAll(secret, '[redacted]');
    return text.replace(/\s+/gu, ' ').trim().slice(0, max);
  }
}
