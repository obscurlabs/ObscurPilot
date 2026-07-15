type LedgerEntry =
  | { readonly status: 'pending'; readonly expiresAt: number; readonly promise: Promise<unknown> }
  | { readonly status: 'completed'; readonly expiresAt: number; readonly value: unknown };

export class CommandLedger {
  private readonly entries = new Map<string, LedgerEntry>();

  public constructor(
    private readonly ttlMs = 24 * 60 * 60 * 1000,
    private readonly maxEntries = 10_000,
  ) {}

  public executeOnce<T>(
    semanticKey: string,
    operation: () => Promise<T>,
    now = Date.now(),
  ): Promise<T> {
    this.prune(now);
    const existing = this.entries.get(semanticKey);
    if (existing?.status === 'pending') return existing.promise as Promise<T>;
    if (existing?.status === 'completed') return Promise.resolve(existing.value as T);
    if (this.entries.size >= this.maxEntries) {
      throw new Error('Command ledger capacity reached');
    }

    const expiresAt = now + this.ttlMs;
    const promise = operation()
      .then((value) => {
        this.entries.set(semanticKey, { status: 'completed', expiresAt, value });
        return value;
      })
      .catch((error: unknown) => {
        this.entries.delete(semanticKey);
        throw error;
      });
    this.entries.set(semanticKey, { status: 'pending', expiresAt, promise });
    return promise;
  }

  public prune(now = Date.now()): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  public size(): number {
    return this.entries.size;
  }
}
