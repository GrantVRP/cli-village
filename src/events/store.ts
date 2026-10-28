// Holds the current village state and tells views when it changes.
// Works with React's useSyncExternalStore. No Node-only imports.

import type { EventBus } from "./bus.js";
import { createVillageState, markStopped, reduce, type VillageState } from "./state.js";
import type { VillageEvent } from "./types.js";

export class VillageStore {
  private state: VillageState = createVillageState();
  private readonly listeners = new Set<() => void>();

  /** A store that follows a bus, including events sent before it was created. */
  static fromBus(bus: EventBus): VillageStore {
    const store = new VillageStore();
    bus.subscribe((event) => store.apply(event), { replay: true });
    bus.onEnd(() => store.stop());
    return store;
  }

  apply(event: VillageEvent): void {
    const next = reduce(this.state, event);
    if (next === this.state) return;
    this.state = next;
    this.changed();
  }

  stop(): void {
    if (this.state.stopped) return;
    this.state = markStopped(this.state);
    this.changed();
  }

  getState = (): VillageState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private changed(): void {
    for (const listener of this.listeners) listener();
  }
}
