import type { RoomEvent } from "./domain.js";
import type { Store } from "./store/store.js";

type Listener = (event: RoomEvent) => void;

export class EventBus {
  private listeners = new Map<string, Set<Listener>>();

  constructor(private store: Store) {}

  async publish(roomId: string, type: string, payload: Record<string, unknown>) {
    const event = await this.store.appendEvent(roomId, type, payload);
    for (const listener of this.listeners.get(roomId) ?? []) listener(event);
    return event;
  }

  subscribe(roomId: string, listener: Listener) {
    const listeners = this.listeners.get(roomId) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(roomId, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(roomId);
    };
  }
}
