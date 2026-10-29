// `cli-village doctor`: checks that everything CLI Village needs is installed and ready.
// Each check explains itself in plain English and shows the real command behind it.

import { existsSync } from "node:fs";
import path from "node:path";
import { findExecutable, run } from "../lib/exec.js";
import { maskTokens } from "../lib/redact.js";
import { bold, cyan, dim, green, red, symbols, yellow } from "../lib/style.js";
import { DEFAULT_UI, type Detail, type Ui } from "../lib/ui.js";

export type CheckStatus = "ok" | "warn" | "fail" | "skip";

export interface CheckResult {
  id: string;
  /** Short name, e.g. "Infisical login". */
  title: string;
  /** One plain-English line: what we're checking and why. */
  explain: string;
  /** The real command behind the check. */
  command: string;
  status: CheckStatus;
  /** What we found. Never contains secret values or tokens. */
  detail: string;
  /** What to do about a problem. */
  fix?: string;
}

const MIN_NODE_MAJOR = 22;

function checkNode(): CheckResult {
  const version = process.versions.node;
  const major = Number(version.split(".")[0]);
  const base = {
    id: "node",
    title: "Node.js",
    explain: "Node.js runs CLI Village. Checking its version",
    command: "node --version",
  };
  if (major >= MIN_NODE_MAJOR) {
    return { ...base, status: "ok", detail: `v${version}` };
  }
  return {
    ...base,
    status: "fail",
    detail: `v${version} is too old (needs ${MIN_NODE_MAJOR} or newer)`,
    fix: "Install the LTS version from https://nodejs.org",
  };
}

async function checkGit(gitPath: string | null): Promise<CheckResult> {
  const base = {
    id: "git",
    title: "git",
    explain: "git saves snapshots of your code. Checking it's installed",
    command: "git --version",
  };
  if (!gitPath) {
    return {
      ...base,
      status: "fail",
      detail: "not installed",
      fix: "Install git from https://git-scm.com/downloads",
    };
  }
  const result = await run(gitPath, ["--version"], { timeoutMs: 10_000 });
  if (result.code !== 0) {
    return { ...base, status: "fail", detail: "installed, but didn't respond", fix: "Reinstall git" };
  }
  return { ...base, status: "ok", detail: result.stdout.trim() };
}

async function checkGitRepo(gitPath: string | null): Promise<CheckResult> {
  const base = {
    id: "git-repo",
    title: "git project",
    explain: "Checking this folder is a git project (needed for commits and pushes)",
    command: "git rev-parse --is-inside-work-tree",
  };
  if (!gitPath) return { ...base, status: "skip", detail: "skipped (git isn't installed)" };

  const result = await run(gitPath, ["rev-parse", "--is-inside-work-tree"], { timeoutMs: 10_000 });
  if (result.code === 0 && result.stdout.trim() === "true") {
    return { ...base, status: "ok", detail: "this folder is a git project" };
  }
  return {
    ...base,
    status: "warn",
    detail: "this folder isn't a git project",
    fix: "cd into your project folder, or run `git init` to start one here",
  };
}

function installHint(): string {
  switch (process.platform) {
    case "win32":
      return "winget install infisical   (or: scoop install infisical, or: npm install -g @infisical/cli)";
    case "darwin":
      return "brew install infisical/get-cli/infisical   (or: npm install -g @infisical/cli)";
    default:
      return "npm install -g @infisical/cli   (apt/yum/apk: https://infisical.com/docs/cli/overview)";
  }
}

async function checkInfisical(infisicalPath: string | null): Promise<CheckResult> {
  const base = {
    id: "infisical",
    title: "Infisical CLI",
    explain: "The Infisical CLI keeps your secrets safe. Checking it's installed",
    command: "infisical --version",
  };
  if (!infisicalPath) {
    return {
      ...base,
      status: "fail",
      detail: "not installed",
      fix: `${installHint()}\nThen open a new terminal and run \`cli-village doctor\` again.`,
    };
  }
  const result = await run(infisicalPath, ["--version"], { timeoutMs: 15_000 });
  if (result.code !== 0) {
    return {
      ...base,
      status: "fail",
      detail: "installed, but didn't respond",
      fix: `Reinstall it: ${installHint()}`,
    };
  }
  return { ...base, status: "ok", detail: result.stdout.trim() || "installed" };
}

// Shape of `infisical login status --json`. It never includes the token itself.
interface LoginStatusSession {
  principalType?: string;
  status?: string;
  email?: string;
  tokenSource?: string;
  organizationName?: string;
  identity?: { name?: string };
  verification?: { state?: string; reason?: string };
}

function describeSession(session: LoginStatusSession): string {
  const org = session.organizationName ? ` · org "${session.organizationName}"` : "";
  switch (session.principalType) {
    case "user":
      return `logged in as ${session.email ?? "a user"}${org}`;
    case "machine-identity":
      return `machine identity "${session.identity?.name ?? "unnamed"}"${org}${
        session.tokenSource ? ` (from ${session.tokenSource})` : ""
      }`;
    case "service-token":
      return "service token (deprecated: switch to a machine identity)";
    default:
      return "logged in";
  }
}

function rateSession(session: LoginStatusSession): CheckStatus {
  if (session.status === "expired" || session.status === "rejected") return "fail";
  if (session.status === "authenticated" && session.verification?.state === "verified") return "ok";
  return "warn"; // e.g. couldn't reach Infisical to confirm
}

async function checkLogin(infisicalPath: string | null): Promise<CheckResult> {
  const base = {
    id: "infisical-login",
    title: "Infisical login",
    explain: "Checking you're logged in to Infisical (your token is never shown)",
    command: "infisical login status --json",
  };
  if (!infisicalPath) return { ...base, status: "skip", detail: "skipped (Infisical CLI isn't installed)" };

  const loginFix = "Run `infisical login`, or set INFISICAL_TOKEN for a machine identity";
  const result = await run(infisicalPath, ["login", "status", "--json"], { timeoutMs: 20_000 });

  if (result.timedOut) {
    return {
      ...base,
      status: "warn",
      detail: "Infisical didn't answer in time",
      fix: "Check your internet connection and try again",
    };
  }

  let sessions: LoginStatusSession[] | undefined;
  try {
    const start = result.stdout.indexOf("{");
    const parsed = JSON.parse(result.stdout.slice(start)) as { sessions?: LoginStatusSession[] };
    sessions = parsed.sessions;
  } catch {
    sessions = undefined;
  }

  if (!sessions) {
    const output = `${result.stderr}\n${result.stdout}`;
    if (/unknown (command|flag)/i.test(output)) {
      return {
        ...base,
        status: "warn",
        detail: "your Infisical CLI is too old to report login status",
        fix: "Update the Infisical CLI to the latest version",
      };
    }
    const firstLine = maskTokens(output.trim().split("\n")[0] ?? "").slice(0, 200);
    return { ...base, status: "fail", detail: firstLine || "couldn't read login status", fix: loginFix };
  }

  if (sessions.length === 0) {
    return { ...base, status: "fail", detail: "not logged in", fix: loginFix };
  }

  // Use the best session: one that works beats one that needs attention.
  const order: CheckStatus[] = ["ok", "warn", "fail"];
  const best = [...sessions].sort(
    (a, b) => order.indexOf(rateSession(a)) - order.indexOf(rateSession(b)),
  )[0]!;
  const status = rateSession(best);
  const detail = maskTokens(describeSession(best));

  if (status === "ok") return { ...base, status, detail };
  if (status === "warn") {
    return {
      ...base,
      status,
      detail: `${detail}, but Infisical couldn't confirm it`,
      fix: "Check your internet connection, or run `infisical login` again",
    };
  }
  return { ...base, status, detail: `${detail}: session ${best.status ?? "invalid"}`, fix: loginFix };
}

const PROJECT_FILES = [".infisical.yaml", ".infisical.json"];

/** Infisical looks for its project file in this folder, then each parent folder. */
function findProjectFile(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    for (const name of PROJECT_FILES) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function checkProjectLink(): CheckResult {
  const base = {
    id: "infisical-project",
    title: "Infisical project",
    explain: "Looking for the file `infisical init` makes to link this folder to a project",
    command: PROJECT_FILES.join(" or "),
  };
  const found = findProjectFile(process.cwd());
  if (found) {
    const shown = path.relative(process.cwd(), found) || path.basename(found);
    return { ...base, status: "ok", detail: `linked (${shown})` };
  }
  return {
    ...base,
    status: "warn",
    detail: "this folder isn't linked to an Infisical project yet",
    fix: "Run `infisical init` in your project folder and pick a project",
  };
}

const LABELS: Record<CheckStatus, (text: string) => string> = {
  ok: (t) => green(t),
  warn: (t) => yellow(t),
  fail: (t) => red(t),
  skip: (t) => dim(t),
};

type Write = (line: string) => void;

function printCheck(check: CheckResult, detail: Detail, write: Write): void {
  if (detail === "quiet" && check.status !== "fail") return;
  const label = LABELS[check.status](`${symbols[check.status]} ${check.status.padEnd(4)}`);
  const title = check.status === "skip" ? dim(check.title.padEnd(18)) : bold(check.title.padEnd(18));
  const found = check.status === "skip" ? dim(check.detail) : check.detail;
  write(`  ${label}  ${title} ${found}`);
  // The beginner explainer: what this check is about, and the real command behind it.
  if (detail === "full") write(`          ${dim(`${check.explain} ${symbols.arrow}`)} ${cyan(check.command)}`);
  if (check.fix && (check.status === "fail" || check.status === "warn")) {
    const [first, ...rest] = check.fix.split("\n");
    write(`          ${bold("Fix:")} ${first}`);
    for (const line of rest) write(`               ${line}`);
  }
}

function printSummary(checks: CheckResult[], detail: Detail, write: Write): void {
  const fails = checks.filter((c) => c.status === "fail");
  const warns = checks.filter((c) => c.status === "warn");
  const things = `${fails.length} thing${fails.length > 1 ? "s" : ""} to fix`;
  if (detail === "quiet") {
    if (fails.length) write(red(`${symbols.fail} ${things}.`));
    return;
  }
  if (detail === "full") write("");
  if (fails.length === 0 && warns.length === 0) {
    write(bold(green(`${symbols.ok} All set! CLI Village is ready to use.`)));
    return;
  }
  if (fails.length === 0) {
    const names = warns.map((c) => c.title).join(", ");
    write(bold(yellow(`${symbols.warn} Ready, with ${warns.length} note${warns.length > 1 ? "s" : ""}: ${names}.`)));
    return;
  }
  write(bold(red(`${symbols.fail} ${things}: ${fails.map((c) => c.title).join(", ")}.`)));
  if (detail === "full") write(dim("  Follow the Fix lines above, then run `cli-village doctor` again."));
}

/**
 * Runs every check. Returns the exit code: 1 if anything must be fixed, otherwise 0.
 * --compact: one line per check. --quiet: only what must be fixed (on stderr). --json: one JSON report.
 */
export async function runDoctor(ui: Ui = DEFAULT_UI): Promise<number> {
  const { json, detail } = ui;
  const write: Write = (line) => (detail === "quiet" ? process.stderr : process.stdout).write(`${line}\n`);
  const report = (check: CheckResult) => {
    if (!json) printCheck(check, detail, write);
    return check;
  };

  if (!json && detail !== "quiet") {
    if (detail === "full") write("");
    write(`${bold("CLI Village doctor")} ${dim("· checking that your tools are ready")}`);
    if (detail === "full") write("");
  }

  const gitPath = findExecutable("git");
  const infisicalPath = findExecutable("infisical");

  const checks: CheckResult[] = [];
  checks.push(report(checkNode()));
  checks.push(report(await checkGit(gitPath)));
  checks.push(report(await checkGitRepo(gitPath)));
  checks.push(report(await checkInfisical(infisicalPath)));
  checks.push(report(await checkLogin(infisicalPath)));
  checks.push(report(checkProjectLink()));

  const ok = !checks.some((c) => c.status === "fail");
  if (json) {
    console.log(JSON.stringify({ ok, checks }, null, 2));
  } else {
    printSummary(checks, detail, write);
    if (detail === "full") write("");
  }
  return ok ? 0 : 1;
}
