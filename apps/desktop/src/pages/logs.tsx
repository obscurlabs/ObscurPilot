import type { LogEntry, LogLevel } from '@obscurpilot/contracts/observability';
import { useEffect, useMemo, useRef, useState } from 'react';

const MAX_ENTRIES = 1_000;
const RANK: Readonly<Record<LogLevel, number>> = { debug: 0, info: 1, warn: 2, error: 3 };
const LEVEL_FILTERS: ReadonlyArray<{ readonly value: LogLevel; readonly label: string }> = [
  { value: 'debug', label: 'Everything' },
  { value: 'info', label: 'Info and up' },
  { value: 'warn', label: 'Warnings and errors' },
  { value: 'error', label: 'Errors only' },
];

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function asText(entry: LogEntry): string {
  const detail = entry.detail === undefined ? '' : ` - ${entry.detail}`;
  return `${entry.timestamp} ${entry.level.toUpperCase()} [${entry.source}] ${entry.message}${detail}`;
}

export function LogsPage() {
  const [entries, setEntries] = useState<readonly LogEntry[]>([]);
  const [minimum, setMinimum] = useState<LogLevel>('info');
  const [source, setSource] = useState('all');
  const [query, setQuery] = useState('');
  const [follow, setFollow] = useState(true);
  const [notice, setNotice] = useState<string>();
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    let disposed = false;
    const pending: LogEntry[] = [];
    let loaded = false;
    const append = (incoming: readonly LogEntry[]) =>
      setEntries((current) => {
        const seen = new Set(current.map((entry) => entry.id));
        const merged = [...current, ...incoming.filter((entry) => !seen.has(entry.id))];
        return merged.slice(-MAX_ENTRIES);
      });
    // Entries can stream in before the initial snapshot lands; hold them, then merge by id.
    const off = window.obscurPilot.onLogEntry((entry) => {
      if (loaded) append([entry]);
      else pending.push(entry);
    });
    void window.obscurPilot.getLogs().then(({ entries: initial }) => {
      if (disposed) return;
      loaded = true;
      setEntries([]);
      append([...initial, ...pending]);
    });
    return () => {
      disposed = true;
      off();
    };
  }, []);

  const sources = useMemo(
    () => [...new Set(entries.map((entry) => entry.source))].sort(),
    [entries],
  );
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter(
      (entry) =>
        RANK[entry.level] >= RANK[minimum] &&
        (source === 'all' || entry.source === source) &&
        (needle === '' || asText(entry).toLowerCase().includes(needle)),
    );
  }, [entries, minimum, source, query]);
  const counts = useMemo(
    () => ({
      errors: entries.filter((entry) => entry.level === 'error').length,
      warnings: entries.filter((entry) => entry.level === 'warn').length,
    }),
    [entries],
  );

  useEffect(() => {
    const list = listRef.current;
    if (follow && list) list.scrollTop = list.scrollHeight;
  }, [visible, follow]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(visible.map(asText).join('\n'));
      setNotice(`Copied ${visible.length} lines`);
    } catch {
      setNotice('Clipboard is unavailable');
    }
  };
  const clear = async () => {
    await window.obscurPilot.clearLogs();
    setEntries([]);
    setNotice('Logs cleared');
  };

  return (
    <div className="op-page">
      <header className="op-page-head">
        <h1>Logs</h1>
        <p>
          What ObscurPilot is doing right now: connections, voice, the agent, and live sessions.
          The same lines print in the terminal that started the app.
        </p>
      </header>
      <section className="logs-panel" aria-label="Application logs">
        <div className="logs-toolbar">
          <label>
            <span>Show</span>
            <select value={minimum} onChange={(event) => setMinimum(event.target.value as LogLevel)}>
              {LEVEL_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Source</span>
            <select value={source} onChange={(event) => setSource(event.target.value)}>
              <option value="all">All sources</option>
              {sources.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="logs-search">
            <span>Search</span>
            <input
              type="search"
              value={query}
              placeholder="obs, refused, wispr..."
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="logs-actions">
            <label className="logs-follow">
              <input
                type="checkbox"
                checked={follow}
                onChange={(event) => setFollow(event.target.checked)}
              />
              Follow
            </label>
            <button className="secondary-button" type="button" onClick={() => void copy()}>
              Copy
            </button>
            <button className="secondary-button" type="button" onClick={() => void clear()}>
              Clear
            </button>
          </div>
        </div>
        <p className="logs-summary" role="status" aria-live="polite">
          {visible.length} of {entries.length} lines
          {counts.errors ? ` · ${counts.errors} errors` : ''}
          {counts.warnings ? ` · ${counts.warnings} warnings` : ''}
          {notice ? ` · ${notice}` : ''}
        </p>
        {visible.length === 0 ? (
          <div className="logs-empty">
            {entries.length === 0
              ? 'No log lines yet. They appear here as ObscurPilot connects and you use voice.'
              : 'No lines match these filters.'}
          </div>
        ) : (
          <ol
            className="logs-list"
            ref={listRef}
            onScroll={(event) => {
              const list = event.currentTarget;
              const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
              if (follow !== atBottom) setFollow(atBottom);
            }}
          >
            {visible.map((entry) => (
              <li key={entry.id} className="logs-row" data-level={entry.level}>
                <time dateTime={entry.timestamp}>{formatTime(entry.timestamp)}</time>
                <span className="logs-level">{entry.level}</span>
                <span className="logs-source">{entry.source}</span>
                <span className="logs-message">
                  {entry.message}
                  {entry.detail === undefined ? null : (
                    <span className="logs-detail">{entry.detail}</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
