// Talks to the local village server over a WebSocket and feeds the events
// into the same village store the terminal view uses.
// The page only listens. It never sends anything back.

import type { VillageState } from "../../src/events/state.js";
import { VillageStore } from "../../src/events/store.js";
import type { VillageEvent } from "../../src/events/types.js";

type ServerMessage =
  | { kind: "hello"; mode: string; version: string; history: VillageEvent[] }
  | { kind: "event"; event: VillageEvent }
  | { kind: "end" };

export interface ConnectionHandlers {
  onHello(mode: string, version: string): void;
  /** A message to show about the connection, or null when all is well. */
  onStatus(message: string | null): void;
}

export interface StateSource {
  getState(): VillageState;
  subscribe(listener: () => void): () => void;
}

/** Connects (and reconnects) to the server and follows its events. */
export function connect(token: string, handlers: ConnectionHandlers): StateSource {
  let store = new VillageStore();
  let lastSeq = 0;
  let ended = false;
  let attempt = 0;
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((listener) => listener());

  const handle = (data: ServerMessage) => {
    if (data.kind === "hello") {
      handlers.onHello(data.mode, data.version);
      // Start fresh from the server's history, so a reconnect never counts an event twice.
      store = new VillageStore();
      for (const event of data.history) store.apply(event);
      lastSeq = data.history.at(-1)?.seq ?? 0;
    } else if (data.kind === "event") {
      if (data.event.seq <= lastSeq) return;
      lastSeq = data.event.seq;
      store.apply(data.event);
    } else {
      ended = true;
      store.stop();
      handlers.onStatus("The village has closed. You can close this tab.");
    }
    changed();
  };

  const open = () => {
    const ws = new WebSocket(`ws://${location.host}/ws?token=${encodeURIComponent(token)}`);
    ws.addEventListener("open", () => {
      attempt = 0;
      handlers.onStatus(null);
    });
    ws.addEventListener("message", (msg) => {
      try {
        handle(JSON.parse(String(msg.data)) as ServerMessage);
      } catch {
        // Ignore anything that isn't one of our messages.
      }
    });
    ws.addEventListener("close", () => {
      if (ended) return;
      attempt++;
      const wait = Math.min(8000, 500 * 2 ** attempt);
      handlers.onStatus(`Lost touch with the terminal. Trying again in ${Math.round(wait / 1000)}s…`);
      setTimeout(open, wait);
    });
  };
  open();

  return {
    getState: () => store.getState(),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
