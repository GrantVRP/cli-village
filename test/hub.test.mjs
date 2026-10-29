// The village's local socket: sending events, following along, limits, and
// keeping it private. Also `cli-village emit` and `watch` end to end.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { after, describe, it } from "node:test";
import { CLI, cliEnv, dist, jsonLines, leaks, STRIPE_TEST, tempDir, tempRepo, testSocket } from "./helpers.mjs";

const { EventBus } = await import(dist("events/bus.js"));
const { startHub, MAX_LINE } = await import(dist("hub/server.js"));
const { HubSender, follow } = await import(dist("hub/client.js"));
const { hubAddress, isSafeToConnect, preparePrivateDir } = await import(dist("hub/address.js"));

const isWindows = process.platform === "win32";
const addressFor = (socket) => hubAddress({ CLI_VILLAGE_SOCKET: socket });
const start = (task = "r1") => ({ type: "start", agent: "my-agent", task, kind: "research", title: "Reading docs" });

// Everything a test starts is closed at the end, even if the test failed (so a failure can't hang the run).
const cleanup = [];
after(async () => {
  for (const close of cleanup.reverse()) await close();
});

/** Wait for a promise, but give up after `ms`. */
const within = (promise, ms = 5000) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), ms).unref())]);

async function openHub() {
  const socket = testSocket();
  const address = addressFor(socket);
  const bus = new EventBus();
  const started = await startHub(bus, address);
  assert.equal(started.ok, true, started.error);
  cleanup.push(() => started.hub.close());
  return { bus, hub: started.hub, address, socket };
}

/** Run the CLI without blocking this process (the hub here has to keep answering). */
function cliAsync(args, { env = {}, input, cwd } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env: cliEnv(env) });
    cleanup.push(() => child.kill());
    const timer = setTimeout(() => child.kill(), 30_000);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(input ?? "");
  });
}

const until = async (check, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail("timed out waiting");
};

describe("the local socket", () => {
  it("checks each event and answers each line", async () => {
    const { bus, hub, address } = await openHub();
    const seen = [];
    bus.subscribe((e) => seen.push(e));
    const sender = await HubSender.open(address);
    assert.ok(sender);
    const ok = await sender.send(start());
    assert.deepEqual(ok, { ok: true, seq: 1 });
    const bad = await sender.send({ type: "start", agent: "my-agent" });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /"kind" must be one of/);
    await sender.close();
    assert.equal(seen.length, 1);
    assert.equal(seen[0].source, "external");
    await hub.close();
  });

  it("says when a village is already open, and lets a second one follow it", async () => {
    const { bus, hub, address } = await openHub();
    bus.emit(start("before"));
    assert.deepEqual(await startHub(new EventBus(), address), { ok: false, busy: true, address });

    const mirror = new EventBus();
    const seen = [];
    mirror.subscribe((e) => seen.push(`${e.type}:${e.task ?? ""}:${e.source}`));
    const followed = await follow(mirror, address);
    assert.equal(followed.ok, true);
    cleanup.push(() => followed.stop());
    await until(() => seen.length === 1);
    const sender = await HubSender.open(address);
    await sender.send({ type: "done", agent: "my-agent", task: "before" });
    await sender.close();
    await until(() => seen.length === 2);
    assert.deepEqual(seen, ["start:before:builtin", "done:before:external"]);
    await hub.close();
    await within(followed.ended); // the follower hears that the village closed
  });

  it("limits line length and speed", async () => {
    const { hub, address } = await openHub();
    const raw = net.createConnection(address.path);
    cleanup.push(() => raw.destroy());
    let answers = "";
    raw.setEncoding("utf8");
    raw.on("data", (d) => (answers += d));
    await new Promise((r) => raw.once("connect", r));
    raw.write("not json\n");
    raw.write(`${JSON.stringify(start("fast"))}\n`.repeat(400));
    await until(() => answers.split("\n").length > 401);
    const lines = jsonLines(answers);
    assert.match(lines[0].error, /isn't valid JSON/);
    assert.ok(lines.filter((l) => l.ok).length >= 200);
    assert.ok(lines.some((l) => /Too many events/.test(l.error ?? "")), "the speed limit kicks in");
    raw.destroy();

    const big = net.createConnection(address.path);
    cleanup.push(() => big.destroy());
    let reply = "";
    big.setEncoding("utf8");
    big.on("data", (d) => (reply += d));
    const closed = new Promise((r) => big.once("close", r));
    big.on("error", () => {});
    big.write("x".repeat(MAX_LINE + 10));
    await within(closed);
    assert.match(reply, /longer than/);
    await hub.close();
  });

  it("keeps the socket private, tidies a stale one, and never deletes an ordinary file", { skip: isWindows && "Unix sockets only" }, async () => {
    const dir = tempDir();
    const mode = (p) => statSync(p).mode & 0o777;

    // A folder the village makes itself is private.
    const fresh = path.join(dir, "new", "village.sock");
    const made = await startHub(new EventBus(), addressFor(fresh));
    assert.equal(made.ok, true, made.error);
    cleanup.push(() => made.hub.close());
    assert.equal(mode(path.dirname(fresh)), 0o700);
    assert.equal(mode(fresh), 0o600);
    await made.hub.close();

    // A folder you picked that others can open is refused, and left as it was.
    const sock = path.join(dir, "private", "village.sock");
    const address = addressFor(sock);
    mkdirSync(path.dirname(sock));
    chmodSync(path.dirname(sock), 0o755);
    const open = await startHub(new EventBus(), address);
    assert.equal(open.ok, false);
    assert.match(open.error, /Other users can open/);
    assert.equal(mode(path.dirname(sock)), 0o755);
    assert.equal(isSafeToConnect(address), false, "commands won't send events into an open folder either");
    // The village's own folder (not one you picked) is locked down instead.
    assert.equal(await preparePrivateDir(path.dirname(sock)), null);
    assert.equal(mode(path.dirname(sock)), 0o700);
    assert.equal(isSafeToConnect(address), true);

    // A village that crashed: its socket file stays behind.
    const crashed = spawn(process.execPath, ["-e", `require("net").createServer().listen(${JSON.stringify(sock)}, () => console.log("up"))`], { stdio: ["ignore", "pipe", "inherit"] });
    cleanup.push(() => crashed.kill("SIGKILL"));
    const closed = new Promise((resolve) => crashed.once("close", resolve));
    const up = await within(Promise.race([new Promise((resolve) => crashed.stdout.once("data", () => resolve(true))), closed.then(() => false)]));
    assert.ok(up, "the stand-in village couldn't start (see its error above)");
    crashed.kill("SIGKILL");
    await within(closed);
    assert.ok(existsSync(sock), "a stale socket is left over");

    const started = await startHub(new EventBus(), address);
    assert.equal(started.ok, true, started.error);
    cleanup.push(() => started.hub.close());
    assert.equal(mode(sock), 0o600);
    const sender = await HubSender.open(address);
    assert.ok(sender, "the new village answers");
    await sender.close();
    await started.hub.close();
    assert.equal(existsSync(sock), false, "a clean close removes the socket");

    const file = path.join(dir, "notes.txt");
    writeFileSync(file, "keep me");
    const blocked = await startHub(new EventBus(), addressFor(file));
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /in the way/);
    assert.equal(readFileSync(file, "utf8"), "keep me");
  });
});

describe("cli-village emit", () => {
  it("sends one event, or many from stdin, and explains mistakes", async () => {
    const { bus, hub, socket } = await openHub();
    const seen = [];
    bus.subscribe((e) => seen.push(e));
    const env = { CLI_VILLAGE_SOCKET: socket };

    const one = await cliAsync(["emit", JSON.stringify(start())], { env });
    assert.equal(one.code, 0, one.stderr);
    assert.match(one.stdout, /Sent to the village: start · my-agent at the LIBRARY: Reading docs/);

    const many = [
      JSON.stringify({ type: "progress", agent: "my-agent", task: "r1", percent: 50 }),
      "oops",
      JSON.stringify({ type: "done", agent: "my-agent", task: "r1", message: `used API_KEY=${STRIPE_TEST}`, sources: [`https://docs.stripe.com/api?key=${STRIPE_TEST}`] }),
    ].join("\n");
    const stream = await cliAsync(["emit", "-", "--json"], { env, input: many });
    assert.equal(stream.code, 1);
    const result = JSON.parse(stream.stdout);
    assert.equal(result.sent, 2);
    assert.deepEqual(result.refused.map((r) => r.line), [2]);

    await until(() => seen.length === 3);
    assert.deepEqual(seen.at(-1).sources, ["docs.stripe.com/api"]);
    assert.deepEqual(leaks(JSON.stringify(seen) + stream.stdout + stream.stderr), []);

    const bad = await cliAsync(["emit", "{nope"], { env });
    assert.equal(bad.code, 1);
    assert.match(bad.stdout, /isn't valid JSON/);
    await hub.close();
  });

  it("doesn't stop your agent when no village is open", async () => {
    const res = await cliAsync(["emit", "--json", JSON.stringify(start())]);
    assert.equal(res.code, 0);
    assert.deepEqual(JSON.parse(res.stdout), { ok: true, delivered: false });
  });

  it("doesn't stop your agent when the village closes, or never answers", async () => {
    const listen = async (onConnection) => {
      const socket = testSocket();
      const server = net.createServer(onConnection);
      await new Promise((resolve) => server.listen(addressFor(socket).path, resolve));
      cleanup.push(() => new Promise((resolve) => server.close(resolve)));
      return socket;
    };
    // Answers the first event, then closes.
    const closing = await listen((conn) => {
      conn.once("data", () => {
        conn.write('{"ok":true,"seq":1}\n');
        setTimeout(() => conn.destroy(), 50);
      });
    });
    const lines = ["a1", "a2", "a3"].map((t) => JSON.stringify(start(t))).join("\n");
    const stream = await cliAsync(["emit", "-", "--json"], { env: { CLI_VILLAGE_SOCKET: closing }, input: lines });
    assert.equal(stream.code, 0, stream.stderr);
    const result = JSON.parse(stream.stdout);
    assert.equal(result.sent, 1);
    assert.equal(result.lost, 2);
    assert.deepEqual(result.refused, []);

    // Takes the connection but never answers.
    const silent = await listen((conn) => conn.on("data", () => {}));
    const started = Date.now();
    const one = await cliAsync(["emit", "--json", JSON.stringify(start())], { env: { CLI_VILLAGE_SOCKET: silent } });
    assert.equal(one.code, 0, one.stderr);
    assert.deepEqual(JSON.parse(one.stdout), { ok: true, delivered: false });
    assert.ok(Date.now() - started < 15_000, "it gave up waiting");
  });

  it("shows CLI Village's own commands in an open village", async () => {
    const { bus, hub, socket } = await openHub();
    const seen = [];
    bus.subscribe((e) => seen.push(`${e.agent}:${e.type}`));
    const { work } = tempRepo();
    const res = await cliAsync(["status", "-q"], { cwd: work, env: { CLI_VILLAGE_SOCKET: socket, CLI_VILLAGE_FORWARD: "1" } });
    assert.equal(res.code, 0, res.stderr);
    await until(() => seen.includes("you:done"));
    assert.deepEqual(seen, ["you:move", "you:start", "you:done", "you:move"]);
    await hub.close();
  });
});

describe("cli-village watch", () => {
  it("prints each event as a JSON line, and stops cleanly", async () => {
    const socket = testSocket();
    const env = cliEnv({ CLI_VILLAGE_SOCKET: socket });
    const watcher = spawn(process.execPath, [CLI, "watch", "--json"], { env });
    cleanup.push(() => watcher.kill());
    let out = "";
    watcher.stdout.on("data", (d) => (out += d));
    await until(() => out.includes('"watching":true'));
    const sent = await cliAsync(["emit", JSON.stringify(start())], { env: { CLI_VILLAGE_SOCKET: socket } });
    assert.equal(sent.code, 0, sent.stderr);
    await until(() => out.includes('"type":"start"'));
    const [hello, event] = jsonLines(out);
    assert.equal(hello.following, false);
    assert.equal(event.agent, "my-agent");

    const exited = new Promise((resolve) => watcher.once("exit", (code) => resolve(code)));
    if (isWindows) {
      // Windows has no Ctrl+C signal to send to another program, so it's just stopped.
      watcher.kill();
      await within(exited);
      return;
    }
    // Ctrl+C: it closes the village properly, exits with 0, and tidies its socket away.
    watcher.kill("SIGINT");
    assert.equal(await within(exited), 0);
    assert.equal(existsSync(socket), false, "the socket is removed");
  });
});
