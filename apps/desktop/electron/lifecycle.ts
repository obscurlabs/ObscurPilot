export type Disposer = () => void | Promise<void>;

export class LifecycleScope {
  private readonly disposers: Disposer[] = [];
  private disposed = false;

  public add(disposer: Disposer): () => void {
    if (this.disposed) throw new Error('Cannot add resources to a disposed lifecycle');
    this.disposers.push(disposer);
    return () => {
      const index = this.disposers.indexOf(disposer);
      if (index >= 0) this.disposers.splice(index, 1);
    };
  }

  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const failures: unknown[] = [];
    for (const disposer of this.disposers.reverse()) {
      try {
        await disposer();
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    this.disposers.length = 0;
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Lifecycle disposal failed');
    }
  }
}
