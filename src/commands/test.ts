// `cli-village test [-- <command>]`: the LAB. Finds and runs your project's
// tests (or the command you give it). The test output goes straight to your
// terminal; CLI Village only reports whether they passed.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { EventBus } from "../events/bus.js";
import { secretGuard } from "../events/guard.js";
import { findExecutable, runInherit } from "../lib/exec.js";
import { cyan, dim } from "../lib/style.js";
import type { Ui } from "../lib/ui.js";
import { Output } from "./output.js";
import { Worker } from "./worker.js";

export interface TestPlan {
  /** The command, e.g. ["npm", "test"]. */
  command: string[];
  /** The folder to run it in. */
  dir: string;
  /** Why this command, e.g. "package.json has a test script". */
  why: string;
}

/** npm's placeholder for "no tests yet", which always fails. */
const NPM_PLACEHOLDER = /no test specified/i;

function readJson(file: string): Record<string, unknown> | null {
  try {
    const data: unknown = JSON.parse(readFileSync(file, "utf8"));
    return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Which package manager this project uses, from its packageManager field or lockfile. */
function packageManager(dir: string, pkg: Record<string, unknown>): string {
  const declared = typeof pkg.packageManager === "string" ? pkg.packageManager.split("@")[0] : "";
  if (declared && ["npm", "pnpm", "yarn", "bun"].includes(declared)) return declared;
  if (existsSync(path.join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(dir, "yarn.lock"))) return "yarn";
  if (existsSync(path.join(dir, "bun.lock")) || existsSync(path.join(dir, "bun.lockb"))) return "bun";
  return "npm";
}

/** The test command for one folder, or null. `notes` collects near misses (like npm's placeholder script). */
function planFor(dir: string, notes: string[]): TestPlan | null {
  const pkgFile = path.join(dir, "package.json");
  if (existsSync(pkgFile)) {
    const pkg = readJson(pkgFile) ?? {};
    const scripts = (pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {}) as Record<string, unknown>;
    const script = scripts.test;
    if (typeof script === "string" && script.trim() && !NPM_PLACEHOLDER.test(script)) {
      const pm = packageManager(dir, pkg);
      // (`bun test` would run bun's own test runner instead of the script.)
      return { command: pm === "bun" ? ["bun", "run", "test"] : [pm, "test"], dir, why: "package.json has a test script" };
    }
    notes.push(`package.json has no test script yet (add one under "scripts", e.g. "test": "node --test").`);
  }
  if (existsSync(path.join(dir, "Cargo.toml"))) return { command: ["cargo", "test"], dir, why: "this is a Rust project (Cargo.toml)" };
  if (existsSync(path.join(dir, "go.mod"))) return { command: ["go", "test", "./..."], dir, why: "this is a Go project (go.mod)" };
  const pyproject = path.join(dir, "pyproject.toml");
  const usesPytest =
    ["pytest.ini", "conftest.py", "tox.ini"].some((f) => existsSync(path.join(dir, f))) ||
    (existsSync(pyproject) && /\[tool\.pytest/.test(readFileSync(pyproject, "utf8")));
  if (usesPytest) {
    if (findExecutable("pytest")) return { command: ["pytest"], dir, why: "this project uses pytest" };
    const python = process.platform === "win32" ? "python" : "python3";
    return { command: [python, "-m", "pytest"], dir, why: "this project uses pytest" };
  }
  return null;
}

/** Look in this folder, then the ones above it, up to the top of the git project. */
export function findTests(start = process.cwd()): { plan: TestPlan | null; notes: string[] } {
  const notes: string[] = [];
  for (let dir = path.resolve(start); ; ) {
    const plan = planFor(dir, notes);
    if (plan) return { plan, notes };
    const parent = path.dirname(dir);
    if (existsSync(path.join(dir, ".git")) || parent === dir) return { plan: null, notes };
    dir = parent;
  }
}

const show = (command: string[]) => command.map((a) => (/^[\w.\-=/:@]+$/.test(a) ? a : JSON.stringify(a))).join(" ");

export async function runTests(given: string[], ui: Ui): Promise<number> {
  // Our lines go to stderr, so the test output on stdout stays as it is (e.g. for a TAP reporter).
  // With --json, the result is the one JSON line on stdout, and the test output moves to stderr.
  const out = new Output(ui, { humanTo: "stderr" });
  let plan: TestPlan;
  if (given.length) {
    plan = { command: given, dir: process.cwd(), why: "you asked for it" };
  } else {
    const found = findTests();
    if (!found.plan) {
      return out.problem({
        error: `I couldn't find tests to run here.${found.notes[0] ? ` ${found.notes[0]}` : ""} Or tell me the command after --.`,
        hint: "cli-village test -- npm run test:unit",
      });
    }
    plan = found.plan;
  }

  const [program, ...args] = plan.command;
  const bin = /[\\/]/.test(program!) ? path.resolve(plan.dir, program!) : findExecutable(program!);
  if (!bin || !existsSync(bin)) {
    return out.problem({ error: `Couldn't find ${secretGuard.clean(program!)}. Is it installed (and on your PATH)?`, hint: "cli-village doctor" });
  }

  // Hide anything secret-looking someone typed into the command itself.
  const shown = secretGuard.clean(show(plan.command)).slice(0, 120);
  const bus = new EventBus();
  const stop = out.watch(bus);
  const worker = new Worker(bus);
  const job = worker.job("test", "Running your tests", shown);
  if (out.full) {
    const elsewhere = path.resolve(plan.dir) !== path.resolve(process.cwd());
    out.line(dim(`  (Picked because ${plan.why}.${elsewhere ? ` It runs in ${plan.dir}.` : ""} Its output follows.)`));
    out.line("");
  }

  const result = await runInherit(bin, args, { cwd: plan.dir, stdoutToStderr: out.json });
  if (out.full) out.line("");
  if (result.error) {
    job.fail(`Couldn't start the tests: ${secretGuard.clean(result.error)}`);
  } else if (result.code === 0) {
    job.done("Tests passed");
  } else {
    job.fail(`Tests failed (exit code ${result.code ?? "unknown"})`);
  }
  worker.home();
  stop();

  if (out.json) {
    process.stdout.write(
      `${JSON.stringify({ ok: result.code === 0, command: shown, exitCode: result.code, ...(result.error ? { error: secretGuard.clean(result.error) } : {}) })}\n`,
    );
  } else if (result.code !== 0 && !result.error && out.full) {
    out.line(dim(`  Scroll up to the first failure: it usually says what to fix. Then run ${cyan("cli-village test")} again.`));
  }
  return result.error ? 1 : (result.code ?? 1);
}
