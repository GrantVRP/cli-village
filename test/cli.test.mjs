// End to end: the real CLI, with the fake Infisical, in throwaway git repositories.
// Every output is also checked for leaked secret values.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { AWS_KEY, cli, dist, git, jsonLines, leaks, STRIPE_LIVE, tempDir, tempRepo } from "./helpers.mjs";

const { findExecutable } = await import(dist("lib/exec.js"));

// Everything any test printed, checked for secrets at the end.
let printed = "";
const run = (args, options) => {
  const res = cli(args, options);
  printed += res.all;
  return res;
};
after(() => assert.deepEqual(leaks(printed), [], "a secret value was printed"));

describe("basics", () => {
  it("shows help and the version", () => {
    const help = run(["--help"]);
    assert.equal(help.code, 0);
    for (const cmd of ["doctor", "secrets", "run", "status", "commit", "push", "test", "watch", "emit", "open"]) assert.match(help.stdout, new RegExp(`\\b${cmd}\\b`));
    assert.ok(help.stdout.split("\n").every((l) => l.length <= 80), "help fits 80 columns");
    assert.match(run(["--version"]).stdout, /^\d+\.\d+\.\d+/);
    // In a pipe, plain `cli-village` shows help instead of the live view.
    assert.match(run([]).stdout, /Usage: cli-village/);
  });

  it("plays the demo as JSON lines", () => {
    const res = run(["--demo", "--once", "--json", "--speed", "50"]);
    assert.equal(res.code, 0);
    const events = jsonLines(res.stdout);
    assert.ok(events.length > 20);
    assert.ok(events.every((e) => e.v === 1 && e.source === "demo"));
    assert.ok(events.some((e) => e.type === "push"));
  });

  it("checks the setup with doctor", () => {
    const report = JSON.parse(run(["doctor", "--json"]).stdout);
    assert.deepEqual(
      report.checks.map((c) => c.id),
      ["node", "git", "git-repo", "infisical", "infisical-login", "infisical-project"],
    );
    for (const check of report.checks) {
      assert.ok(check.title && check.explain, `${check.id} explains itself`);
      assert.ok(["ok", "warn", "fail", "skip"].includes(check.status), `${check.id}: ${check.status}`);
    }
    // The pretend Infisical is installed and logged in.
    assert.equal(report.checks.find((c) => c.id === "infisical").status, "ok");
    assert.equal(report.checks.find((c) => c.id === "infisical-login").status, "ok");
    const none = run(["doctor", "-q"], { env: { FAKE_MODE: "none" } });
    assert.match(none.stderr, /log/i);
  });
});

describe("the VAULT (secrets)", () => {
  it("lists key names, never values", () => {
    const res = run(["secrets", "fetch", "--env", "dev", "--json"]);
    assert.equal(res.code, 0);
    const data = JSON.parse(res.stdout);
    assert.deepEqual(data.keys, ["DATABASE_URL", "DEBUG_PAYMENTS", "RETRY_LIMIT", "SHARED_SAME", "STRIPE_SECRET_KEY"]);
    assert.deepEqual(run(["secrets", "fetch", "--env", "dev", "-q"]).stdout.trim().split(/\r?\n/), data.keys);
    assert.match(run(["secrets", "fetch", "--env", "prod"]).stdout, /can see 1 name but not the value/);
  });

  it("compares environments by name", () => {
    const data = JSON.parse(run(["secrets", "diff", "dev", "prod", "--json"]).stdout);
    assert.deepEqual(data.onlyInA, ["DEBUG_PAYMENTS", "RETRY_LIMIT"]);
    assert.deepEqual(data.onlyInB, ["LOCKED_KEY", "SENTRY_DSN"]);
    assert.deepEqual(data.differentValues, ["DATABASE_URL", "STRIPE_SECRET_KEY"]);
    assert.equal(data.same, 1);
  });

  it("explains Infisical problems, and hides secrets in its error text", () => {
    const notLogged = run(["secrets", "fetch", "--json"], { env: { FAKE_MODE: "notlogged" } });
    assert.equal(notLogged.code, 1);
    assert.equal(JSON.parse(notLogged.stdout).hint, "infisical login");
    assert.match(run(["secrets", "fetch"], { env: { FAKE_MODE: "noproject" } }).stdout, /infisical init/);
    assert.equal(run(["secrets", "fetch"], { env: { FAKE_MODE: "leaky" } }).code, 1);
    assert.match(run(["secrets", "fetch", "--env", "bad env"]).stdout, /isn't an environment name/);
  });

  it("only writes secrets to a file git will ignore", () => {
    const { work } = tempRepo();
    const refused = run(["secrets", "export", "--out", ".env"], { cwd: work });
    assert.equal(refused.code, 1);
    assert.match(refused.stdout, /isn't listed in \.gitignore/);
    assert.equal(existsSync(path.join(work, ".env")), false);
    // The suggested fix works even when .gitignore's last line has no line break.
    writeFileSync(path.join(work, ".gitignore"), "node_modules");
    const { hint } = JSON.parse(run(["secrets", "export", "--out", ".env", "--json"], { cwd: work }).stdout);
    if (process.platform === "win32") {
      assert.equal(hint, undefined);
      writeFileSync(path.join(work, ".gitignore"), "node_modules\n.env\n");
    } else {
      assert.equal(spawnSync("sh", ["-c", hint], { cwd: work }).status, 0, hint);
      assert.equal(readFileSync(path.join(work, ".gitignore"), "utf8"), "node_modules\n.env\n");
    }
    const ok = run(["secrets", "export", "--out", ".env", "--json"], { cwd: work });
    assert.equal(ok.code, 0, ok.all);
    assert.equal(JSON.parse(ok.stdout).count, 5);
    assert.match(readFileSync(path.join(work, ".env"), "utf8"), /DATABASE_URL=/);
    if (process.platform !== "win32") assert.equal(statSync(path.join(work, ".env")).mode & 0o777, 0o600);
    assert.match(run(["secrets", "export", "--out", ".env"], { cwd: work }).stdout, /already exists/);
  });

  it("runs a program with secrets, passing its output and exit code through", () => {
    const has = run(["run", "--env", "dev", "-q", "--", process.execPath, "-e", "process.stdout.write(String(Boolean(process.env.DATABASE_URL)))"]);
    assert.equal(has.stdout, "true");
    assert.equal(has.stderr, "", "quiet run adds nothing");
    assert.equal(run(["run", "-q", "--", process.execPath, "-e", "process.exit(7)"]).code, 7);
    const json = run(["run", "--json", "--", process.execPath, "-e", "0"]);
    assert.ok(jsonLines(json.stderr).length >= 2, "json events go to stderr");
    assert.equal(json.stdout, "");
  });
});

describe("the GITHUB HARBOR (status, commit, push)", () => {
  const leakyLine = `const key = "${STRIPE_LIVE}";\n`;

  it("explains status in plain English", () => {
    const { work } = tempRepo();
    writeFileSync(path.join(work, "a.txt"), "hi\n");
    const res = run(["status"], { cwd: work });
    assert.match(res.stdout, /New files \(1\)/);
    assert.match(res.stdout, /Next: cli-village commit -m/);
    const data = JSON.parse(run(["status", "--json"], { cwd: work }).stdout);
    assert.deepEqual([data.branch, data.initial, data.untracked], ["main", true, ["a.txt"]]);
    assert.equal(run(["status", "-q"], { cwd: work }).stdout.trim(), "new: a.txt");
    assert.match(run(["status"], { cwd: tempDir() }).stdout, /isn't a git project/);
  });

  it("stops a commit with a secret in it, and puts the files back", () => {
    const { work } = tempRepo();
    writeFileSync(path.join(work, "pay.js"), leakyLine);
    const res = run(["commit", "-m", "Add payments", "--json"], { cwd: work, env: { FAKE_SCAN: "unredacted" } });
    assert.equal(res.code, 1);
    const data = JSON.parse(res.stdout);
    assert.equal(data.stage, "scan");
    assert.deepEqual(data.findings.map((f) => [f.file, f.line, f.rule]), [["pay.js", 1, "stripe-access-token"]]);
    assert.equal(git(work, "status", "--porcelain"), "?? pay.js", "nothing staged, nothing saved");
    const human = run(["commit", "-m", "Add payments"], { cwd: work });
    assert.match(human.stdout, /Stopped at the gate: 1 possible secret in pay\.js line 1 \(value hidden\)\. Nothing was saved\./);
    assert.match(human.stdout, /\.infisicalignore/);
  });

  it("never saves a .env file", () => {
    const { work } = tempRepo();
    writeFileSync(path.join(work, ".env"), "A=1\n");
    writeFileSync(path.join(work, ".env.example"), "A=\n");
    const res = run(["commit", "-m", "x"], { cwd: work });
    assert.equal(res.code, 1);
    assert.match(res.stdout, /\.env looks like a secrets file/);
    git(work, "add", ".env");
    assert.match(run(["commit", "-m", "x"], { cwd: work }).stdout, /git rm --cached -- \.env/);

    // The suggested command works from where you are, and is only offered for plain names.
    git(work, "rm", "-q", "--cached", ".env");
    mkdirSync(path.join(work, "app"));
    writeFileSync(path.join(work, "app", ".env"), "A=1\n");
    git(work, "add", "app/.env");
    const fromApp = JSON.parse(run(["commit", "-m", "x", "--json"], { cwd: path.join(work, "app") }).stdout);
    assert.equal(fromApp.hint, "git rm --cached -- .env");
    assert.equal(JSON.parse(run(["commit", "-m", "x", "--json"], { cwd: work }).stdout).hint, "git rm --cached -- app/.env");
    git(work, "rm", "-q", "--cached", "app/.env");
    const odd = ".env.$(touch pwned)";
    writeFileSync(path.join(work, odd), "A=1\n");
    git(work, "add", "--", odd);
    const oddRes = JSON.parse(run(["commit", "-m", "x", "--json"], { cwd: work }).stdout);
    assert.equal(oddRes.hint, undefined);
    assert.match(oddRes.error, /looks like a secrets file/);
  });

  it("saves, then sends, scanning each time", () => {
    const { work, remote } = tempRepo({ remote: true });
    writeFileSync(path.join(work, "README.md"), "# Hi\n");
    const saved = run(["commit", "-q", "-m", "First snapshot"], { cwd: work });
    assert.equal(saved.code, 0, saved.all);
    assert.equal(saved.stdout.trim(), git(work, "rev-parse", "--short", "HEAD"));
    const pushed = run(["push", "--json"], { cwd: work });
    assert.equal(pushed.code, 0, pushed.all);
    assert.deepEqual(JSON.parse(pushed.stdout).pushed, { remote: "origin", branch: "main", commits: 1 });
    assert.equal(git(remote, "rev-parse", "main"), git(work, "rev-parse", "HEAD"));
    assert.match(run(["push"], { cwd: work }).stdout, /Nothing new to send/);
    assert.match(run(["commit", "-m", "x"], { cwd: work }).stdout, /Nothing to save/);

    // Only what you staged is saved.
    writeFileSync(path.join(work, "a.txt"), "a\n");
    writeFileSync(path.join(work, "b.txt"), "b\n");
    git(work, "add", "a.txt");
    assert.equal(run(["commit", "-m", "Just a", "--push"], { cwd: work }).code, 0);
    assert.equal(git(work, "status", "--porcelain"), "?? b.txt");
    assert.equal(git(remote, "rev-parse", "main"), git(work, "rev-parse", "HEAD"));
  });

  it("stops a push when an earlier snapshot has a secret", () => {
    const { work, remote } = tempRepo({ remote: true });
    writeFileSync(path.join(work, "README.md"), "# Hi\n");
    run(["commit", "-q", "-m", "First"], { cwd: work });
    run(["push", "-q"], { cwd: work });
    writeFileSync(path.join(work, "keys.py"), `aws = "${AWS_KEY}"\n`);
    const skipped = run(["commit", "--skip-scan", "-m", "Add keys"], { cwd: work });
    assert.match(skipped.stdout, /--skip-scan: no secret scan/);
    const before = git(remote, "rev-parse", "main");
    const res = run(["push"], { cwd: work, env: { FAKE_SCAN: "unredacted" } });
    assert.equal(res.code, 1);
    assert.match(res.stdout, /Stopped at the gate: 1 possible secret in keys\.py line 1 \(value hidden\)\. Nothing was sent\./);
    assert.match(res.stdout, /git commit --amend --no-edit/);
    assert.equal(git(remote, "rev-parse", "main"), before, "nothing reached the remote");
  });

  it("sends only this branch, under its own name, whatever git's push settings say", () => {
    const { work, remote } = tempRepo({ remote: true });
    writeFileSync(path.join(work, "README.md"), "# Hi\n");
    assert.equal(run(["commit", "-q", "-m", "First", "--push"], { cwd: work }).code, 0);
    // Another branch on GitHub gets a snapshot with a secret, which this push doesn't scan.
    git(work, "switch", "-q", "-c", "other");
    git(work, "push", "-q", "origin", "other");
    writeFileSync(path.join(work, "keys.py"), `aws = "${AWS_KEY}"\n`);
    git(work, "add", "keys.py");
    git(work, "commit", "-q", "-m", "Keys");
    git(work, "switch", "-q", "main");
    git(work, "config", "push.default", "matching"); // a bare `git push` would send "other" too
    writeFileSync(path.join(work, "a.txt"), "a\n");
    const res = run(["commit", "-q", "-m", "A", "--push"], { cwd: work });
    assert.equal(res.code, 0, res.all);
    assert.equal(git(remote, "rev-parse", "main"), git(work, "rev-parse", "main"));
    assert.notEqual(git(remote, "rev-parse", "other"), git(work, "rev-parse", "other"), "the unscanned branch stayed here");

    // A branch made from origin/main goes up under its own name (and is linked to it), leaving main alone.
    git(work, "switch", "-q", "-c", "my-idea", "origin/main");
    writeFileSync(path.join(work, "idea.txt"), "idea\n");
    const idea = run(["commit", "-m", "Idea", "--push", "--json"], { cwd: work });
    assert.equal(idea.code, 0, idea.all);
    assert.deepEqual(JSON.parse(idea.stdout).pushed, { remote: "origin", branch: "my-idea", commits: 1 });
    assert.equal(git(remote, "rev-parse", "my-idea"), git(work, "rev-parse", "HEAD"));
    assert.equal(git(remote, "rev-parse", "main"), git(work, "rev-parse", "main"));
    assert.equal(git(work, "rev-parse", "--abbrev-ref", "@{u}"), "origin/my-idea");

    // Deleted on GitHub (say, after the pull request was merged): status doesn't
    // claim it's up to date, and push makes the branch again.
    git(work, "push", "-q", "origin", "--delete", "my-idea");
    git(work, "fetch", "-q", "--prune");
    writeFileSync(path.join(work, "more.txt"), "more\n");
    assert.equal(run(["commit", "-q", "-m", "More"], { cwd: work }).code, 0);
    const status = JSON.parse(run(["status", "--json"], { cwd: work }).stdout);
    assert.equal(status.upstreamGone, true);
    assert.equal(status.unpushed, 2);
    assert.doesNotMatch(run(["status"], { cwd: work }).stdout, /up to date/);
    const again = run(["push", "--json"], { cwd: work });
    assert.equal(again.code, 0, again.all);
    assert.deepEqual(JSON.parse(again.stdout).pushed, { remote: "origin", branch: "my-idea", commits: 2 });
    assert.equal(git(remote, "rev-parse", "my-idea"), git(work, "rev-parse", "HEAD"));
  });

  it("walks you through a merge conflict", () => {
    const { work } = tempRepo();
    writeFileSync(path.join(work, "a.txt"), "base\n");
    git(work, "add", "a.txt");
    git(work, "commit", "-q", "-m", "Base");
    git(work, "switch", "-q", "-c", "other");
    writeFileSync(path.join(work, "a.txt"), "theirs\n");
    git(work, "commit", "-q", "-am", "Theirs");
    git(work, "switch", "-q", "main");
    writeFileSync(path.join(work, "a.txt"), "ours\n");
    git(work, "commit", "-q", "-am", "Ours");
    assert.notEqual(spawnSync("git", ["merge", "-q", "other"], { cwd: work }).status, 0, "the merge stops with a conflict");

    assert.match(run(["status"], { cwd: work }).stdout, /Next: git add -- a\.txt/);
    const refused = JSON.parse(run(["commit", "-m", "Merge", "--json"], { cwd: work }).stdout);
    assert.match(refused.error, /merge conflicts.*git add/);
    assert.equal(refused.hint, "git add -- a.txt");
    writeFileSync(path.join(work, "a.txt"), "ours and theirs\n");
    git(work, "add", "--", "a.txt");
    const saved = run(["commit", "-m", "Merge other"], { cwd: work });
    assert.equal(saved.code, 0, saved.all);
    assert.equal(git(work, "rev-list", "--count", "--merges", "HEAD"), "1");
  });

  it("still gives the snapshot's id when sending it fails", () => {
    const { work } = tempRepo(); // no remote, so the push step fails
    writeFileSync(path.join(work, "a.txt"), "a\n");
    const res = run(["commit", "-m", "A", "--push", "--json"], { cwd: work });
    assert.equal(res.code, 1);
    const data = JSON.parse(res.stdout);
    assert.equal(data.ok, false);
    assert.match(data.error, /isn't linked to GitHub/);
    assert.equal(data.committed, true);
    assert.equal(data.sha, git(work, "rev-parse", "--short", "HEAD"));
    writeFileSync(path.join(work, "b.txt"), "b\n");
    const quiet = run(["commit", "-q", "-m", "B", "--push"], { cwd: work });
    assert.equal(quiet.code, 1);
    assert.equal(quiet.stdout.trim(), git(work, "rev-parse", "--short", "HEAD"));
  });

  it("puts the files back after a stopped first snapshot, even if one changed during the scan", () => {
    const { work } = tempRepo();
    writeFileSync(path.join(work, "pay.js"), leakyLine);
    writeFileSync(path.join(work, "notes.txt"), "notes\n");
    const res = run(["commit", "-m", "First"], { cwd: work, env: { FAKE_SCAN_TOUCH: "notes.txt" } });
    assert.equal(res.code, 1);
    assert.doesNotMatch(res.all, /Couldn't put your changes back/);
    assert.equal(git(work, "diff", "--cached", "--name-only"), "", "nothing is left staged");
  });

  it("refuses to go unchecked when the scanner is missing or broken", () => {
    const { work } = tempRepo();
    writeFileSync(path.join(work, "a.txt"), "a\n");
    // A PATH with git and node, but no Infisical.
    const bare = [path.dirname(process.execPath), path.dirname(findExecutable("git"))].join(path.delimiter);
    const missing = run(["commit", "-m", "x"], { cwd: work, env: { PATH: bare } });
    assert.equal(missing.code, 1);
    assert.match(missing.stdout, /needs the Infisical CLI/);
    const broken = run(["commit", "-m", "x", "--compact"], { cwd: work, env: { FAKE_MODE: "scanerror" } });
    assert.equal(broken.code, 1);
    assert.match(broken.stdout, /couldn't run/);
    assert.equal(git(work, "status", "--porcelain"), "?? a.txt");
    assert.match(run(["commit", "-m", "x"], { cwd: work, env: { FAKE_MODE: "scanold" } }).stdout, /too old/);
  });

  it("explains a missing git identity and a detached HEAD", () => {
    const { work } = tempRepo({ remote: true });
    writeFileSync(path.join(work, "a.txt"), "a\n");
    git(work, "config", "--unset", "user.name");
    git(work, "config", "--unset", "user.email");
    const home = tempDir();
    const noId = run(["commit", "-m", "x", "--skip-scan"], {
      cwd: work,
      env: { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: path.join(home, "none"), GIT_AUTHOR_NAME: "", GIT_AUTHOR_EMAIL: "", EMAIL: "" },
    });
    assert.equal(noId.code, 1);
    assert.match(noId.stdout, /name and email/);
    git(work, "config", "user.name", "T");
    git(work, "config", "user.email", "t@example.com");
    run(["commit", "-q", "-m", "x"], { cwd: work });
    git(work, "checkout", "-q", "--detach");
    assert.match(run(["push"], { cwd: work }).stdout, /detached HEAD/);
  });
});

describe("the LAB (tests)", () => {
  it("finds and runs the project's test script", () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "lab", scripts: { test: 'node -e "console.log(42)"' } }));
    const res = run(["test", "--json"], { cwd: dir });
    assert.equal(res.code, 0, res.all);
    assert.deepEqual(JSON.parse(res.stdout), { ok: true, command: "npm test", exitCode: 0 });
    assert.match(res.stderr, /42/, "the test output moves to stderr with --json");
    const plain = run(["test", "--compact"], { cwd: dir });
    assert.match(plain.stdout, /42/);
    assert.match(plain.stderr, /Tests passed/);
  });

  it("passes on the exit code of a given command", () => {
    const res = run(["test", "--", process.execPath, "-e", "process.exit(3)"], { cwd: tempDir() });
    assert.equal(res.code, 3);
    assert.match(res.stderr, /Tests failed \(exit code 3\)/);
  });

  it("says when there are no tests", () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
    git(dir, "init", "-q");
    const res = run(["test"], { cwd: dir });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /no test script yet/);
  });
});
