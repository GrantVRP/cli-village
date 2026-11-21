// `cli-village status | commit | push`: the GITHUB HARBOR.
// Uses your own git and your own GitHub login. Before anything is saved or
// sent, the checkpoint gate (Infisical's secret scanner) checks it for
// passwords and keys. Found something? Nothing is saved or sent.

import { EventBus } from "../events/bus.js";
import { commitCommand } from "../events/explain.js";
import { secretGuard } from "../events/guard.js";
import { isGitRef } from "../events/validate.js";
import { explainGitFailure, Git, looksLikeSecretsFile, safePath, type ChangedFile, type GitProblem } from "../git/client.js";
import { findInfisical, type InfisicalError } from "../infisical/client.js";
import { scanStaged, scanUnpushed, showScan, STAGED_SCAN, unpushedScan, type ScanResult } from "../infisical/scan.js";
import { bold, cyan, dim, green, red, symbols, yellow } from "../lib/style.js";
import type { Ui } from "../lib/ui.js";
import { count, Output, type Problem } from "./output.js";
import { Worker, YOU, type Job } from "./worker.js";

const COMMIT_TIMEOUT_MS = 10 * 60_000; // hooks (e.g. linters) can take a while
const PUSH_TIMEOUT_MS = 10 * 60_000;
const MAX_LISTED = 20;

const isProblem = (x: object): x is GitProblem => "ok" in x && x.ok === false;

/**
 * A file in the repository as you'd type it from the folder you're in, for a
 * command to copy and paste. Only plain names (letters, numbers, . _ / -), so
 * pasting it can't run anything else; otherwise undefined (and no hint).
 */
function pasteable(git: Git, file: string): string | undefined {
  const rel = git.fromHere(file);
  return /^[\w./-]+$/.test(rel) && !rel.startsWith("-") ? rel : undefined;
}

/** The command that tells git a conflicted file is fixed. */
const markFixed = (git: Git, conflicted: string[]) => {
  const only = conflicted.length === 1 ? pasteable(git, conflicted[0]!) : undefined;
  return only ? `git add -- ${only}` : "git add <each fixed file>";
};

/** What a command works with: the repository, where to print, and the robot that does the work. */
interface Harbor {
  git: Git;
  out: Output;
  worker: Worker;
}

// --- status ------------------------------------------------------------------------------

const MARKS: Record<ChangedFile["state"], string> = {
  added: "+",
  modified: "~",
  deleted: "-",
  renamed: ">",
  copied: "+",
  "type changed": "~",
};

export const describeFile = (f: ChangedFile) =>
  `${MARKS[f.state]} ${f.state.padEnd(9)} ${f.from ? `${safePath(f.from)} ${symbols.arrow} ` : ""}${safePath(f.path)}`;

export async function runStatus(ui: Ui): Promise<number> {
  const out = new Output(ui);
  const git = await Git.open();
  if (isProblem(git)) return out.problem(git);

  const bus = new EventBus();
  const stop = out.watch(bus);
  const worker = new Worker(bus);
  const job = worker.job("git", "Checking what changed", "git status");
  const status = await git.status();
  if (isProblem(status)) {
    job.fail(status.error);
    worker.home();
    stop();
    return out.problem(status, true);
  }
  // Linked to a branch on GitHub that still exists? Then git's own ahead count is right.
  const tracked = Boolean(status.upstream) && !status.upstreamGone;
  // Otherwise count what the remote you push to doesn't have (the same thing push checks).
  const remotes = status.branch && !tracked && !status.initial ? await git.remotes() : [];
  const pushTo = status.branch && remotes.length ? (await git.pushRemote(status.branch, remotes))?.name : undefined;
  const unpushed = tracked ? status.ahead : status.initial ? 0 : ((await git.unpushedCount(pushTo)) ?? 0);
  const changed = new Set([...status.staged, ...status.unstaged].map((f) => f.path)).size + status.untracked.length + status.conflicted.length;
  const sync = status.initial
    ? "no snapshots yet"
    : unpushed
      ? `${count(unpushed, "snapshot")} not on GitHub yet`
      : tracked
        ? "GitHub is up to date"
        : status.upstreamGone
          ? "its branch on GitHub was deleted"
          : "";
  const where = status.branch ? `On ${status.branch}` : "Not on a branch";
  job.done([where, changed ? count(changed, "changed file") : "nothing changed", sync].filter(Boolean).join(" · "), undefined, changed);
  worker.home();
  stop();

  out.result({ ...status, unpushed });
  if (out.quiet) {
    for (const f of status.conflicted) out.data(`conflict: ${safePath(f)}`);
    for (const f of status.staged) out.data(`staged: ${safePath(f.path)}`);
    for (const f of status.unstaged) out.data(`changed: ${safePath(f.path)}`);
    for (const f of status.untracked) out.data(`new: ${safePath(f)}`);
    return 0;
  }

  const section = (title: string, note: string, lines: string[]) => {
    if (!lines.length) return;
    out.gap();
    out.line(`  ${bold(title)} ${dim(`(${lines.length})`)}${out.full && note ? dim(` · ${note}`) : ""}`);
    for (const l of lines.slice(0, MAX_LISTED)) out.line(`    ${l}`);
    if (lines.length > MAX_LISTED) out.line(dim(`    …and ${lines.length - MAX_LISTED} more`));
  };
  section("Merge conflicts", "pick which lines to keep in these files", status.conflicted.map((f) => red(`! ${safePath(f)}`)));
  section("Ready to save", "staged: these go into the next snapshot", status.staged.map((f) => green(describeFile(f))));
  section("Changed, not staged", "", status.unstaged.map(describeFile));
  section("New files", "git isn't tracking these yet", status.untracked.map((f) => `? ${safePath(f)}`));
  if (status.behind) {
    out.gap();
    out.line(yellow(`  ${symbols.warn} GitHub has ${count(status.behind, "snapshot")} you don't have yet.`));
  }

  // What to do next.
  out.gap();
  const next = status.conflicted.length
    ? `${markFixed(git, status.conflicted)}   (once it's fixed; then commit)`
    : changed
      ? 'cli-village commit -m "Say what you changed"'
      : status.behind
        ? "git pull"
        : unpushed
          ? "cli-village push"
          : null;
  if (next) out.line(`  ${dim("Next:")} ${cyan(next)}`);
  else out.line(dim(`  ${symbols.ok} Everything is saved${tracked ? " and on GitHub" : ""}.`));
  if (out.full && changed && !status.conflicted.length) {
    out.line(dim(status.staged.length ? "  (That saves only the files ready to save.)" : "  (That saves every change listed above.)"));
  }
  return 0;
}

// --- The checkpoint gate -----------------------------------------------------------------

const NO_SCANNER: Problem = {
  error:
    "The secret scan needs the Infisical CLI, so nothing was done. Install it, or add --skip-scan to go ahead without checking (not recommended).",
  hint: "cli-village doctor",
};

/**
 * No scanner, so nothing goes through unchecked. The robot still walks to the gate and
 * says why, so the village shows the refusal too, not only this terminal.
 */
function refuseUnchecked(out: Output, command?: string): number {
  const bus = new EventBus();
  const stop = out.watch(bus);
  const worker = new Worker(bus);
  worker.job("scan", "Checkpoint: scanning for secrets", command).fail(NO_SCANNER.error);
  worker.home();
  stop();
  return out.problem(NO_SCANNER, true);
}

function warnSkipped(out: Output): void {
  out.warn(yellow(`${symbols.warn} --skip-scan: no secret scan this time. Nothing checks this for passwords or keys.`));
}

/** One line for the village: how many, and where the first one is. Never what it is. */
export function gateMessage(scan: Pick<ScanResult, "findings" | "total">, nothing: string): string {
  const first = scan.findings[0];
  const where = first ? ` in ${safePath(first.file)}${first.line ? ` line ${first.line}` : ""}` : "";
  const more = first && scan.total > 1 ? ` (and ${scan.total - 1} more)` : "";
  return `Stopped at the gate: ${count(scan.total, "possible secret")}${where}${more} (value hidden). ${nothing}`;
}

/**
 * Finish the gate job. Returns null if the gate opens, or the exit code if it stays shut.
 * On a leak: where it is and which rule matched (never the secret), and how to fix it.
 * If the scan can't run, nothing goes through unchecked.
 */
function checkGate(out: Output, job: Job, scan: ScanResult | InfisicalError, nothing: string, inHistory: boolean): number | null {
  if (!scan.ok) {
    job.fail(`${/[.!?]$/.test(scan.error) ? scan.error : `${scan.error}.`} ${nothing}`);
    return out.problem(scan, true, { stage: "scan" });
  }
  if (scan.total === 0) {
    job.done("No secrets found. The gate opens.");
    return null;
  }
  const message = gateMessage(scan, nothing);
  job.fail(message);
  if (out.json) {
    const findings = scan.findings.map(({ rule, file, line, commit, fingerprint }) => ({ rule, file, line, commit, fingerprint }));
    return out.problem({ error: message }, true, { stage: "scan", findings, total: scan.total });
  }

  // --quiet still says where (on stderr): you need that to fix it.
  const say = (text: string) => (out.quiet ? out.warn(text) : out.line(text));
  say("");
  say(`  ${bold("Possible secrets")} ${dim("(values hidden)")}`);
  const listed = scan.findings.slice(0, MAX_LISTED);
  for (const f of listed) {
    say(`    ${red(symbols.fail)} ${safePath(f.file)}${f.line ? `:${f.line}` : ""}  ${f.description}${f.commit ? dim(` · in snapshot ${f.commit}`) : ""}`);
  }
  if (!listed.length) {
    // Infisical found something, but its report couldn't be read. Its own (redacted) output says where.
    say(`    ${dim("Infisical's report couldn't be read. To see where, run:")} ${cyan(`${scan.command} --verbose`)}`);
  } else if (scan.total > listed.length) say(dim(`    …and ${scan.total - listed.length} more`));
  if (out.quiet) return 1;

  out.line("");
  out.line(`  ${bold("To fix it:")} move the secret into Infisical and take it out of the file.`);
  if (inHistory) {
    out.line(dim("  It's in a snapshot you already saved, so changing the file isn't enough:"));
    out.line(dim(`  · in your newest snapshot? Then: ${cyan("git add --all")} and ${cyan("git commit --amend --no-edit")}`));
    out.line(dim("  · in an older one? It has to come out of the history (git rebase). Ask for help if that's new."));
  } else {
    out.line(dim(`  Then save again: ${cyan('cli-village commit -m "..."')}`));
  }
  const prints = listed.map((f) => f.fingerprint).filter((p): p is string => Boolean(p));
  if (prints.length) {
    out.line(dim("  False alarm? Add its fingerprint as a line in a file named .infisicalignore:"));
    for (const p of prints.slice(0, 3)) out.line(`    ${cyan(safePath(p))}`);
  }
  return 1;
}

// --- commit ------------------------------------------------------------------------------

export interface CommitOptions {
  message?: string;
  push?: boolean;
  skipScan?: boolean;
}

export async function runCommit(options: CommitOptions, ui: Ui): Promise<number> {
  const out = new Output(ui);
  const message = options.message?.trim() ?? "";
  if (!message) {
    return out.problem({
      error: "Add a short note about what changed (-m), so you can find this snapshot later.",
      hint: 'cli-village commit -m "Fix the login button"',
    });
  }
  // The first line is the title git shows everywhere, so it's what the village shows too.
  const title = message.split(/\r?\n/)[0]!.trim();
  const git = await Git.open();
  if (isProblem(git)) return out.problem(git);
  const status = await git.status();
  if (isProblem(status)) return out.problem(status);
  if (status.conflicted.length) {
    const one = status.conflicted.length === 1;
    return out.problem({
      error: `${count(status.conflicted.length, "file")} still ${one ? "has" : "have"} merge conflicts. Open ${one ? "it" : "each one"}, pick which lines to keep (and delete the <<<<<<< ======= >>>>>>> lines), tell git it's fixed with git add, then save again.`,
      hint: markFixed(git, status.conflicted),
    });
  }
  if (!options.skipScan && typeof findInfisical() !== "string") return refuseUnchecked(out, showScan(STAGED_SCAN));

  // What goes in: the files you staged (git add), or else every change.
  const useStaged = status.staged.length > 0;
  const nothingToSave = !useStaged && status.unstaged.length + status.untracked.length === 0;
  if (nothingToSave && !options.push) {
    out.result({ committed: false });
    out.line(`${green(symbols.ok)} Nothing to save: no files changed since your last snapshot.`);
    return 0;
  }

  // Never save a secrets file like .env, whatever the scanner says.
  const going = useStaged
    ? status.staged.filter((f) => f.state !== "deleted").map((f) => f.path)
    : [...status.unstaged.filter((f) => f.state !== "deleted").map((f) => f.path), ...status.untracked];
  const risky = going.filter(looksLikeSecretsFile);
  if (risky.length) {
    const file = risky[0]!;
    const inGit = useStaged || !status.untracked.includes(file);
    const others = risky.length > 1 ? ` (and ${risky.length - 1} more)` : "";
    const pastePath = inGit ? pasteable(git, file) : undefined;
    return out.problem(
      {
        error: inGit
          ? `${safePath(file)}${others} looks like a secrets file, so nothing was saved. Take it out of git (this keeps the file on your computer), list it in .gitignore, and keep its secrets in Infisical.`
          : `${safePath(file)}${others} looks like a secrets file, so nothing was saved. Add a line with ${safePath(file.split("/").pop()!)} to your .gitignore file so git leaves it alone, and keep its secrets in Infisical.`,
        hint: pastePath ? `git rm --cached -- ${pastePath}` : undefined,
      },
      false,
      { files: risky },
    );
  }

  const bus = new EventBus();
  const stop = out.watch(bus);
  const worker = new Worker(bus);
  const finish = (code: number) => {
    worker.home();
    stop();
    return code;
  };

  let saved: { sha: string; files: number } | null = null;
  if (nothingToSave) {
    out.line(dim("  Nothing new to save, so on to sending what's already saved."));
  } else {
    if (useStaged && (status.unstaged.length || status.untracked.length)) {
      out.line(dim(`  Saving the ${count(status.staged.length, "file")} you staged. Your other changes stay as they are.`));
    }
    let picked = false;
    if (!useStaged) {
      const job = worker.job("git", "Picking every change for the snapshot", "git add --all");
      const res = await git.run(["add", "--all"]);
      if (res.code !== 0) {
        const err = explainGitFailure(res, "pick the changes");
        job.fail(err.error);
        finish(1);
        return out.problem(err, true);
      }
      picked = true;
      job.done(`Picked ${count(status.unstaged.length + status.untracked.length, "change")}`);
    }
    // If we picked the changes and then stop, put them back how they were (changed, but not staged).
    // (-f: a file edited during the scan would otherwise make git refuse to un-pick anything.)
    const unpick = async () => {
      if (!picked) return;
      const args = status.initial ? ["rm", "-r", "--cached", "-f", "-q", "--ignore-unmatch", "--", "."] : ["reset", "-q"];
      if ((await git.run(args)).code !== 0) {
        out.warn(yellow(`  ${symbols.warn} Couldn't put your changes back how they were, so they're still picked (staged). To un-pick them:`));
        out.warn(`    ${cyan(`git ${args.filter((a) => a !== "-q").join(" ")}`)}`);
      }
    };

    if (options.skipScan) warnSkipped(out);
    else {
      const job = worker.job("scan", "Checkpoint: scanning your changes for secrets", showScan(STAGED_SCAN));
      const shut = checkGate(out, job, await scanStaged(git.root), "Nothing was saved.", false);
      if (shut !== null) {
        await unpick();
        return finish(shut);
      }
    }

    const job = worker.job("git", "Saving a snapshot of your work", commitCommand(title));
    // The keyboard stays connected, so a signing passphrase prompt still works.
    const res = await git.run(["commit", "--quiet", "-m", message], { timeoutMs: COMMIT_TIMEOUT_MS, stdin: "inherit" });
    if (res.code !== 0) {
      await unpick();
      const err = explainGitFailure(res, "save the snapshot");
      job.fail(err.error);
      finish(1);
      return out.problem(err, true);
    }
    saved = await git.lastCommit();
    bus.emit({ type: "commit", agent: YOU, message: title, sha: saved?.sha, files: saved?.files });
    job.done(saved ? `Saved snapshot ${saved.sha} (${count(saved.files, "file")}), packed in a crate` : "Saved the snapshot");
  }

  const committed = { committed: Boolean(saved), sha: saved?.sha, files: saved?.files, message: secretGuard.clean(title), scanned: !options.skipScan };
  if (!options.push) {
    finish(0);
    out.result(committed);
    if (out.quiet && saved) out.data(saved.sha);
    out.gap();
    out.line(`  ${dim("Next:")} ${cyan("cli-village push")}${out.full ? dim("   sends it to GitHub (after another secret scan)") : ""}`);
    return 0;
  }

  // The snapshot is saved now, even if sending it fails: say so, and give its id first.
  out.keep(committed);
  if (out.quiet && saved) out.data(saved.sha);
  const pushed = await pushFlow({ git, out, worker }, options.skipScan === true);
  finish(pushed.code);
  if (pushed.code === 0) {
    out.result({ pushed: pushed.result });
    pushed.after();
  } else if (saved && !out.quiet) {
    out.line(dim(`  Your snapshot ${saved.sha} is saved on this computer. Once that's sorted:`) + ` ${cyan("cli-village push")}`);
  }
  return pushed.code;
}

// --- push --------------------------------------------------------------------------------

export interface PushOptions {
  skipScan?: boolean;
}

export async function runPush(options: PushOptions, ui: Ui): Promise<number> {
  const out = new Output(ui);
  const git = await Git.open();
  if (isProblem(git)) return out.problem(git);
  if (!options.skipScan && typeof findInfisical() !== "string") return refuseUnchecked(out);
  const bus = new EventBus();
  const stop = out.watch(bus);
  const worker = new Worker(bus);
  const pushed = await pushFlow({ git, out, worker }, options.skipScan === true);
  worker.home();
  stop();
  if (pushed.code === 0) {
    out.result({ pushed: pushed.result, scanned: !options.skipScan });
    pushed.after();
  }
  return pushed.code;
}

type Pushed = { remote: string; branch: string; commits: number } | { nothingToSend: true };

/**
 * Check, scan, then send. Problems are printed as they happen. On success,
 * `after` prints the closing lines (once the robot is home and the views are done).
 */
async function pushFlow({ git, out, worker }: Harbor, skipScan: boolean): Promise<{ code: number; result?: Pushed; after: () => void }> {
  const none = () => {};
  const problem = (err: Problem) => ({ code: out.problem(err), after: none });
  const status = await git.status();
  if (isProblem(status)) return problem(status);
  if (!status.branch) {
    return problem({
      error: "You're not on a branch right now (git calls this a detached HEAD), so there's nowhere to send your snapshots. Start a branch here first.",
      hint: "git switch -c my-branch",
    });
  }
  if (status.initial) {
    return problem({ error: "There are no snapshots to send yet. Save one first.", hint: 'cli-village commit -m "First snapshot"' });
  }
  const remotes = await git.remotes();
  if (!remotes.length) {
    return problem({
      error: "This project isn't linked to GitHub yet. Make a repository for it on GitHub (this command does it and links it), then push again.",
      hint: "gh repo create --source=. --private",
    });
  }
  const branch = status.branch;
  const picked = (await git.pushRemote(branch, remotes))!;
  const remote = picked.name;
  if (remote.startsWith("-")) return problem({ error: `The remote name "${safePath(remote)}" can't be used safely. Rename it with git remote rename.` });
  // Only checked, never shown: a remote address can contain a login token.
  const url = (await git.run(["remote", "get-url", remote])).stdout;
  const target = /github\.com/i.test(url) ? "GitHub" : remote;

  // Always send exactly this branch, under its own name: never what push.default or
  // remote.*.push would pick, which could include branches the scan didn't check.
  // (That's also what a beginner means after `git switch -c my-idea origin/main`.)
  const there = await git.compare(`refs/remotes/${remote}/${branch}`);
  const linked = status.upstream === `${remote}/${branch}` && !status.upstreamGone;
  const pull = linked ? "git pull" : `git pull ${remote} ${branch}`;

  if (there && there.ahead === 0) {
    const after = () => {
      out.line(`${green(symbols.ok)} Nothing new to send: ${target} already has all your snapshots on ${safePath(branch)}.`);
      if (there.behind) out.line(`  ${dim(`${target} has ${count(there.behind, "newer snapshot")}. To bring them in:`)} ${cyan(pull)}`);
    };
    return { code: 0, result: { nothingToSend: true }, after };
  }
  if (there && there.behind > 0) {
    return problem({
      error: `${target} has ${count(there.behind, "snapshot")} on ${safePath(branch)} you don't have yet, so it would refuse yours. Bring them in first, then push again.`,
      hint: pull,
    });
  }
  if (status.upstreamGone && !there && out.full) {
    out.line(dim(`  ${safePath(branch)} was deleted on ${target} (often after a pull request is merged), so it'll be made again.`));
  }
  // Null: git couldn't count them. Then scan anyway: never assume there's nothing to check.
  const toSend = there ? there.ahead : await git.unpushedCount(remote);
  const snapshots = toSend === null ? "your snapshots" : count(toSend, "snapshot");

  if (skipScan) warnSkipped(out);
  else if (toSend !== 0) {
    const job = worker.job("scan", `Checkpoint: scanning ${snapshots} for secrets`, showScan(unpushedScan(remote)));
    const shut = checkGate(out, job, await scanUnpushed(git.root, remote), "Nothing was sent.", true);
    if (shut !== null) return { code: shut, after: none };
  }

  // Link the branch (--set-upstream) only if it isn't linked to anything yet: never
  // change a link you set up yourself, or one to where you pull from when you push to a fork.
  const link = (!status.upstream || status.upstreamGone) && !picked.separate;
  // --recurse-submodules=check: never send a submodule's snapshots along (the scan doesn't see inside them).
  const args = ["push", "--recurse-submodules=check", ...(link ? ["--set-upstream"] : []), remote, `HEAD:refs/heads/${branch}`];
  const job = worker.job("git", toSend !== 0 ? `Sending ${snapshots} to ${target}` : `Publishing ${branch} on ${target}`, `git ${args.join(" ")}`);
  // The keyboard stays connected, so a login prompt still works.
  const res = await git.run(args, { timeoutMs: PUSH_TIMEOUT_MS, stdin: "inherit" });
  if (res.code !== 0) {
    const err = explainGitFailure(res, "send your snapshots", target);
    job.fail(err.error);
    return { code: out.problem(err, true), after: none };
  }
  // (An unusual branch name is left out rather than losing the whole event.)
  const ref = (name: string) => (isGitRef(name) ? name : undefined);
  worker.bus.emit({ type: "push", agent: YOU, remote: ref(remote), branch: ref(branch), commits: toSend ?? undefined });
  job.done(`Your work is safe on ${target}: ${toSend !== 0 ? snapshots : "the branch"} on ${remote}/${branch}`);

  const after = () => {
    // A new branch on GitHub? The usual next step is a pull request.
    if (out.full && !there && target === "GitHub" && !/^(main|master)$/.test(branch)) {
      out.gap();
      out.line(`  ${dim("Next, to ask for this branch to be added to main (a pull request):")} ${cyan("gh pr create")}`);
    }
  };
  return { code: 0, result: { remote, branch, commits: toSend ?? 0 }, after };
}
