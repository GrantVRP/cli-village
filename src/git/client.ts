// Talks to git: what changed, saving snapshots (commits) and sending them to
// GitHub (push). Uses your own git and your own login; CLI Village never sees
// or stores your GitHub credentials.

import path from "node:path";
import { secretGuard } from "../events/guard.js";
import { findExecutable, run, type RunResult } from "../lib/exec.js";

export interface GitProblem {
  ok: false;
  /** Our own plain explanation. Safe to put in an event. */
  error: string;
  hint?: string;
  /** What git (or a hook) said, cleaned. Printed in your terminal only, never put in an event. */
  details?: string;
}

export type FileState = "added" | "modified" | "deleted" | "renamed" | "copied" | "type changed";

export interface ChangedFile {
  path: string;
  state: FileState;
  /** For renames and copies: the old name. */
  from?: string;
}

export interface GitStatus {
  /** The branch name, or null when you're not on a branch (detached). */
  branch: string | null;
  /** True before the very first commit. */
  initial: boolean;
  /** e.g. "origin/main", if the branch is linked to one on GitHub. */
  upstream: string | null;
  /** The linked branch was deleted on GitHub (git still remembers its name). Then ahead and behind mean nothing. */
  upstreamGone: boolean;
  /** Snapshots here that the upstream doesn't have yet. */
  ahead: number;
  /** Snapshots on the upstream that you don't have yet. */
  behind: number;
  /** Ready to go into the next commit (git add was run). */
  staged: ChangedFile[];
  /** Changed but not staged. */
  unstaged: ChangedFile[];
  /** New files git isn't tracking yet. */
  untracked: string[];
  /** Files with merge conflicts to sort out. */
  conflicted: string[];
}

const GIT_TIMEOUT_MS = 60_000;

const STATES: Record<string, FileState> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type changed",
};

/** A file name made safe to print (no terminal control characters). */
export const safePath = (name: string) => name.replace(/[\u0000-\u001F\u007F-\u009F]/g, "?");

export class Git {
  private constructor(
    readonly bin: string,
    /** The top folder of the repository. */
    readonly root: string,
    /** Where you are inside it, like "app/" (empty at the top). */
    readonly prefix: string = "",
  ) {}

  /** Find git and the repository this folder is in. */
  static async open(cwd = process.cwd()): Promise<Git | GitProblem> {
    const bin = findExecutable("git");
    if (!bin) return { ok: false, error: "git isn't installed (or isn't on your PATH).", hint: "cli-village doctor" };
    const res = await run(bin, ["rev-parse", "--show-toplevel", "--show-prefix"], { cwd, timeoutMs: GIT_TIMEOUT_MS });
    if (res.code !== 0) {
      return {
        ok: false,
        error: "This folder isn't a git project yet, so there's nothing to save or send.",
        hint: "git init",
      };
    }
    const [root = "", prefix = ""] = res.stdout.split(/\r?\n/);
    return new Git(bin, root.trim(), prefix.trim());
  }

  /** A path from the top of the repository, as you'd type it from the folder you're in. */
  fromHere(file: string): string {
    return path.posix.relative(`/${this.prefix}`, `/${file}`) || ".";
  }

  /** Run git in the repository and collect its output. */
  run(args: string[], options: { timeoutMs?: number; stdin?: "inherit" } = {}): Promise<RunResult> {
    return run(this.bin, args, { cwd: this.root, timeoutMs: options.timeoutMs ?? GIT_TIMEOUT_MS, stdin: options.stdin });
  }

  async status(): Promise<GitStatus | GitProblem> {
    const res = await this.run(["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"]);
    if (res.code !== 0) return explainGitFailure(res, "read what changed");
    return parseStatus(res.stdout);
  }

  /** How many snapshots aren't on GitHub (or any remote) yet. */
  async unpushedCount(): Promise<number> {
    const res = await this.run(["rev-list", "--count", "HEAD", "--not", "--remotes"]);
    const n = Number(res.stdout.trim());
    return res.code === 0 && Number.isInteger(n) ? n : 0;
  }

  async remotes(): Promise<string[]> {
    const res = await this.run(["remote"]);
    return res.code === 0 ? res.stdout.split(/\r?\n/).map((r) => r.trim()).filter(Boolean) : [];
  }

  /** A git setting, or "" if it isn't set. */
  async config(key: string): Promise<string> {
    const res = await this.run(["config", "--get", key]);
    return res.code === 0 ? res.stdout.trim() : "";
  }

  /**
   * Which remote a branch is sent to, picked the way git does: the branch's
   * pushRemote, then remote.pushDefault, then the branch's own remote, then
   * "origin", then the first one there is.
   */
  async pushRemote(branch: string, remotes: string[]): Promise<string | undefined> {
    for (const key of [`branch.${branch}.pushRemote`, "remote.pushDefault", `branch.${branch}.remote`]) {
      const name = await this.config(key);
      if (remotes.includes(name)) return name;
    }
    return remotes.includes("origin") ? "origin" : remotes[0];
  }

  /**
   * How HEAD compares with a branch: snapshots only HEAD has (ahead) and only
   * the other has (behind). Null if that branch doesn't exist here.
   */
  async compare(ref: string): Promise<{ ahead: number; behind: number } | null> {
    if ((await this.run(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).code !== 0) return null;
    const res = await this.run(["rev-list", "--left-right", "--count", `${ref}...HEAD`]);
    const m = /^(\d+)\s+(\d+)/.exec(res.stdout.trim());
    return res.code === 0 && m ? { behind: Number(m[1]), ahead: Number(m[2]) } : null;
  }

  /** The newest commit: short id and how many files it touched. */
  async lastCommit(): Promise<{ sha: string; files: number } | null> {
    const sha = await this.run(["rev-parse", "--short", "HEAD"]);
    if (sha.code !== 0) return null;
    const files = await this.run(["show", "--name-only", "--format=", "-z", "HEAD"]);
    return { sha: sha.stdout.trim(), files: files.stdout.split("\u0000").filter(Boolean).length };
  }
}

/** Parse `git status --porcelain=v2 --branch -z`. */
export function parseStatus(out: string): GitStatus {
  const status: GitStatus = {
    branch: null,
    initial: false,
    upstream: null,
    upstreamGone: false,
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
  };
  const fields = out.split("\u0000");
  let sawAheadBehind = false;
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i]!;
    if (!entry) continue;
    if (entry.startsWith("# ")) {
      const [, key, ...rest] = entry.split(" ");
      const value = rest.join(" ");
      if (key === "branch.oid") status.initial = value === "(initial)";
      else if (key === "branch.head") status.branch = value === "(detached)" ? null : value;
      else if (key === "branch.upstream") status.upstream = value;
      else if (key === "branch.ab") {
        sawAheadBehind = true;
        const m = /^\+(\d+) -(\d+)$/.exec(value);
        if (m) {
          status.ahead = Number(m[1]);
          status.behind = Number(m[2]);
        }
      }
      continue;
    }
    const kind = entry[0];
    if (kind === "?") {
      status.untracked.push(entry.slice(2));
      continue;
    }
    if (kind === "u") {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      status.conflicted.push(entry.split(" ").slice(10).join(" "));
      continue;
    }
    if (kind === "1" || kind === "2") {
      // 1 XY sub mH mI mW hH hI path           (ordinary change)
      // 2 XY sub mH mI mW hH hI Xscore path    (rename or copy; the old name is the next field)
      const parts = entry.split(" ");
      const xy = parts[1] ?? "..";
      const pathStart = kind === "1" ? 8 : 9;
      const file = parts.slice(pathStart).join(" ");
      const from = kind === "2" ? fields[++i] : undefined;
      const staged = STATES[xy[0]!];
      const unstaged = STATES[xy[1]!];
      if (staged) status.staged.push({ path: file, state: staged, ...(from && staged !== "added" ? { from } : {}) });
      if (unstaged) status.unstaged.push({ path: file, state: unstaged });
    }
  }
  // git names the upstream but gives no ahead/behind line when that branch is gone (e.g. deleted after a merge).
  if (status.upstream && !sawAheadBehind) status.upstreamGone = true;
  return status;
}

/** Turn what git printed on failure into something a beginner can act on. */
export function explainGitFailure(res: RunResult, doing: string, remote = "GitHub"): GitProblem {
  const text = secretGuard.clean(`${res.stderr}\n${res.stdout}`);
  if (res.timedOut) return { ok: false, error: `git took too long to ${doing}. Try again in a moment.` };
  if (/please tell me who you are|user\.email|user\.name|author identity unknown|empty ident/i.test(text)) {
    return {
      ok: false,
      error: "git needs to know your name and email before it can save snapshots (they're written into each commit).",
      hint: 'git config --global user.name "Your Name" && git config --global user.email "you@example.com"',
    };
  }
  if (/\[rejected\]|non-fast-forward|fetch first|updates were rejected/i.test(text)) {
    return {
      ok: false,
      error: `${remote} has snapshots you don't have yet, so it refused yours. Bring theirs in first, then send again.`,
      hint: "git pull",
    };
  }
  if (/authentication failed|permission denied|could not read username|\b(?:401|403)\b|access denied|denied to/i.test(text)) {
    return {
      ok: false,
      error: `${remote} didn't accept your login for this project. Check you're signed in and allowed to push here.`,
      hint: "gh auth login",
    };
  }
  if (/could not resolve host|unable to access|connection timed out|network is unreachable|could not read from remote/i.test(text)) {
    return { ok: false, error: `Couldn't reach ${remote}. Check your internet connection (and the remote address) and try again.` };
  }
  // A hook's or git's own words can be anything (even a printed secret the guard can't spot),
  // so they stay in your terminal (details) and out of the village's events.
  if (/hook/i.test(text)) {
    return { ok: false, error: "A git hook (a check that runs before saving or sending) stopped it.", details: lastLines(text) || undefined };
  }
  return { ok: false, error: `git couldn't ${doing}.`, details: lastLines(text) || undefined };
}

function lastLines(text: string): string {
  return text.length > 220 ? `…${text.slice(-220)}` : text;
}

/** Files that look like they hold secrets (.env, .env.local, ...), but not templates like .env.example. */
export function looksLikeSecretsFile(file: string): boolean {
  const base = file.split("/").pop() ?? file;
  // .env, .env.local, ... and direnv's .envrc (usually full of exports).
  if (!/^\.env(\.|$|rc$)/i.test(base)) return false;
  return !/\.(example|sample|template|dist|defaults?)$/i.test(base);
}
