// The village's local socket ("hub"). Agents and CLI Village's own commands
// connect and send one JSON event per line; the hub checks each one (the same
// checks and privacy guard as everything else) and answers each line.
//
// A connection that first says {"hello":"watch"} gets every event instead, so a
// second village (say, the terminal view next to the 3D one) can follow along.
//
// The hub only answers on this computer (see address.ts). It never sends
// anything anywhere else, and events never carry secret values.

import { chmod, lstat, unlink } from "node:fs/promises";
import net from "node:net";
import type { EventBus } from "../events/bus.js";
import { EVENT_VERSION } from "../events/types.js";
import { hubAddress, preparePrivateDir, type HubAddress } from "./address.js";

/** Longest line we read (an event is far smaller). */
export const MAX_LINE = 64 * 1024;
const MAX_CONNECTIONS = 32;
/** Per connection: a burst of this many events, refilled at RATE per second. */
const BURST = 200;
const RATE = 100;
/** A watcher that falls this far behind is let go. */
const MAX_BACKLOG = 4 * 1024 * 1024;

export interface Hub {
  address: HubAddress;
  /** How many watchers are following along. */
  watchers(): number;
  close(): Promise<void>;
}

export type HubStart = { ok: true; hub: Hub } | { ok: false; busy: true; address: HubAddress } | { ok: false; busy: false; error: string };

const isWindows = process.platform === "win32";

/** Is something already answering on this address? */
export function probe(address: string, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(address);
    const done = (alive: boolean) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(alive);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

function listen(server: net.Server, address: string): Promise<NodeJS.ErrnoException | null> {
  return new Promise((resolve) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      resolve(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve(null);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(address);
  });
}

/** Start the hub, unless another village already runs one (then `busy`). */
export async function startHub(bus: EventBus, address: HubAddress = hubAddress()): Promise<HubStart> {
  if (address.dir && !isWindows) {
    const problem = await preparePrivateDir(address.dir, { mayChange: !address.chosen });
    if (problem) return { ok: false, busy: false, error: problem };
  }

  const connections = new Set<net.Socket>();
  const watchers = new Set<net.Socket>();
  const server = net.createServer((socket) => handle(socket));
  server.maxConnections = MAX_CONNECTIONS;

  function handle(socket: net.Socket): void {
    connections.add(socket);
    socket.setEncoding("utf8");
    let buffer = "";
    let tokens = BURST;
    let last = Date.now();
    let unwatch: (() => void) | null = null;

    const reply = (data: object) => {
      if (!socket.destroyed && socket.writable) socket.write(`${JSON.stringify(data)}\n`);
    };

    const onLine = (line: string) => {
      const text = line.trim();
      if (!text) return;
      let input: unknown;
      try {
        input = JSON.parse(text);
      } catch {
        reply({ ok: false, error: "That line isn't valid JSON. Send one JSON object per line." });
        return;
      }
      if (input && typeof input === "object" && (input as { hello?: unknown }).hello === "watch") {
        if (unwatch) return;
        reply({ ok: true, hello: "cli-village", v: EVENT_VERSION });
        // Catch up on recent events, then follow along.
        unwatch = bus.subscribe(
          (event) => {
            if (socket.writableLength > MAX_BACKLOG) socket.destroy();
            else reply({ event });
          },
          { replay: true },
        );
        watchers.add(socket);
        return;
      }
      // A simple speed limit, so one runaway agent can't flood the village.
      const now = Date.now();
      tokens = Math.min(BURST, tokens + ((now - last) / 1000) * RATE);
      last = now;
      if (tokens < 1) {
        reply({ ok: false, error: `Too many events at once (more than ${RATE} a second). Slow down a little.` });
        return;
      }
      tokens -= 1;
      const result = bus.emit(input, "external");
      reply(result.ok ? { ok: true, seq: result.event.seq } : { ok: false, error: result.error });
    };

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        onLine(line);
      }
      if (buffer.length > MAX_LINE) {
        reply({ ok: false, error: `A line was longer than ${MAX_LINE / 1024} KB. Send one small JSON event per line.` });
        socket.destroy();
      }
    });
    // The last line doesn't need a newline.
    socket.on("end", () => {
      if (buffer.trim()) onLine(buffer);
      buffer = "";
      socket.end();
    });
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      unwatch?.();
      watchers.delete(socket);
      connections.delete(socket);
    });
  }

  let error = await listen(server, address.path);
  if (error?.code === "EADDRINUSE") {
    if (await probe(address.path)) return { ok: false, busy: true, address };
    // Left over from a village that didn't close cleanly: tidy it up and try again.
    // (Only if it really is a socket: never delete an ordinary file someone pointed us at.)
    if (!isWindows) {
      const info = await lstat(address.path).catch(() => null);
      if (!info?.isSocket()) return { ok: false, busy: false, error: `${address.path} is in the way (it isn't a socket). Move it, or set CLI_VILLAGE_SOCKET to another path.` };
      await unlink(address.path).catch(() => {});
    }
    error = await listen(server, address.path);
  }
  if (error) {
    if (error.code === "EADDRINUSE") return { ok: false, busy: true, address };
    return { ok: false, busy: false, error: `Couldn't open the village's socket: ${error.message}` };
  }
  if (!isWindows) await chmod(address.path, 0o600).catch(() => {});

  let closed = false;
  return {
    ok: true,
    hub: {
      address,
      watchers: () => watchers.size,
      close: async () => {
        if (closed) return;
        closed = true;
        for (const socket of connections) socket.destroy();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        if (!isWindows) {
          const info = await lstat(address.path).catch(() => null);
          if (info?.isSocket()) await unlink(address.path).catch(() => {});
        }
      },
    },
  };
}
