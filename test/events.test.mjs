// The event core: the bus, the privacy guard, the validator, the village state and the explainer.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dist, STRIPE_LIVE, STRIPE_TEST } from "./helpers.mjs";

const { EventBus } = await import(dist("events/bus.js"));
const { SecretGuard } = await import(dist("events/guard.js"));
const { parseEvent } = await import(dist("events/validate.js"));
const { createVillageState, reduce, summarize, summarizeSources } = await import(dist("events/state.js"));
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
    // A key shaped like a UUID is still hidden.
    assert.equal(guard.clean("key 123e4567-e89b-12d3-a456-426614174000 ok"), "key [hidden] ok");
    // Ordinary words stay readable.
    for (const text of ["Bearer tokens expire", "Fix Authorization: add role checks", "token rotation", "see ssh://git@github.com", "docs/getting-started-with-webhooks-v2"]) {
      assert.equal(guard.clean(text), text.replace("git@", "[hidden]@"));
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
      ],
    });
    assert.deepEqual(res.body.sources, [
      "docs.stripe.com/api/errors",
      "github.com/stripe/stripe-node",
      "a.com/tokens/[hidden]",
      "docs.stripe.com/api",
      "files.example.com/share/[hidden]/report",
      "blog.example.com/2024/getting-started-with-webhooks-v2",
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
