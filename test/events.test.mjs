// The event core: the bus, the privacy guard, the validator, the village state and the explainer.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dist, STRIPE_LIVE, STRIPE_TEST } from "./helpers.mjs";

const { EventBus } = await import(dist("events/bus.js"));
const { SecretGuard } = await import(dist("events/guard.js"));
const { parseEvent } = await import(dist("events/validate.js"));
const { createVillageState, describeHarbor, harborLoad, reduce, summarize, summarizeSources } = await import(dist("events/state.js"));
const explain = await import(dist("events/explain.js"));
const { TASK_KINDS } = await import(dist("events/types.js"));

// Token-shaped test strings, put together at runtime (see fixtures/secrets.cjs for why).
const JWT = ["eyJhbGciOi", "eyJzdWIi", "c2lnbmF0dXJl"].join(".");
const GITHUB_TOKEN = ["ghp_", "abcdefghijklmnopqrstuvwxyz", "0123456789AB"].join("");

const start = (extra = {}) => ({ type: "start", agent: "Bolt", task: "t1", kind: "test", title: "Running tests", ...extra });

describe("privacy guard", () => {
  it("hides remembered values, KEY=value text, named secrets and tokens", () => {
    const guard = new SecretGuard();
    guard.remember([STRIPE_LIVE, "x"]);
    const text = guard.clean(`got ${STRIPE_LIVE} API_KEY=abc123 password: hunter2 Bearer ${JWT} ${STRIPE_TEST}`);
    assert.doesNotMatch(text, /sk_live|abc123|hunter2|eyJ|sk_test/);
    assert.match(text, /API_KEY=\[hidden\]/);
    assert.equal(guard.containsSecret(`a ${STRIPE_LIVE} b`), true);
    // Too short to remember safely.
    assert.equal(guard.containsSecret("x"), false);
  });

  it("hides logins in addresses, HTTP logins, AWS key ids and short well-known tokens", () => {
    const guard = new SecretGuard();
    const AWS_ID = ["AKIA", "IOSFODNN7", "EXAMPLE"].join("");
    const SHORT_GH = ["ghp_", "abc123def456ghi789"].join("");
    const cases = [
      ["postgres://admin:Tr0ub4dor-pass@db.example.com/app", /Tr0ub4dor|admin/, "postgres://[hidden]@db.example.com/app"],
      ["git clone https://grant:hunter2pass@gitlab.com/x.git", /hunter2/, "git clone https://[hidden]@gitlab.com/x.git"],
      ["curl -H 'Authorization: Bearer abc123def456ghi789'", /abc123/, "curl -H 'Authorization: Bearer [hidden]'"],
      ["Authorization: token123secret", /token123/, "Authorization: [hidden]"],
      [`aws id ${AWS_ID} here`, /AKIA/, "aws id [hidden] here"],
      [`push with ${SHORT_GH}`, /ghp_/, "push with [hidden]"],
    ];
    for (const [text, secret, expected] of cases) {
      const cleaned = guard.clean(text);
      assert.doesNotMatch(cleaned, secret, text);
      assert.equal(cleaned, expected);
      assert.equal(guard.clean(cleaned), cleaned, "cleaning twice changes nothing");
    }
    // Keys inside longer names and paths, and other shapes, are still hidden.
    const HEX = "9f8e7d6c5b4a39281706f5e4d3c2b1a0";
    const SERVICE_TOKEN = ["st", "63e03c4a97cb4a747186c71e", HEX, HEX].join(".");
    for (const [text, expected] of [
      ["key 123e4567-e89b-12d3-a456-426614174000 ok", "key [hidden] ok"],
      [`GET /reset/password/confirm/${HEX}`, "GET /reset/password/confirm/[hidden]"],
      [`user-session-token-${HEX}`, "user-session-token-[hidden]"],
      ['{password:"hunter2",user:"bob"}', '{password:[hidden],user:"bob"}'],
      ["Bearer Authorization: abc123def456", "Bearer Authorization: [hidden]"],
      ["Authorization: Basic dXNlcjpwYXNz", "Authorization: Basic [hidden]"],
      [`using ${SERVICE_TOKEN}`, "using [hidden]"],
    ]) {
      assert.equal(guard.clean(text), expected, text);
      assert.equal(guard.clean(guard.clean(text)), expected, `${text} (twice)`);
    }
    // Ordinary words stay readable.
    for (const text of [
      "Bearer tokens expire",
      "Fix Authorization: add role checks",
      "token rotation",
      "Invalid token v2.0.1-beta",
      "Basic configuration",
      "see ssh://git@github.com and s3://bucket@region",
      "docs/getting-started-with-webhooks-v2",
      "flights to st.louis-cardinals-2024-season-tickets",
      "edit src/v2/components/UserProfileSettingsPanel",
    ]) {
      assert.equal(guard.clean(text), text);
    }
  });

  it("gives the same result when cleaning text that's already clean", () => {
    // A small seeded fuzz: bits of secrets, words and punctuation thrown together.
    let seed = 42;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const bits = ["password", ":", "=", '"', "'", " ", "Bearer ", "token ", "Authorization: ", "API_KEY", "https://", "u:p@", "@", "/", "-", "_", "abc123", "9f8e7d6c5b4a3928", "[hidden]", "v2.0.1", "sk_live_", "xyz", ",", "{", "}"];
    const guard = new SecretGuard();
    for (let i = 0; i < 3000; i++) {
      let text = "";
      for (let n = 3 + Math.floor(random() * 12); n > 0; n--) text += bits[Math.floor(random() * bits.length)];
      const once = guard.clean(text);
      assert.equal(guard.clean(once), once, JSON.stringify(text));
    }
  });

  it("removes terminal control codes", () => {
    assert.equal(new SecretGuard().clean("red\u001b[31m text\u0007\nnext"), "red text next");
  });
});

describe("validator", () => {
  it("accepts each event type and keeps only known fields", () => {
    const samples = [
      start({ command: "npm test", extra: "dropped" }),
      { type: "move", agent: "Bolt", to: "lab", from: "home" },
      { type: "progress", agent: "Bolt", task: "t1", percent: 42.6, message: "half way" },
      { type: "done", agent: "Bolt", task: "t1", message: "ok", keys: ["DATABASE_URL"], count: 1 },
      { type: "fail", agent: "Bolt", task: "t1", message: "broke" },
      { type: "commit", agent: "Bolt", message: "Fix", sha: "ABCDEF1234", files: 2 },
      { type: "push", agent: "Bolt", remote: "origin", branch: "main", commits: 1 },
    ];
    for (const sample of samples) {
      const res = parseEvent(sample);
      assert.equal(res.ok, true, `${sample.type}: ${res.error}`);
      assert.equal("extra" in res.body, false);
    }
    assert.equal(parseEvent(start()).body.building, "lab");
    assert.equal(parseEvent(samples[2]).body.percent, 43);
    assert.equal(parseEvent(samples[5]).body.sha, "abcdef1");
  });

  it("explains what's wrong with a bad event", () => {
    assert.match(parseEvent(null).error, /JSON object/);
    assert.match(parseEvent({ type: "nope", agent: "a" }).error, /Unknown event type/);
    assert.match(parseEvent({ type: "start", agent: "a" }).error, /"kind" must be one of/);
    assert.match(parseEvent(start({ agent: "x".repeat(40) })).error, /"agent"/);
    assert.match(parseEvent(start({ task: "has space" })).error, /"task"/);
  });

  it("refuses secret values in keys", () => {
    assert.equal(parseEvent({ type: "done", agent: "a", task: "t", keys: ["DATABASE_URL"] }).ok, true);
    assert.equal(parseEvent({ type: "done", agent: "a", task: "t", keys: [STRIPE_TEST] }).ok, false);
    assert.equal(parseEvent({ type: "done", agent: "a", task: "t", keys: ["A=b"] }).ok, false);
  });

  it("cleans and shortens text", () => {
    const res = parseEvent(start({ title: `Using API_KEY=${STRIPE_TEST} ${"x".repeat(300)}` }));
    assert.doesNotMatch(res.body.title, /sk_test/);
    assert.equal(res.body.title.length, 200);
  });

  it("cuts research sources down to site and path", () => {
    const res = parseEvent({
      type: "done",
      agent: "a",
      task: "t",
      sources: [
        `https://docs.stripe.com/api/errors?key=${STRIPE_TEST}#top`,
        "https://user:pass@github.com/stripe/stripe-node",
        `https://a.com/tokens/${GITHUB_TOKEN}`,
        "docs.stripe.com/api",
        "https://files.example.com/share/a8Kd93LmQ2xZ7pR4tY1w/report",
        "https://blog.example.com/2024/getting-started-with-webhooks-v2",
        "https://docs.python.org/3/getting-started-2024",
        "https://example.com/python3-documentation",
      ],
    });
    assert.deepEqual(res.body.sources, [
      "docs.stripe.com/api/errors",
      "github.com/stripe/stripe-node",
      "a.com/tokens/[hidden]",
      "docs.stripe.com/api",
      "files.example.com/share/[hidden]/report",
      "blog.example.com/2024/getting-started-with-webhooks-v2",
      "docs.python.org/3/getting-started-2024",
      "example.com/python3-documentation",
    ]);
    for (const bad of [["ftp://x.com/a"], ["javascript:alert(1)"], ["not a url"], [42], "https://x.com"]) {
      assert.equal(parseEvent({ type: "done", agent: "a", task: "t", sources: bad }).ok, false, JSON.stringify(bad));
    }
    assert.equal(parseEvent({ type: "done", agent: "a", task: "t", sources: Array(11).fill("https://a.com") }).ok, false);
  });

  it("gives the same result when an already-checked event is checked again", () => {
    // Events relayed between villages are checked again, so this must hold for everything.
    const samples = [
      start({ title: `Long ${"y".repeat(250)} API_KEY=${STRIPE_TEST}`, command: "curl -H 'Authorization: Bearer abc.def.ghi'" }),
      { type: "progress", agent: "Bolt", task: "t1", percent: 33.3, message: "tab\there" },
      { type: "done", agent: "Bolt", task: "t1", sources: ["https://docs.stripe.com/a b?x=1", `https://example.com/${"p/".repeat(80)}`, "http://localhost:3000/x"] },
      { type: "commit", agent: "you", message: "Fix", sha: "ABCDEF1234567890", files: 2 },
      { type: "push", agent: "you", remote: "origin", branch: "feature/x", commits: 0 },
    ];
    for (const sample of samples) {
      const once = parseEvent(sample);
      assert.equal(once.ok, true);
      assert.deepEqual(parseEvent(once.body).body, once.body);
    }
  });
});

describe("event bus", () => {
  it("adds meta fields, refuses bad events, replays history and closes", () => {
    const bus = new EventBus({ now: () => 1000 });
    const seen = [];
    assert.equal(bus.emit({ type: "nope" }).ok, false);
    const first = bus.emit(start(), "external");
    assert.equal(first.ok, true);
    assert.deepEqual({ v: first.event.v, seq: first.event.seq, ts: first.event.ts, source: first.event.source }, { v: 1, seq: 1, ts: 1000, source: "external" });
    bus.subscribe((e) => seen.push(e.seq), { replay: true });
    bus.emit({ type: "done", agent: "Bolt", task: "t1" });
    assert.deepEqual(seen, [1, 2]);
    let ended = false;
    bus.onEnd(() => (ended = true));
    bus.close();
    assert.equal(ended, true);
    assert.equal(bus.emit(start()).ok, false);
  });

  it("keeps going when a view throws", () => {
    const bus = new EventBus();
    let got = 0;
    bus.subscribe(() => {
      throw new Error("broken view");
    });
    bus.subscribe(() => got++);
    bus.emit(start());
    assert.equal(got, 1);
  });
});

describe("village state", () => {
  const play = (events) => {
    const bus = new EventBus();
    let state = createVillageState();
    bus.subscribe((e) => (state = reduce(state, e)));
    for (const e of events) assert.equal(bus.emit(e).ok, true);
    return state;
  };

  it("follows a robot through a task", () => {
    let state = play([start()]);
    assert.equal(state.agents.Bolt.status, "working");
    assert.equal(state.agents.Bolt.location, "lab");
    assert.equal(state.headline.command, undefined);
    state = play([start({ command: "npm test" }), { type: "fail", agent: "Bolt", task: "t1", message: "2 failed" }]);
    assert.equal(state.buildings.lab.problem.message, "2 failed");
    assert.ok(state.health < 1);
    assert.equal(state.headline.level, "attention");
    state = play([start(), { type: "fail", agent: "Bolt", task: "t1", message: "x" }, start({ task: "t2" }), { type: "done", agent: "Bolt", task: "t2" }]);
    assert.equal(state.buildings.lab.problem, undefined, "a success fixes the problem");
    assert.equal(state.stats.fixed, 1);
  });

  it("moves crates through the harbor gate", () => {
    const scan = (task) => ({ type: "start", agent: "R", task, kind: "scan", title: "Scanning" });
    let state = play([{ type: "commit", agent: "R", message: "Fix", sha: "abc1234" }, scan("s1"), { type: "fail", agent: "R", task: "s1", message: "leak" }]);
    assert.equal(state.crates[0].status, "blocked");
    assert.equal(state.buildings.harbor.problem.message, "leak");
    state = play([{ type: "commit", agent: "R", message: "Fix" }, scan("s1"), { type: "done", agent: "R", task: "s1" }, { type: "push", agent: "R", commits: 1 }]);
    assert.equal(state.crates[0].status, "shipped");
    assert.match(summarize(state), /1 snapshot · 1 push/);
  });

  describe("the harbor, in the order real commands work", () => {
    // cli-village commit scans your changes first, then saves them (the demo does it the other way round).
    // There are two scans: one checks your changes, the other what a push would send.
    const CHANGES = "infisical scan git-changes --staged --redact";
    const UNSENT = 'infisical scan "--log-opts=HEAD --not --remotes=origin" --redact';
    const LEAK = "Stopped at the gate: 1 possible secret in config/payments.ts line 12 (value hidden)";
    const scan = (task, command = CHANGES, agent = "you") => ({ type: "start", agent, task, kind: "scan", title: "Checkpoint", command });
    const job = (task, command, agent = "you") => ({ type: "start", agent, task, kind: "git", title: "Git work", command });
    const done = (task, extra = {}) => ({ type: "done", agent: "you", task, ...extra });
    const fail = (task, message = LEAK, agent = "you") => ({ type: "fail", agent, task, message });
    const commit = { type: "commit", agent: "you", message: "Add payments", sha: "abc1234", files: 2 };
    const second = { ...commit, message: "Retry failed payments", sha: "fed4321" };
    const push = (commits = 1) => ({ type: "push", agent: "you", remote: "origin", branch: "main", commits });
    /** `cli-village commit`: pick the changes, scan them, save them. */
    const saved = (c = commit, n = 1) => [
      job(`a${n}`, "git add --all"),
      done(`a${n}`),
      scan(`s${n}`),
      done(`s${n}`),
      job(`c${n}`, 'git commit -m "x"'),
      c,
      done(`c${n}`),
    ];
    const statuses = (state) => state.crates.map((c) => c.status);

    it("packs your changes before the snapshot exists, then fills the crate in", () => {
      let state = play([scan("s1")]);
      assert.deepEqual(state.crates.map((c) => [c.status, c.draft]), [["scanning", "changes"]]);
      assert.match(describeHarbor(state).text, /scanning for secrets/);
      state = play(saved());
      assert.equal(state.crates.length, 1);
      assert.deepEqual([state.crates[0].status, state.crates[0].draft, state.crates[0].sha], ["cleared", undefined, "abc1234"]);
      assert.equal(describeHarbor(state).text, "1 crate at the dock, ready to push");
    });

    it("commit --push: the check before the push leaves the crate at the dock, and the boat takes it", () => {
      let state = play([...saved(), scan("u1", UNSENT)]);
      assert.deepEqual(statuses(state), ["cleared"], "already checked, so it isn't sent back to the gate");
      assert.deepEqual(harborLoad(state), { atGate: 0, atDock: 1, gate: "scanning" });
      state = play([...saved(), scan("u1", UNSENT), done("u1"), job("p1", "git push"), push(), done("p1")]);
      assert.deepEqual(statuses(state), ["shipped"]);
      assert.deepEqual([state.lastPush.crates, state.lastPush.commits], [1, 1]);
      assert.equal(describeHarbor(state).text, "Last boat: 1 commit to origin/main");
    });

    it("a leak keeps the crate at the gate, and the harbor stays a problem until a scan passes", () => {
      let state = play([job("a1", "git add --all"), done("a1"), scan("s1"), fail("s1")]);
      assert.deepEqual(statuses(state), ["blocked"]);
      assert.equal(describeHarbor(state).level, "attention");
      assert.deepEqual(harborLoad(state), { atGate: 1, atDock: 0, gate: "stopped" });
      // Other work at the harbor doesn't make the stopped crate OK.
      state = play([scan("s1"), fail("s1"), job("st", "git status"), done("st", { count: 2 })]);
      assert.equal(state.buildings.harbor.problem?.message, LEAK, "still stopped at the gate");
      assert.equal(state.stats.fixed, 0);
      // Fixed and tried again: the same crate goes through the gate.
      state = play([scan("s1"), fail("s1"), scan("s2"), done("s2"), commit]);
      assert.deepEqual(statuses(state), ["cleared"]);
      assert.equal(state.buildings.harbor.problem, undefined);
      assert.equal(state.stats.fixed, 1);
    });

    it("changes thrown away after a leak leave the gate", () => {
      const state = play([scan("s1"), fail("s1"), job("st", "git status"), done("st", { count: 0 })]);
      assert.deepEqual(state.crates, []);
      assert.equal(state.buildings.harbor.problem, undefined);
      assert.equal(describeHarbor(state), null);
    });

    it("a robot with a problem keeps saying what it was on its way home", () => {
      const state = play([scan("s1"), fail("s1"), { type: "move", agent: "you", to: "home" }]);
      assert.deepEqual([state.agents.you.status, state.agents.you.say], ["failed", LEAK]);
    });

    it("a snapshot that couldn't be saved leaves no crate behind", () => {
      const state = play([scan("s1"), done("s1"), job("c1", 'git commit -m "x"'), fail("c1", "a hook failed")]);
      assert.deepEqual(state.crates, []);
      assert.equal(describeHarbor(state), null);
    });

    it("push on its own: the gate packs the snapshots made outside CLI Village", () => {
      let state = play([scan("u1", UNSENT)]);
      assert.deepEqual(state.crates.map((c) => [c.status, c.draft]), [["scanning", "snapshots"]]);
      state = play([scan("u1", UNSENT), done("u1"), push(2)]);
      assert.deepEqual([state.crates[0].status, state.lastPush.crates], ["shipped", 1]);
      assert.match(describeHarbor(state).text, /Last boat: 2 commits/);
      // A push that only publishes the branch says so, and takes no crates.
      state = play([push(0)]);
      assert.equal(state.headline.title, "Sent to GitHub: the branch to origin/main");
      assert.equal(state.lastPush.crates, 0);
    });

    it("a second snapshot joins the first at the dock, and both sail", () => {
      let state = play([...saved(), ...saved(second, 2)]);
      assert.deepEqual(state.crates.map((c) => [c.sha, c.status, c.draft]), [
        ["abc1234", "cleared", undefined],
        ["fed4321", "cleared", undefined],
      ]);
      assert.equal(describeHarbor(state).text, "2 crates at the dock, ready to push");
      state = play([...saved(), ...saved(second, 2), scan("u1", UNSENT), done("u1"), push(2)]);
      assert.deepEqual(statuses(state), ["shipped", "shipped"]);
      assert.equal(state.lastPush.crates, 2, "the check before the push isn't an extra crate");
    });

    it("a leak found before a push is in snapshots made outside CLI Village", () => {
      let state = play([...saved(), scan("u1", UNSENT), fail("u1")]);
      assert.deepEqual(state.crates.map((c) => [c.status, c.draft]), [
        ["cleared", undefined],
        ["blocked", "snapshots"],
      ]);
      assert.equal(describeHarbor(state).text, "A crate is stopped at the gate");
      // Checked again: the same crate goes back to the gate, not a second one.
      state = play([...saved(), scan("u1", UNSENT), fail("u1"), scan("u2", UNSENT)]);
      assert.deepEqual(statuses(state), ["cleared", "scanning"]);
      state = play([...saved(), scan("u1", UNSENT), fail("u1"), scan("u2", UNSENT), done("u2"), push(2)]);
      assert.deepEqual([statuses(state), state.lastPush.crates], [["shipped", "shipped"], 2]);
      // A push that failed after a clean check, then tried again: no extra crate.
      state = play([...saved(), scan("u1", UNSENT), done("u1"), job("p1", "git push"), fail("p1", "rejected"), scan("u2", UNSENT)]);
      assert.equal(state.crates.length, 1);
      assert.match(describeHarbor(state).text, /scanning/);
    });

    it("a snapshot saved without a scan waits until the check before the push", () => {
      const skipped = { ...commit, sha: "0000aaa" };
      let state = play([...saved(), skipped]);
      assert.equal(describeHarbor(state).text, "2 crates waiting (1 not scanned yet)");
      assert.equal(describeHarbor(play([commit])).text, "1 crate waiting, not scanned yet");
      // Checking your next changes doesn't check a snapshot that's already saved.
      state = play([skipped, ...saved(second)]);
      assert.deepEqual(state.crates.map((c) => [c.sha, c.status]), [
        ["0000aaa", "packed"],
        ["fed4321", "cleared"],
      ]);
      assert.deepEqual(harborLoad(state), { atGate: 1, atDock: 1, gate: "waiting" });
      // The check before the push does.
      state = play([skipped, ...saved(second), scan("u1", UNSENT)]);
      assert.deepEqual(statuses(state), ["scanning", "cleared"]);
      state = play([skipped, ...saved(second), scan("u1", UNSENT), done("u1")]);
      assert.equal(describeHarbor(state).text, "2 crates at the dock, ready to push");
    });

    it("changes the gate stopped and saved anyway stay stopped, and pushing them is a warning", () => {
      const skipped = { ...commit, sha: "def5678" };
      let state = play([scan("s1"), fail("s1"), job("c1", 'git commit -m "x"'), skipped, done("c1")]);
      assert.deepEqual(state.crates.map((c) => [c.sha, c.status, c.draft]), [["def5678", "blocked", undefined]]);
      assert.equal(state.buildings.harbor.problem?.message, LEAK);
      // Pushed without a check (--skip-scan): it sails, but the harbor says to change that secret.
      state = play([scan("s1"), fail("s1"), skipped, job("p1", "git push"), push(), done("p1")]);
      assert.deepEqual(statuses(state), ["shipped"]);
      assert.match(state.log.at(-2).text, /pushed 1 commit/);
      assert.equal(state.log.at(-2).emphasis, "primary");
      assert.match(state.buildings.harbor.problem?.message ?? "", /Change that secret now/);
      assert.equal(state.stats.fixed, 0, "a push that sent the secret isn't a fix");
      assert.equal(describeHarbor(state).text, "A possible secret went to GitHub");
      const pushed = play([scan("s1"), fail("s1"), skipped, job("p1", "git push"), push()]);
      assert.equal(pushed.headline.level, "attention");
      assert.match(pushed.headline.title, /possible secret/);
      // The next scan that passes is the all-clear.
      state = play([scan("s1"), fail("s1"), skipped, push(), scan("s2"), done("s2")]);
      assert.equal(state.buildings.harbor.problem, undefined);
      // Changes that were stopped and never saved don't sail.
      const forced = play([scan("s1"), fail("s1"), push()]);
      assert.deepEqual(forced.crates.map((c) => [c.status, c.draft]), [["blocked", "changes"]]);
      assert.equal(forced.lastPush.crates, 0);
      assert.notEqual(forced.headline.level, "attention");
    });

    it("an amended snapshot replaces the one the gate stopped", () => {
      const amended = { ...commit, sha: "c7d8e9f" };
      const fix = [commit, scan("u1", UNSENT), fail("u1"), job("m1", "git commit --amend --no-edit"), amended, done("m1")];
      let state = play(fix);
      assert.deepEqual(state.crates.map((c) => [c.sha, c.status]), [["c7d8e9f", "packed"]]);
      assert.equal(describeHarbor(state).text, "1 crate waiting, not scanned yet");
      // Redone isn't fixed yet: only a scan that passes can say the secret is gone.
      assert.match(state.buildings.harbor.problem?.message ?? "", /next scan checks/);
      assert.equal(state.stats.fixed, 0);
      assert.doesNotMatch(state.headline.title, /^Fixed/);
      state = play([...fix, scan("u2", UNSENT), done("u2")]);
      assert.deepEqual(statuses(state), ["cleared"]);
      assert.equal(state.buildings.harbor.problem, undefined);
      assert.equal(state.stats.fixed, 1);
      assert.match(state.headline.title, /^Fixed/);
      // Still there when checked again: stopped again.
      state = play([...fix, scan("u2", UNSENT), fail("u2")]);
      assert.deepEqual(statuses(state), ["blocked"]);
      assert.equal(state.buildings.harbor.problem?.message, LEAK);
      // Pushed without that check (--skip-scan): it might still have the secret, so it's a warning.
      state = play([...fix, push()]);
      assert.match(state.headline.title, /possible secret/);
      // A normal snapshot amended (nothing was stopped) needs no extra check.
      state = play([...saved(), job("m2", "git commit --amend --no-edit"), amended, done("m2")]);
      assert.equal(state.buildings.harbor.problem, undefined);
      assert.equal(state.crates[0].recheck, undefined);
    });

    it("two scans at once each move only their own crate", () => {
      const state = play([scan("sA", CHANGES, "Ada"), scan("sB", CHANGES, "Bo"), fail("sA", LEAK, "Ada"), { type: "done", agent: "Bo", task: "sB" }]);
      assert.deepEqual(state.crates.map((c) => [c.agent, c.status]), [
        ["Ada", "blocked"],
        ["Bo", "cleared"],
      ]);
      assert.equal(state.buildings.harbor.problem?.message, LEAK, "Bo's clean scan doesn't fix Ada's leak");
      // A git problem in between doesn't replace what the gate found.
      const later = play([scan("sA", CHANGES, "Ada"), fail("sA", LEAK, "Ada"), job("p1", "git push", "Bo"), fail("p1", "rejected", "Bo"), job("st", "git status"), done("st", { count: 1 })]);
      assert.equal(later.buildings.harbor.problem?.message, LEAK);
    });
  });

  it("names research sources by site", () => {
    assert.equal(summarizeSources(["docs.stripe.com/api", "docs.stripe.com/b", "github.com/x", "a.com", "b.com"]), "from docs.stripe.com, github.com, a.com +1 more");
    const state = play([{ type: "done", agent: "my-agent", task: "r1", message: "Read docs", sources: ["https://docs.stripe.com/api"] }]);
    assert.match(state.log.at(-1).text, /Read docs \(from docs\.stripe\.com\)/);
  });
});

describe("explainer", () => {
  it("explains real commands in one short line", () => {
    assert.match(explain.explainCommand("git commit -m x"), /snapshot/);
    assert.match(explain.explainCommand("git commit --amend --no-edit"), /Redoes/);
    // The check before a push looks at snapshots; the one before a commit looks at your changes.
    assert.match(explain.explainCommand('infisical scan "--log-opts=HEAD --not --remotes" --redact'), /snapshots a push would send/);
    assert.match(explain.explainCommand("infisical scan git-changes --staged --redact"), /your changes/);
    assert.match(explain.explainCommand("cargo test"), /tests/);
    assert.equal(explain.explainCommand("rm -rf /"), undefined);
    assert.equal(explain.commitCommand('say "hi" $HOME'), 'git commit -m "say \\"hi\\" \\$HOME"');
  });

  it("keeps every explanation within 72 characters (an 80-column terminal)", () => {
    const lines = [
      ...TASK_KINDS.map((k) => explain.explainTask(k)),
      ...TASK_KINDS.map((k) => explain.explainProblem(k)),
      ...["infisical export", "infisical export --output-file=x", "infisical run", "infisical scan", "git status", "git add", "git push", "git pull", "git switch -c x", "gh pr create", "npm install", "npm run build", "npm run lint", "npm start"].map(explain.explainCommand),
    ];
    for (const line of lines) {
      assert.ok(line, "missing explanation");
      assert.ok(line.length <= 72, `too long (${line.length}): ${line}`);
    }
  });
});
