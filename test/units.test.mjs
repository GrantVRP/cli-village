// Small pieces: running programs safely, reading git and scan output, printing, and the terminal view.

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { dist, STRIPE_LIVE, tempDir } from "./helpers.mjs";

const { quoteArg, spawnPlan } = await import(dist("lib/exec.js"));
const { parseStatus, looksLikeSecretsFile, explainGitFailure } = await import(dist("git/client.js"));
const { readReport } = await import(dist("infisical/scan.js"));
const { createFormatter } = await import(dist("views/log.js"));
const { hubAddress } = await import(dist("hub/address.js"));
const { EventBus } = await import(dist("events/bus.js"));
const { VillageStore } = await import(dist("events/store.js"));
const { demoRound } = await import(dist("demo/script.js"));
const { App } = await import(dist("views/terminal/App.js"));
const { WAITING } = await import(dist("commands/watch.js"));
const { renderToString } = await import("ink");
const React = (await import("react")).default;

const strip = (s) => s.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");

describe("running programs", () => {
  it("quotes arguments the way Windows programs read them", () => {
    assert.equal(quoteArg("plain"), '"plain"');
    assert.equal(quoteArg('say "hi"'), '"say \\"hi\\""');
    assert.equal(quoteArg("C:\\path\\"), '"C:\\path\\\\"');
  });

  it("escapes .cmd scripts twice, so a & b can't run b", () => {
    const plan = spawnPlan("C:\\tools\\infisical.cmd", ["run", "--", "echo", "a&b|c>d"], true);
    assert.equal(plan.options.windowsVerbatimArguments, true);
    const line = plan.args.at(-1);
    assert.match(line, /a\^\^\^&b\^\^\^\|c\^\^\^>d/);
    assert.ok(!/[^^]&/.test(line.replace(/\^\^\^&/g, "")), "every & is escaped");
  });

  it("refuses characters cmd.exe can't pass safely", () => {
    assert.ok("error" in spawnPlan("x.cmd", ["100%"], true));
    assert.ok("error" in spawnPlan("x.bat", ["a\nb"], true));
    // Real programs (not .cmd) get their arguments as they are.
    assert.deepEqual(spawnPlan("/usr/bin/git", ["a&b", "100%"], false).args, ["a&b", "100%"]);
  });
});

describe("git", () => {
  it("reads git status --porcelain=v2", () => {
    const out = [
      "# branch.oid 1234567890abcdef",
      "# branch.head feature/x",
      "# branch.upstream origin/feature/x",
      "# branch.ab +2 -1",
      "1 M. N... 100644 100644 100644 aaa bbb src/app.ts",
      "1 .M N... 100644 100644 100644 aaa bbb my file.txt",
      "1 A. N... 000000 100644 100644 000 bbb new.ts",
      "2 R. N... 100644 100644 100644 aaa bbb R100 renamed.ts",
      "old.ts",
      "u UU N... 100644 100644 100644 100644 a b c both.ts",
      "? notes.txt",
      "",
    ].join("\u0000");
    const s = parseStatus(out);
    assert.equal(s.branch, "feature/x");
    assert.equal(s.upstream, "origin/feature/x");
    assert.deepEqual([s.ahead, s.behind], [2, 1]);
    assert.deepEqual(
      s.staged.map((f) => [f.state, f.path, f.from]),
      [
        ["modified", "src/app.ts", undefined],
        ["added", "new.ts", undefined],
        ["renamed", "renamed.ts", "old.ts"],
      ],
    );
    assert.deepEqual(s.unstaged, [{ path: "my file.txt", state: "modified" }]);
    assert.deepEqual(s.conflicted, ["both.ts"]);
    assert.deepEqual(s.untracked, ["notes.txt"]);
    const fresh = parseStatus("# branch.oid (initial)\u0000# branch.head main\u0000");
    assert.equal(fresh.initial, true);
    assert.equal(parseStatus("# branch.oid abc\u0000# branch.head (detached)\u0000").branch, null);
  });

  it("knows which files hold secrets", () => {
    for (const f of [".env", ".env.local", "config/.env.production", ".ENV"]) assert.equal(looksLikeSecretsFile(f), true, f);
    for (const f of [".env.example", ".env.sample", ".env.template", "env.ts", ".envrc.md", "src/.environment"]) assert.equal(looksLikeSecretsFile(f), false, f);
  });

  it("explains common git failures", () => {
    const fail = (stderr) => explainGitFailure({ code: 1, stdout: "", stderr, timedOut: false }, "send", "GitHub");
    assert.match(fail("Author identity unknown\n*** Please tell me who you are.").hint, /user\.email/);
    assert.equal(fail(" ! [rejected]        main -> main (fetch first)").hint, "git pull");
    assert.equal(fail("remote: Permission to x denied to y.\nfatal: unable to access").hint, "gh auth login");
    assert.match(fail("fatal: unable to access 'https://github.com/': Could not resolve host: github.com").error, /Couldn't reach GitHub/);
    assert.doesNotMatch(fail(`error: token ${STRIPE_LIVE} rejected weirdly`).error, /sk_live/);
  });
});

describe("secret-scan report", () => {
  it("reads only where each finding is, never the secret", async () => {
    const file = path.join(tempDir(), "report.json");
    writeFileSync(
      file,
      JSON.stringify([
        { RuleID: "stripe-access-token", Description: "Stripe Access Token", File: "src/pay.ts", StartLine: 3, Commit: "a".repeat(40), Fingerprint: `${"a".repeat(40)}:src/pay.ts:stripe-access-token:3`, Secret: STRIPE_LIVE, Match: `key = "${STRIPE_LIVE}"`, Line: STRIPE_LIVE },
        { RuleID: "x", File: "bad\u001b[31m.ts", StartLine: "nope" },
        "junk",
      ]),
    );
    const findings = await readReport(file);
    assert.equal(JSON.stringify(findings).includes(STRIPE_LIVE), false);
    assert.deepEqual(findings[0], { rule: "stripe-access-token", description: "Stripe Access Token", file: "src/pay.ts", line: 3, commit: "aaaaaaa", fingerprint: `${"a".repeat(40)}:src/pay.ts:stripe-access-token:3` });
    assert.equal(findings[1].file, "bad?[31m.ts");
    assert.equal(findings[1].line, 0);
    assert.equal(findings.length, 2);
    assert.deepEqual(await readReport(path.join(tempDir(), "missing.json")), []);
  });
});

describe("plain log lines", () => {
  const events = () => {
    const bus = new EventBus();
    const out = [];
    bus.subscribe((e) => out.push(e));
    bus.emit({ type: "start", agent: "Bolt", task: "t1", kind: "test", title: "Running tests", command: "npm test" });
    bus.emit({ type: "start", agent: "Bolt", task: "t2", kind: "test", title: "Again", command: "npm test" });
    bus.emit({ type: "fail", agent: "Bolt", task: "t2", message: "1 failed" });
    return out;
  };

  it("explains each command once in full detail, never in compact, and quiet shows only problems", () => {
    const lines = (detail) => {
      const format = createFormatter(detail);
      return events().flatMap((e) => format(e)).map(strip);
    };
    const full = lines("full");
    assert.equal(full.filter((l) => l.includes("Runs the tests")).length, 1);
    assert.ok(full.some((l) => l.includes("Fix the code")));
    assert.ok(!lines("compact").some((l) => l.includes("Runs the tests")));
    assert.deepEqual(
      lines("quiet").map((l) => l.includes("problem")),
      [true],
    );
  });
});

describe("terminal view", () => {
  const render = (store, columns, rows, extra = {}) =>
    strip(renderToString(React.createElement(App, { store, mode: "demo", onStop() {}, size: { columns, rows }, ...extra }), { columns }));

  it("fits 80x24 and 120x40 all through the demo", () => {
    const bus = new EventBus();
    const store = VillageStore.fromBus(bus);
    let n = 0;
    for (const step of [...demoRound(1), ...demoRound(2)]) {
      if (!step.event) continue;
      bus.emit(step.event, "demo");
      // Every 4th moment, plus every problem, commit and push (drawing is slow).
      if (n++ % 4 !== 0 && !["fail", "commit", "push"].includes(step.event.type)) continue;
      for (const [columns, rows] of [
        [80, 24],
        [120, 40],
      ]) {
        for (const compact of [false, true]) {
          const lines = render(store, columns, rows, { compact }).split("\n");
          assert.ok(lines.length <= rows - 1, `${lines.length} lines at ${columns}x${rows}`);
          assert.ok(lines.every((l) => l.length <= columns), `too wide at ${columns}x${rows}`);
        }
      }
    }
  });

  it("suggests what to try while it waits", () => {
    const out = render(VillageStore.fromBus(new EventBus()), 80, 24, { mode: "live", waiting: WAITING });
    assert.match(out, /cli-village status · test/);
    assert.match(out, /cli-village emit/);
  });
});

describe("socket address", () => {
  it("is private to you, and can be overridden", () => {
    assert.equal(hubAddress({}, "win32").path.startsWith("\\\\.\\pipe\\cli-village-"), true);
    assert.equal(hubAddress({ CLI_VILLAGE_SOCKET: "my-pipe" }, "win32").path, "\\\\.\\pipe\\my-pipe");
    assert.equal(hubAddress({ CLI_VILLAGE_SOCKET: "//./pipe/other" }, "win32").path, "\\\\.\\pipe\\other");
    assert.equal(hubAddress({ XDG_RUNTIME_DIR: "/run/user/1000" }, "linux").path, "/run/user/1000/cli-village/village.sock");
    assert.match(hubAddress({}, "darwin").path, /\.cli-village[\\/]village\.sock$/);
    assert.deepEqual(hubAddress({ CLI_VILLAGE_SOCKET: "/tmp/x/v.sock" }, "linux"), { path: "/tmp/x/v.sock", dir: "/tmp/x" });
  });
});
