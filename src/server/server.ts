// The village server: serves the 3D page and streams events to it.
//
// Safety rules (from the spec):
// - Listens on 127.0.0.1 only, so other computers can't reach it.
// - Needs a random per-session token, in the page URL and on the WebSocket.
// - Refuses requests whose Host or Origin isn't this server (stops other
//   websites from talking to it).
// - Makes no outside calls. The page loads nothing from the internet.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import type { EventBus } from "../events/bus.js";
import type { VillageEvent } from "../events/types.js";

/** How the page should look: set by --compact and --no-animation. */
export interface PageView {
  /** Hide the beginner explanations and key hints. */
  compact: boolean;
  /** false = a still village: no orbiting camera, no walking, no drifting effects. */
  animation: boolean;
}

/** Messages the server sends to the page. */
export type ServerMessage =
  | { kind: "hello"; mode: string; version: string; view: PageView; history: readonly VillageEvent[] }
  | { kind: "event"; event: VillageEvent }
  | { kind: "end" };

export interface VillageServerOptions {
  bus: EventBus;
  mode: string;
  version: string;
  view?: PageView;
  /** 0 = let the computer pick a free port. */
  port?: number;
  /** Folder with the built page. Defaults to dist/web next to this file. */
  webRoot?: string;
  /** Folder with the built desktop-app page. When set, it's served at /app/ (same token). */
  appRoot?: string;
}

export interface VillageServer {
  url: string;
  /** The desktop app's page, when `appRoot` was given. */
  appUrl?: string;
  port: number;
  close(): Promise<void>;
}

const HOST = "127.0.0.1";
const DEFAULT_WEB_ROOT = fileURLToPath(new URL("../web/", import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

function sameSecret(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function securityHeaders(port: number): Record<string, string> {
  return {
    "Content-Security-Policy": [
      "default-src 'self'",
      `connect-src 'self' ws://${HOST}:${port} ws://localhost:${port}`,
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      // Only our own pages may frame ours: the desktop app's page shows the village in a frame.
      "frame-ancestors 'self'",
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "SAMEORIGIN",
    "Cache-Control": "no-store",
  };
}

function page(res: http.ServerResponse, status: number, title: string, message: string, port: number): void {
  res.writeHead(status, { ...securityHeaders(port), "Content-Type": "text/html; charset=utf-8" });
  res.end(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
      `<body style="font:16px system-ui;background:#1F1D17;color:#EDE6D6;display:grid;place-items:center;height:100vh;margin:0">` +
      `<div style="border:1px solid #C9A25A;padding:24px 32px;max-width:520px"><b>${title}</b><p>${message}</p></div>`,
  );
}

export async function startVillageServer(options: VillageServerOptions): Promise<VillageServer> {
  const webRoot = path.resolve(options.webRoot ?? DEFAULT_WEB_ROOT);
  const indexFile = path.join(webRoot, "index.html");
  if (!existsSync(indexFile)) {
    throw new Error("The 3D village isn't built yet. Run `npm run build` first.");
  }
  const appRoot = options.appRoot ? path.resolve(options.appRoot) : null;
  if (appRoot && !existsSync(path.join(appRoot, "index.html"))) {
    throw new Error("The desktop app isn't built yet. Run `npm run build` first.");
  }

  const token = randomBytes(24).toString("base64url");
  let port = options.port ?? 0;
  const allowedHosts = () => new Set([`${HOST}:${port}`, `localhost:${port}`]);
  const allowedOrigins = () => new Set([`http://${HOST}:${port}`, `http://localhost:${port}`]);

  const server = http.createServer((req, res) => {
    if (!allowedHosts().has(req.headers.host ?? "")) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end("Method not allowed");
      return;
    }
    const url = new URL(req.url ?? "/", `http://${HOST}:${port}`);

    // The pages themselves need the session token: the village at /, the desktop app at /app/.
    const isVillagePage = url.pathname === "/" || url.pathname === "/index.html";
    const isAppPage = appRoot !== null && (url.pathname === "/app" || url.pathname === "/app/" || url.pathname === "/app/index.html");
    if (isVillagePage || isAppPage) {
      if (!sameSecret(url.searchParams.get("token"), token)) {
        page(res, 401, "This village needs its secret link", "Open the full address printed in your terminal (it ends with <code>?token=…</code>).", port);
        return;
      }
      res.writeHead(200, { ...securityHeaders(port), "Content-Type": CONTENT_TYPES[".html"]! });
      createReadStream(isAppPage ? path.join(appRoot!, "index.html") : indexFile).pipe(res);
      return;
    }

    // Built files (scripts, styles) are the same for everyone, so they don't need the token.
    const inApp = appRoot !== null && url.pathname.startsWith("/app/");
    const root = inApp ? appRoot! : webRoot;
    let file: string;
    try {
      file = path.resolve(root, `.${decodeURIComponent(inApp ? url.pathname.slice("/app".length) : url.pathname)}`);
    } catch {
      res.writeHead(400, securityHeaders(port)).end("Bad request");
      return;
    }
    const inside = file.startsWith(root + path.sep);
    if (!inside || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, securityHeaders(port)).end("Not found");
      return;
    }
    res.writeHead(200, {
      ...securityHeaders(port),
      "Content-Type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
    });
    createReadStream(file).pipe(res);
  });

  // Live events go over a WebSocket at /ws, which also needs the token.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${HOST}:${port}`);
    const ok =
      url.pathname === "/ws" &&
      allowedHosts().has(req.headers.host ?? "") &&
      allowedOrigins().has(req.headers.origin ?? "") &&
      sameSecret(url.searchParams.get("token"), token);
    if (!ok) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
  });

  const send = (ws: WebSocket, message: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  };

  wss.on("connection", (ws: WebSocket) => {
    const view = options.view ?? { compact: false, animation: true };
    send(ws, { kind: "hello", mode: options.mode, version: options.version, view, history: options.bus.recent() });
    if (options.bus.isClosed) {
      send(ws, { kind: "end" });
      return;
    }
    const stop = options.bus.subscribe((event) => send(ws, { kind: "event", event }));
    const stopEnd = options.bus.onEnd(() => send(ws, { kind: "end" }));
    ws.on("close", () => {
      stop();
      stopEnd();
    });
    // The page never needs to send anything. Ignore whatever arrives.
    ws.on("message", () => {});
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, () => resolve());
  });
  port = (server.address() as AddressInfo).port;

  return {
    url: `http://${HOST}:${port}/?token=${token}`,
    appUrl: appRoot ? `http://${HOST}:${port}/app/?token=${token}` : undefined,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.close(1001, "Village closed");
        wss.close();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
