// The other end of the village's local socket: sending events to an open
// village (`cli-village emit`, and CLI Village's own commands), or following
// one that's already open (a second view).

import net from "node:net";
import type { EventBus } from "../events/bus.js";
import type { EventSource, VillageEvent } from "../events/types.js";
import { hubAddress, type HubAddress } from "./address.js";

export type Ack = { ok: true; seq?: number } | { ok: false; error: string };

/** Connect to the open village, or null if none is open. */
export function connect(address: HubAddress = hubAddress(), timeoutMs = 1500): Promise<net.Socket | null> {
  return new Promise((resolve) => {
    const socket = net.createConnection(address.path);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(null);
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.setEncoding("utf8");
      resolve(socket);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(null);
    });
  });
}

/** Call `onLine` for each line the other side sends. */
function readLines(socket: net.Socket, onLine: (line: string) => void): void {
  let buffer = "";
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onLine(line);
    }
  });
}

/** Sends events one line at a time; each gets an answer, in order. */
export class HubSender {
  private readonly pending: ((ack: Ack) => void)[] = [];
  private readonly closed: Promise<void>;

  private constructor(private readonly socket: net.Socket) {
    readLines(socket, (line) => {
      let ack: Ack;
      try {
        const data = JSON.parse(line) as Ack;
        ack = data.ok === true ? { ok: true, seq: data.seq } : { ok: false, error: String(data.error ?? "refused") };
      } catch {
        ack = { ok: false, error: "The village sent an answer I couldn't read." };
      }
      this.pending.shift()?.(ack);
    });
    this.closed = new Promise((resolve) => socket.once("close", () => resolve()));
    socket.on("error", () => socket.destroy());
    void this.closed.then(() => {
      for (const resolve of this.pending.splice(0)) resolve({ ok: false, error: "The village closed before it answered." });
    });
  }

  static async open(address?: HubAddress): Promise<HubSender | null> {
    const socket = await connect(address);
    return socket ? new HubSender(socket) : null;
  }

  send(event: unknown): Promise<Ack> {
    if (this.socket.destroyed) return Promise.resolve({ ok: false, error: "The village closed." });
    return new Promise((resolve) => {
      this.pending.push(resolve);
      this.socket.write(`${JSON.stringify(event)}\n`);
    });
  }

  /** Finish: waits (briefly) for the last answers. */
  async close(timeoutMs = 3000): Promise<void> {
    this.socket.end();
    await Promise.race([this.closed, new Promise((resolve) => setTimeout(resolve, timeoutMs).unref())]);
    this.socket.destroy();
  }
}

const SOURCES: readonly EventSource[] = ["builtin", "external", "demo"];

/**
 * Follow a village that's already open: its events (recent ones first) go into
 * `bus`, which checks them again. Resolves when that village closes.
 */
export async function follow(bus: EventBus, address: HubAddress = hubAddress()): Promise<{ ok: true; ended: Promise<void>; stop: () => void } | { ok: false }> {
  const socket = await connect(address);
  if (!socket) return { ok: false };
  readLines(socket, (line) => {
    try {
      const data = JSON.parse(line) as { event?: VillageEvent };
      if (data.event && typeof data.event === "object") {
        const source = SOURCES.includes(data.event.source) ? data.event.source : "external";
        bus.emit(data.event, source);
      }
    } catch {
      // Skip anything unreadable.
    }
  });
  socket.on("error", () => socket.destroy());
  socket.write(`${JSON.stringify({ hello: "watch" })}\n`);
  const ended = new Promise<void>((resolve) => socket.once("close", () => resolve()));
  return { ok: true, ended, stop: () => socket.destroy() };
}

// --- Built-in commands show up in an open village too --------------------------------------

const forwarded = new WeakSet<EventBus>();
const sockets = new Set<net.Socket>();

/**
 * Also send this bus's events to the open village, if there is one. Best
 * effort: it never waits, never fails the command, and connects only once
 * there's something to send. CLI_VILLAGE_FORWARD=0 turns it off.
 */
export function forwardToVillage(bus: EventBus, address: HubAddress = hubAddress()): void {
  if (forwarded.has(bus) || process.env.CLI_VILLAGE_FORWARD === "0") return;
  forwarded.add(bus);
  let socket: net.Socket | null = null;
  bus.subscribe((event) => {
    if (!socket) {
      // Writes wait until it's connected. If no village is open, it fails quietly.
      socket = net.createConnection(address.path);
      socket.on("error", () => socket?.destroy());
      socket.on("data", () => {}); // answers aren't needed
      socket.on("close", () => sockets.delete(socket!));
      sockets.add(socket);
    }
    if (!socket.destroyed) socket.write(`${JSON.stringify(event)}\n`);
  });
}

/** Let forwarded events finish sending (at most `timeoutMs`), so nothing is cut off at exit. */
export async function flushForwarders(timeoutMs = 500): Promise<void> {
  await Promise.all(
    [...sockets].map(
      (socket) =>
        new Promise<void>((resolve) => {
          if (socket.destroyed) return resolve();
          const timer = setTimeout(() => {
            socket.destroy();
            resolve();
          }, timeoutMs);
          socket.once("close", () => {
            clearTimeout(timer);
            resolve();
          });
          socket.end();
        }),
    ),
  );
}
