// The event bus: one stream of events that every view listens to.
// Anything sent in is checked and cleaned first (see validate.ts), so views
// can trust that events never contain secret values.
// No Node-only imports, so this can run anywhere.

import { secretGuard, type SecretGuard } from "./guard.js";
import { EVENT_VERSION, type EventSource, type VillageEvent } from "./types.js";
import { parseEvent } from "./validate.js";

export type Listener = (event: VillageEvent) => void;
export type EmitResult = { ok: true; event: VillageEvent } | { ok: false; error: string };

export interface EventBusOptions {
  /** How many recent events to keep, so late listeners (like a browser tab) can catch up. */
  historySize?: number;
  guard?: SecretGuard;
  now?: () => number;
}

export class EventBus {
  private readonly listeners = new Set<Listener>();
  private readonly endListeners = new Set<() => void>();
  private readonly history: VillageEvent[] = [];
  private readonly historySize: number;
  private readonly guard: SecretGuard;
  private readonly now: () => number;
  private seq = 0;
  private closed = false;

  constructor(options: EventBusOptions = {}) {
    this.historySize = options.historySize ?? 500;
    this.guard = options.guard ?? secretGuard;
    this.now = options.now ?? Date.now;
  }

  /** Send an event to every listener. Bad events are refused with a readable error. */
  emit(input: unknown, source: EventSource = "builtin"): EmitResult {
    if (this.closed) return { ok: false, error: "The event stream has already ended." };

    const parsed = parseEvent(input, this.guard);
    if (!parsed.ok) return parsed;

    const event = { v: EVENT_VERSION, seq: ++this.seq, ts: this.now(), source, ...parsed.body } as VillageEvent;
    this.history.push(event);
    if (this.history.length > this.historySize) this.history.shift();

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A broken view must not stop the other views from getting events.
      }
    }
    return { ok: true, event };
  }

  /** Listen to events. Returns a function that stops listening. */
  subscribe(listener: Listener, options: { replay?: boolean } = {}): () => void {
    if (options.replay) for (const event of this.history) listener(event);
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Called once when the stream ends (e.g. you pressed Ctrl+C). */
  onEnd(listener: () => void): () => void {
    if (this.closed) listener();
    else this.endListeners.add(listener);
    return () => this.endListeners.delete(listener);
  }

  /** The most recent events, oldest first. */
  recent(): readonly VillageEvent[] {
    return this.history;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** End the stream. Listeners hear about it once; later emits are refused. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const listener of this.endListeners) {
      try {
        listener();
      } catch {
        // Keep closing the others.
      }
    }
    this.endListeners.clear();
    this.listeners.clear();
  }
}
