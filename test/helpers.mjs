// Shared helpers for the tests: run the built CLI with the fake Infisical,
// make throwaway git repositories, and check output for leaked secrets.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
export const { ENVIRONMENTS, SECRET_VALUES, STRIPE_TEST, STRIPE_LIVE, AWS_KEY } = require("./fixtures/secrets.cjs");

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..");
export const CLI = path.join(ROOT, "dist", "cli.js");
export const FAKE_BIN = path.join(here, "fixtures", "bin");
export const dist = (file) => new URL(`../dist/${file}`, import.meta.url).href;

/** A socket address no real village uses, so tests never talk to yours. */
export function testSocket() {
  const name = `cli-village-test-${process.pid}-${randomBytes(4).toString("hex")}`;
  return process.platform === "win32" ? `\\\\.\\pipe\\${name}` : path.join(tempDir(), "village.sock");
}

/** The environment for running the CLI: the fake Infisical first on PATH, no colors, no forwarding. */
export function cliEnv(extra = {}) {
  return {
    ...process.env,
    PATH: `${FAKE_BIN}${path.delimiter}${process.env.PATH ?? ""}`,
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    CLI_VILLAGE_FORWARD: "0",
    CLI_VILLAGE_SOCKET: testSocket(),
    GIT_TERMINAL_PROMPT: "0",
    ...extra,
  };
}

/** Run `cli-village <args>` and collect what it printed. */
export function cli(args, { cwd = ROOT, env = {}, input } = {}) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: cliEnv(env),
    input,
    encoding: "utf8",
    timeout: 60_000,
  });
  return { code: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "", all: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

const temps = [];
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** A new empty folder, removed after the tests. */
export function tempDir() {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "cv-test-")));
  temps.push(dir);
  return dir;
}

/** Run git in a folder (throws if it fails). */
export function git(cwd, ...args) {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  return res.stdout.trim();
}

/** A git repository with a name and email set (and, with `remote`, a local bare "GitHub" called origin). */
export function tempRepo({ remote = false } = {}) {
  const dir = tempDir();
  const work = path.join(dir, "work");
  if (remote) git(dir, "init", "-q", "--bare", "remote.git");
  git(dir, "init", "-q", "-b", "main", "work");
  git(work, "config", "user.name", "Test Robot");
  git(work, "config", "user.email", "robot@example.com");
  git(work, "config", "commit.gpgsign", "false");
  git(work, "config", "core.autocrlf", "false");
  if (remote) git(work, "remote", "add", "origin", path.join(dir, "remote.git"));
  return { dir, work, remote: path.join(dir, "remote.git") };
}

/** Which pretend secret values appear in the text (should always be none). */
export function leaks(text) {
  return SECRET_VALUES.filter((value) => text.includes(value));
}

/** Parse each line of JSON output. */
export const jsonLines = (text) =>
  text
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith("{"))
    .map((l) => JSON.parse(l));

// Code the tests run in this process never sends events to a village you have open,
// and never looks for one in your own folders.
process.env.CLI_VILLAGE_FORWARD = "0";
process.env.CLI_VILLAGE_SOCKET = testSocket();
