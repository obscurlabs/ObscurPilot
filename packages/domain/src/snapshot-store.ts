export interface VersionedPatchEvent<P> {
  readonly snapshotVersion: number;
  readonly patches: readonly P[];
}

export interface VersionedSnapshot<S> {
  readonly snapshotVersion: number;
  readonly state: Readonly<S>;
}

export class SnapshotStore<S extends object, P> {
  private version = 0;
  private state: Readonly<S>;
  private readonly listeners = new Set<(event: VersionedPatchEvent<P>) => void>();

  public constructor(initialState: S) {
    this.state = Object.freeze(initialState);
  }

  public snapshot(): VersionedSnapshot<S> {
    return Object.freeze({ snapshotVersion: this.version, state: this.state });
  }

  public mutate(nextState: S, patches: readonly P[]): VersionedPatchEvent<P> {
    if (patches.length === 0) throw new Error('Snapshot mutation requires at least one patch');
    this.state = Object.freeze(nextState);
    this.version += 1;
    const event = Object.freeze({
      snapshotVersion: this.version,
      patches: Object.freeze([...patches]),
    });
    for (const listener of this.listeners) listener(event);
    return event;
  }

  public subscribe(listener: (event: VersionedPatchEvent<P>) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export class SnapshotConsumer {
  private version: number;

  public constructor(initialVersion = 0) {
    this.version = initialVersion;
  }

  public apply(eventVersion: number): 'applied' | 'stale' | 'resync_required' {
    if (eventVersion <= this.version) return 'stale';
    if (eventVersion !== this.version + 1) return 'resync_required';
    this.version = eventVersion;
    return 'applied';
  }

  public replace(snapshotVersion: number): void {
    if (!Number.isInteger(snapshotVersion) || snapshotVersion < 0) {
      throw new RangeError('snapshotVersion must be a non-negative integer');
    }
    this.version = snapshotVersion;
  }
}
