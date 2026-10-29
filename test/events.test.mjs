// The event core: the bus, the privacy guard, the validator, the village state and the explainer.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dist, STRIPE_LIVE, STRIPE_TEST } from "./helpers.mjs";

const { EventBus } = await import(dist("events/bus.js"));
const { SecretGuard } = await import(dist("events/guard.js"));
const { parseEvent } = await import(dist("events/validate.js"));
const { createVillageState, describeHarbor, reduce, summarize, summarizeSources } = await import(dist("events/state.js"));
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
    const scan = (task) => ({ type: "start", agent: "you", task, kind: "scan", title: "Checkpoint" });
    const job = (task, command) => ({ type: "start", agent: "you", task, kind: "git", title: "Git work", command });
    const done = (task) => ({ type: "done", agent: "you", task });
    const fail = (task) => ({ type: "fail", agent: "you", task, message: "Stopped at the gate" });
    const commit = { type: "commit", agent: "you", message: "Add payments", sha: "abc1234", files: 2 };
    const push = (commits = 1) => ({ type: "push", agent: "you", remote: "origin", branch: "main", commits });

    it("packs your changes before the snapshot exists, then fills the crate in", () => {
      let state = play([scan("s1")]);
      assert.deepEqual(state.crates.map((c) => [c.status, c.draft]), [["scanning", true]]);
      assert.match(describeHarbor(state).text, /scanning for secrets/);
      state = play([scan("s1"), done("s1"), job("c1", 'git commit -m "Add payments"'), commit, done("c1")]);
      assert.equal(state.crates.length, 1);
      assert.deepEqual([state.crates[0].status, state.crates[0].draft, state.crates[0].sha], ["cleared", undefined, "abc1234"]);
      assert.equal(describeHarbor(state).text, "1 crate at the dock, ready to push");
    });

    it("commit --push: the second check doesn't send the crate back, and the boat takes it", () => {
      const state = play([scan("s1"), done("s1"), commit, scan("s2"), done("s2"), job("p1", "git push"), push(), done("p1")]);
      assert.deepEqual(state.crates.map((c) => c.status), ["shipped"]);
      assert.deepEqual([state.lastPush.crates, state.lastPush.commits], [1, 1]);
      assert.equal(describeHarbor(state).text, "Last boat: 1 commit to origin/main");
    });

    it("a leak keeps the crate at the gate, and the harbor stays a problem until a scan passes", () => {
      let state = play([job("a1", "git add --all"), done("a1"), scan("s1"), fail("s1")]);
      assert.deepEqual(state.crates.map((c) => c.status), ["blocked"]);
      assert.equal(describeHarbor(state).level, "attention");
      assert.ok(state.buildings.harbor.problem);
      // Checking the status (other work at the harbor) doesn't make the stopped crate OK.
      state = play([scan("s1"), fail("s1"), job("st", "git status"), done("st")]);
      assert.ok(state.buildings.harbor.problem, "still stopped at the gate");
      assert.equal(state.stats.fixed, 0);
      // Fixed and tried again: the same crate goes through the gate.
      state = play([scan("s1"), fail("s1"), scan("s2"), done("s2"), commit]);
      assert.deepEqual(state.crates.map((c) => c.status), ["cleared"]);
      assert.equal(state.buildings.harbor.problem, undefined);
      assert.equal(state.stats.fixed, 1);
    });

    it("a robot with a problem keeps saying what it was on its way home", () => {
      const state = play([scan("s1"), fail("s1"), { type: "move", agent: "you", to: "home" }]);
      assert.deepEqual([state.agents.you.status, state.agents.you.say], ["failed", "Stopped at the gate"]);
    });

    it("a snapshot that couldn't be saved leaves no crate behind", () => {
      const state = play([scan("s1"), done("s1"), job("c1", 'git commit -m "x"'), fail("c1")]);
      assert.deepEqual(state.crates, []);
      assert.equal(describeHarbor(state), null);
    });

    it("push on its own: the gate packs the snapshots made outside CLI Village", () => {
      let state = play([scan("s1"), done("s1"), push(2)]);
      assert.deepEqual([state.crates[0].status, state.lastPush.crates], ["shipped", 1]);
      assert.match(describeHarbor(state).text, /Last boat: 2 commits/);
      // A push that only publishes the branch says so, and takes no crates.
      state = play([push(0)]);
      assert.equal(state.headline.title, "Sent to GitHub: the branch to origin/main");
      assert.equal(state.lastPush.crates, 0);
    });

    it("a second snapshot joins the first at the dock, scanned", () => {
      const second = { ...commit, message: "Retry failed payments", sha: "fed4321" };
      let state = play([scan("s1"), done("s1"), commit, scan("s2"), done("s2"), second]);
      assert.deepEqual(state.crates.map((c) => [c.sha, c.status, c.draft]), [
        ["abc1234", "cleared", undefined],
        ["fed4321", "cleared", undefined],
      ]);
      assert.equal(describeHarbor(state).text, "2 crates at the dock, ready to push");
      state = play([scan("s1"), done("s1"), commit, scan("s2"), done("s2"), second, scan("s3"), done("s3"), push(2)]);
      assert.deepEqual(state.crates.map((c) => c.status), ["shipped", "shipped"]);
      assert.equal(state.lastPush.crates, 2, "the check before the push isn't an extra crate");
    });

    it("a leak found before a push stops it at the gate, and the saved crate waits", () => {
      let state = play([scan("s1"), done("s1"), commit, scan("s2"), fail("s2")]);
      assert.deepEqual(state.crates.map((c) => [c.status, c.draft]), [
        ["cleared", undefined],
        ["blocked", true],
      ]);
      assert.equal(describeHarbor(state).level, "attention");
      // A push that failed after a clean check, then tried again: the check's crate is reused, not doubled.
      state = play([scan("s1"), done("s1"), commit, scan("s2"), done("s2"), job("p1", "git push"), fail("p1"), scan("s3")]);
      assert.equal(state.crates.length, 2);
      assert.match(describeHarbor(state).text, /scanning/);
    });

    it("a snapshot saved without a scan waits until the next check", () => {
      const state = play([scan("s1"), done("s1"), commit, { ...commit, sha: "0000aaa" }]);
      assert.equal(describeHarbor(state).text, "2 crates waiting (1 not scanned yet)");
      assert.equal(describeHarbor(play([commit])).text, "1 crate waiting, not scanned yet");
    });

    it("a push that skipped the scan leaves the stopped changes behind, and ships the rest", () => {
      const skipped = { ...commit, sha: "def5678" };
      const state = play([scan("s1"), fail("s1"), skipped, push()]);
      // The new snapshot replaced the stopped crate, then sailed.
      assert.deepEqual(state.crates.map((c) => [c.sha, c.status]), [["def5678", "shipped"]]);
      const forced = play([scan("s1"), fail("s1"), push()]);
      assert.deepEqual(forced.crates, [], "changes the gate stopped were never saved, so they don't sail");
      assert.equal(forced.lastPush.crates, 0);
    });
  });

  it("names research sources by site", () => {
    assert.equal(summarizeSources(["docs.stripe.com/api", "docs.stripe.com/b", "github.com/x", "a.com", "b.com"]), "from docs.stripe.com, github.com, a.com +1 more");
    const state = play([{ type: "done", agent: "claude", task: "r1", message: "Read docs", sources: ["https://docs.stripe.com/api"] }]);
    assert.match(state.log.at(-1).text, /Read docs \(from docs\.stripe\.com\)/);
  });
});

describe("explainer", () => {
  it("explains real commands in one short line", () => {
    assert.match(explain.explainCommand("git commit -m x"), /snapshot/);
    assert.match(explain.explainCommand("git commit --amend --no-edit"), /Redoes/);
    assert.match(explain.explainCommand('infisical scan "--log-opts=HEAD --not --remotes" --redact'), /passwords or keys/);
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
