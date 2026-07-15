export type EventListener<T> = (event: Readonly<T>) => void;

export class EventBus<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<EventListener<Events[keyof Events]>>>();

  public subscribe<Key extends keyof Events>(
    type: Key,
    listener: EventListener<Events[Key]>,
  ): () => void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener<Events[keyof Events]>>();
    listeners.add(listener as EventListener<Events[keyof Events]>);
    this.listeners.set(type, listeners);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      listeners.delete(listener as EventListener<Events[keyof Events]>);
      if (listeners.size === 0) this.listeners.delete(type);
    };
  }

  public publish<Key extends keyof Events>(type: Key, event: Readonly<Events[Key]>): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  public listenerCount(type: keyof Events): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  public clear(): void {
    this.listeners.clear();
  }
}
