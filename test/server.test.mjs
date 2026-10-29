// The 3D village's web server: only this computer, only with the session's secret link.

import assert from "node:assert/strict";
import http from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import WebSocket from "ws";
import { dist, tempDir } from "./helpers.mjs";

const { EventBus } = await import(dist("events/bus.js"));
const { startVillageServer } = await import(dist("server/server.js"));

function get(url, { method = "GET", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

function connect(url, origin) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { origin });
    const messages = [];
    ws.on("message", (m) => messages.push(JSON.parse(m.toString())));
    ws.on("open", () => resolve({ ok: true, ws, messages }));
    ws.on("error", () => resolve({ ok: false }));
    ws.on("unexpected-response", () => resolve({ ok: false }));
  });
}

// Servers are closed at the end even if a test failed, so a failure can't hang the run.
const servers = [];
after(async () => {
  for (const server of servers) await server.close();
});

async function village() {
  // The page's folder, with a private file right next to it that must never be served.
  const dir = tempDir();
  const webRoot = path.join(dir, "web");
  mkdirSync(path.join(webRoot, "assets"), { recursive: true });
  writeFileSync(path.join(webRoot, "index.html"), "<!doctype html><title>village</title>");
  writeFileSync(path.join(webRoot, "assets", "app.js"), "console.log(1)");
  writeFileSync(path.join(dir, "outside.txt"), "private");
  const bus = new EventBus();
  const server = await startVillageServer({ bus, mode: "live", version: "test", webRoot });
  servers.push(server);
  const page = new URL(server.url);
  return { bus, server, page, token: page.searchParams.get("token"), base: `http://${page.host}` };
}

describe("village server", () => {
  it("listens on 127.0.0.1 with a random token", async () => {
    const { server, page, token } = await village();
    assert.equal(page.hostname, "127.0.0.1");
    assert.ok(token.length >= 32);
    const other = await village();
    assert.notEqual(other.token, token);
    await server.close();
    await other.server.close();
  });

  it("only serves the page with the right token, host and method", async () => {
    const { server, base, token } = await village();
    assert.equal((await get(`${base}/`)).status, 401);
    assert.equal((await get(`${base}/?token=wrong`)).status, 401);
    const ok = await get(`${base}/?token=${token}`);
    assert.equal(ok.status, 200);
    assert.match(ok.headers["content-security-policy"], /default-src 'self'/);
    assert.equal((await get(`${base}/?token=${token}`, { headers: { Host: "evil.example:80" } })).status, 403);
    assert.equal((await get(`${base}/?token=${token}`, { method: "POST" })).status, 405);
    assert.equal((await get(`${base}/assets/app.js`)).status, 200);
    for (const sneaky of ["/../outside.txt", "/assets/..%2F..%2Foutside.txt", "/%2e%2e/outside.txt"]) {
      const res = await get(`${base}${sneaky}`);
      assert.notEqual(res.status, 200, sneaky);
      assert.doesNotMatch(res.body, /private/);
    }
    await server.close();
  });

  it("only opens the live connection with the token, from the village's own page", async () => {
    const { bus, server, base, token, page } = await village();
    const ws = `ws://${page.host}/ws`;
    assert.equal((await connect(`${ws}?token=wrong`, base)).ok, false);
    assert.equal((await connect(`${ws}?token=${token}`, "https://evil.example")).ok, false);
    assert.equal((await connect(`${ws}?token=${token}`, undefined)).ok, false);
    bus.emit({ type: "start", agent: "Bolt", task: "t1", kind: "test", title: "Testing" });
    const good = await connect(`${ws}?token=${token}`, base);
    assert.equal(good.ok, true);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(good.messages[0].kind, "hello");
    assert.equal(good.messages[0].history.length, 1);
    bus.emit({ type: "done", agent: "Bolt", task: "t1" });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(good.messages.at(-1).event.type, "done");
    good.ws.close();
    await server.close();
  });
});
