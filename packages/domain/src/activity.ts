export interface ActivityInput {
  readonly id: string;
  readonly occurredAt: string;
  readonly source: string;
  readonly type: string;
  readonly summary: string;
  readonly severity?: 'info' | 'warning' | 'error';
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface NormalizedActivity extends ActivityInput {
  readonly schemaVersion: 1;
  readonly severity: 'info' | 'warning' | 'error';
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

export function normalizeActivity(input: ActivityInput): NormalizedActivity {
  const metadataEntries = Object.entries(input.metadata ?? {}).slice(0, 16);
  return Object.freeze({
    ...input,
    schemaVersion: 1,
    source: input.source.slice(0, 64),
    type: input.type.slice(0, 64),
    summary: input.summary.slice(0, 500),
    severity: input.severity ?? 'info',
    metadata: Object.freeze(Object.fromEntries(metadataEntries)),
  });
}
