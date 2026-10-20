import type { EventRecord } from "./repos.js";

type Listener = (event: EventRecord) => void;

export class EventHub {
  private readonly listeners = new Map<string, Set<Listener>>();

  subscribe(taskId: string, listener: Listener): () => void {
    const set = this.listeners.get(taskId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(taskId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(taskId);
    };
  }

  publish(event: EventRecord): void {
    for (const listener of this.listeners.get(event.taskId) ?? []) {
      try {
        listener(event);
      } catch {
        // A disconnected SSE client must not break the agent run.
      }
    }
  }

  subscriberCount(taskId: string): number {
    return this.listeners.get(taskId)?.size ?? 0;
  }
}
