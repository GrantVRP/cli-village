// `cli-village secrets fetch | diff | export`: the VAULT, wired to the real
// Infisical CLI. Only key NAMES and counts are ever shown. Values stay in
// memory, except with `export --out <file>`, where you ask for a file.

import { chmodSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { EventBus } from "../events/bus.js";
import { secretGuard } from "../events/guard.js";
import {
  checkScope,
  describeScope,
  EXPORT_FORMATS,
  fetchSecrets,
  scopeArgs,
  showCommand,
  writeSecretsFile,
  type ExportFormat,
  type InfisicalError,
  type SecretScope,
} from "../infisical/client.js";
import { findExecutable, run } from "../lib/exec.js";
import { bold, cyan, dim, green, red, symbols, yellow } from "../lib/style.js";
import type { Detail, Ui } from "../lib/ui.js";
import { attachTaskView } from "../views/task.js";

/** The robot that does work you start yourself. */
export const YOU = "you";
const KEY_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
const MAX_EVENT_KEYS = 100;

export interface ScopeOptions {
  env?: string;
  path?: string;
  projectId?: string;
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const stdout = (text: string) => process.stdout.write(`${text}\n`);
const stderr = (text: string) => process.stderr.write(`${text}\n`);

/**
 * Prints for people, or one JSON object for scripts (--json).
 * With --quiet, only results go to stdout and problems go to stderr,
 * so `names=$(cli-village secrets fetch --quiet)` captures just the names.
 */
class Output {
  readonly json: boolean;
  readonly detail: Detail;
  constructor(ui: Ui) {
    this.json = ui.json;
    this.detail = ui.detail;
  }
  get quiet(): boolean {
    return !this.json && this.detail === "quiet";
  }
  get full(): boolean {
    return !this.json && this.detail === "full";
  }
  /** A line for people. Not shown with --json or --quiet. */
  line = (text = "") => {
    if (!this.json && !this.quiet) stdout(text);
  };
  /** A blank line for breathing room (full detail only). */
  gap(): void {
    if (this.full) stdout("");
  }
  /** A line of the result itself, which --quiet still prints. */
  data(text: string): void {
    if (!this.json) stdout(text);
  }
  /** Follow a job's events: what's happening and how it ended. */
  watch(bus: EventBus): () => void {
    if (this.json) return () => {};
    return attachTaskView(bus, this.quiet ? stderr : stdout, this.detail);
  }
  result(data: object): void {
    if (this.json) stdout(JSON.stringify({ ok: true, ...data }));
  }
  /** Show a problem (and what might fix it). Returns the exit code. */
  problem(err: Omit<InfisicalError, "ok">, alreadyShown = false): number {
    if (this.json) {
      stdout(JSON.stringify({ ok: false, error: err.error, hint: err.hint }));
    } else {
      const write = this.quiet ? stderr : stdout;
      if (!alreadyShown) write(`${red(symbols.fail)} ${err.error}`);
      if (err.hint) write(`  ${dim("Try:")} ${cyan(err.hint)}`);
    }
    return 1;
  }
}

/** One piece of VAULT work, told as events (so every view can show it). */
export class VaultJob {
  private static next = 0;
  readonly task = `vault-${++VaultJob.next}`;

  constructor(
    private readonly bus: EventBus,
    title: string,
    command: string,
  ) {
    bus.emit({ type: "move", agent: YOU, to: "vault" });
    bus.emit({ type: "start", agent: YOU, task: this.task, kind: "secrets", title, command });
  }

  done(message: string, keys?: string[], total?: number): void {
    const names = keys?.filter((k) => KEY_NAME.test(k) && !secretGuard.containsSecret(k)).slice(0, MAX_EVENT_KEYS);
    const sent = this.bus.emit({ type: "done", agent: YOU, task: this.task, message, keys: names, count: total });
    // If a name was refused for any reason, still report the result, just without names.
    if (!sent.ok) this.bus.emit({ type: "done", agent: YOU, task: this.task, message, count: total });
    this.bus.emit({ type: "move", agent: YOU, to: "home" });
  }

  fail(message: string): void {
    this.bus.emit({ type: "fail", agent: YOU, task: this.task, message });
    this.bus.emit({ type: "move", agent: YOU, to: "home" });
  }
}

/** A key name with any terminal control characters removed. */
const safeName = (name: string) => name.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");

/** Print key names in neat columns that fit the terminal. Names only, never values. */
export function formatNames(names: readonly string[], width = process.stdout.columns || 80, indent = 2): string[] {
  if (names.length === 0) return [];
  const safe = names.map(safeName);
  const col = Math.min(40, Math.max(...safe.map((n) => n.length)) + 2);
  const perRow = Math.max(1, Math.floor((width - indent) / col));
  const lines: string[] = [];
  for (let i = 0; i < safe.length; i += perRow) {
    lines.push(" ".repeat(indent) + safe.slice(i, i + perRow).map((n) => n.padEnd(col)).join("").trimEnd());
  }
  return lines;
}

function scopeFrom(options: ScopeOptions, env = options.env): SecretScope {
  return { env, path: options.path, projectId: options.projectId };
}

// --- secrets fetch ------------------------------------------------------------------

export async function runSecretsFetch(options: ScopeOptions, ui: Ui): Promise<number> {
  const out = new Output(ui);
  const scope = scopeFrom(options);
  const bad = checkScope(scope);
  if (bad) return out.problem({ error: bad });

  const bus = new EventBus();
  const stop = out.watch(bus);
  const what = describeScope(scope);
  const job = new VaultJob(bus, `Fetching ${what}`, showCommand(["export", ...scopeArgs(scope), "--format=json"]));

  const res = await fetchSecrets(scope);
  if (!res.ok) {
    job.fail(`Couldn't fetch ${what}: ${res.error}`);
    stop();
    return out.problem(res, true);
  }

  const names = [...res.values.keys()].sort();
  job.done(`Loaded ${count(names.length, "secret")}${scope.env ? ` from ${scope.env}` : ""}`, names, names.length);
  stop();

  out.result({ env: scope.env ?? null, path: scope.path ?? "/", count: names.length, keys: names, unreadable: [...res.unreadable].sort() });
  if (out.quiet) {
    // Just the names, one per line, for scripts and pipes.
    for (const name of names) out.data(safeName(name));
    return 0;
  }
  if (names.length) {
    out.gap();
    if (out.full) out.line(dim("  Key names (values stay hidden):"));
    for (const l of formatNames(names)) out.line(l);
  } else {
    out.line(dim("  There are no secrets here yet. Add some in Infisical, then try again."));
  }
  if (res.unreadable.size) {
    out.gap();
    out.line(yellow(`  ${symbols.warn} You can see ${count(res.unreadable.size, "name")} but not the value (Infisical permissions).`));
  }
  if (out.full) {
    out.gap();
    out.line(dim(`  To use them, run your app with: ${cyan("cli-village run -- <your command>")}`));
  }
  return 0;
}

// --- secrets diff ---------------------------------------------------------------------

export async function runSecretsDiff(envA: string, envB: string, options: ScopeOptions, ui: Ui): Promise<number> {
  const out = new Output(ui);
  const a = scopeFrom(options, envA);
  const b = scopeFrom(options, envB);
  const bad = checkScope(a) ?? checkScope(b);
  if (bad) return out.problem({ error: bad });
  if (envA === envB) return out.problem({ error: "Pick two different environments to compare, e.g. dev prod." });

  const bus = new EventBus();
  const stop = out.watch(bus);
  const command = `${showCommand(["export", ...scopeArgs(a), "--format=json"])}  (and --env=${envB})`;
  const job = new VaultJob(bus, `Comparing ${envA} and ${envB} secrets (names only)`, command);

  const [ra, rb] = await Promise.all([fetchSecrets(a), fetchSecrets(b)]);
  for (const [res, env] of [
    [ra, envA],
    [rb, envB],
  ] as const) {
    if (!res.ok) {
      job.fail(`Couldn't fetch ${env} secrets: ${res.error}`);
      stop();
      return out.problem(res, true);
    }
  }
  if (!ra.ok || !rb.ok) return 1; // (already handled above; this keeps TypeScript happy)

  const onlyA: string[] = [];
  const onlyB: string[] = [];
  const different: string[] = [];
  const unknown: string[] = [];
  let same = 0;
  for (const [key, value] of ra.values) {
    if (!rb.values.has(key)) onlyA.push(key);
    else if (ra.unreadable.has(key) || rb.unreadable.has(key)) unknown.push(key);
    else if (rb.values.get(key) !== value) different.push(key);
    else same++;
  }
  for (const key of rb.values.keys()) if (!ra.values.has(key)) onlyB.push(key);
  for (const list of [onlyA, onlyB, different, unknown]) list.sort();

  const changes = onlyA.length + onlyB.length + different.length;
  job.done(
    changes === 0 && unknown.length === 0
      ? `${envA} and ${envB} have the same ${count(same, "secret")}`
      : `${envA}: ${count(ra.values.size, "secret")} · ${envB}: ${count(rb.values.size, "secret")} · ${count(changes, "difference")}`,
    [...onlyA, ...onlyB, ...different],
    changes,
  );
  stop();

  out.result({ a: envA, b: envB, onlyInA: onlyA, onlyInB: onlyB, differentValues: different, cannotCompare: unknown, same });
  if (out.quiet) {
    // Like `diff`: - only in the first, + only in the second, ~ different, ? can't compare.
    for (const [mark, names] of [["-", onlyA], ["+", onlyB], ["~", different], ["?", unknown]] as const) {
      for (const name of names) out.data(`${mark} ${safeName(name)}`);
    }
    return 0;
  }
  const section = (label: string, names: string[], note?: string) => {
    if (!names.length) return;
    out.gap();
    out.line(`  ${bold(label)} ${dim(`(${names.length})`)}${note && out.full ? dim(` ${note}`) : ""}`);
    for (const l of formatNames(names, undefined, 4)) out.line(l);
  };
  section(`Only in ${envA}`, onlyA);
  section(`Only in ${envB}`, onlyB);
  section("Different values", different, "· names only, the values stay hidden");
  section("Can't compare", unknown, "· you can see the name but not the value");
  out.gap();
  out.line(dim(`  Same in both: ${same}`));
  return 0;
}

// --- secrets export --out <file> ----------------------------------------------------------

export interface ExportOptions extends ScopeOptions {
  out?: string;
  format?: string;
  force?: boolean;
}

interface GitStatus {
  inRepo: boolean;
  ignored: boolean;
  tracked: boolean;
}

async function gitStatusOf(file: string): Promise<GitStatus> {
  const git = findExecutable("git");
  const cwd = path.dirname(file);
  const name = path.basename(file);
  if (!git) return { inRepo: false, ignored: false, tracked: false };
  const inside = await run(git, ["rev-parse", "--is-inside-work-tree"], { cwd, timeoutMs: 10_000 });
  if (inside.code !== 0 || inside.stdout.trim() !== "true") return { inRepo: false, ignored: false, tracked: false };
  const [ignored, tracked] = await Promise.all([
    run(git, ["check-ignore", "-q", "--", name], { cwd, timeoutMs: 10_000 }),
    run(git, ["ls-files", "--error-unmatch", "--", name], { cwd, timeoutMs: 10_000 }),
  ]);
  return { inRepo: true, ignored: ignored.code === 0, tracked: tracked.code === 0 };
}

export async function runSecretsExport(options: ExportOptions, ui: Ui): Promise<number> {
  const out = new Output(ui);
  if (!options.out) {
    return out.problem({
      error: "Tell me where to write the secrets, e.g. --out .env. (CLI Village only writes secrets to disk when you ask.)",
      hint: "cli-village secrets export --out .env",
    });
  }
  const format = (options.format ?? "dotenv") as ExportFormat;
  if (!EXPORT_FORMATS.includes(format)) {
    return out.problem({ error: `--format must be one of: ${EXPORT_FORMATS.join(", ")}.` });
  }
  const scope = scopeFrom(options);
  const bad = checkScope(scope);
  if (bad) return out.problem({ error: bad });

  const file = path.resolve(options.out);
  const shown = path.relative(process.cwd(), file) || file;
  const base = path.basename(file);
  // Infisical adds an extension to names without one, so insist on one (".env" counts).
  if (!base.includes(".")) {
    return out.problem({ error: `Give the file a name with an extension, like .env or ${base}.json, so it's clear what it holds.` });
  }
  if (!existsSync(path.dirname(file))) return out.problem({ error: `The folder for ${shown} doesn't exist.` });
  if (existsSync(file) && statSync(file).isDirectory()) return out.problem({ error: `${shown} is a folder. Point --out at a file, e.g. ${path.join(shown, ".env")}.` });
  if (existsSync(file) && !options.force) {
    return out.problem({ error: `${shown} already exists. Add --force to replace it.` });
  }

  // Never write secrets somewhere git could commit them.
  const git = await gitStatusOf(file);
  if (git.tracked) {
    return out.problem({
      error: `git is already tracking ${shown}, so secrets written there could end up in a commit. Stop tracking it first (this keeps the file, it just leaves git).`,
      hint: `git rm --cached -- ${base}`,
    });
  }
  if (git.inRepo && !git.ignored) {
    return out.problem({
      error: `${shown} isn't listed in .gitignore, so git could commit your secrets. Add a line with ${base} to your .gitignore file first, then run this again.`,
      // (On Windows, `echo >>` in PowerShell writes a format git can't read, so no one-liner there.)
      hint: process.platform === "win32" ? undefined : `echo ${base} >> .gitignore`,
    });
  }

  const bus = new EventBus();
  const stop = out.watch(bus);
  const what = describeScope(scope);
  const job = new VaultJob(
    bus,
    `Writing ${what} to ${shown}`,
    showCommand(["export", ...scopeArgs(scope), `--format=${format}`, `--output-file=${shown}`]),
  );

  // First read the names (in memory) so we can say what's in the file, then let Infisical write it.
  const names = await fetchSecrets(scope);
  if (!names.ok) {
    job.fail(`Couldn't fetch ${what}: ${names.error}`);
    stop();
    return out.problem(names, true);
  }
  const written = await writeSecretsFile(scope, format, file);
  if (!written.ok) {
    job.fail(`Couldn't write ${shown}: ${written.error}`);
    stop();
    return out.problem(written, true);
  }
  // Only you should be able to read it (macOS and Linux; Windows uses folder permissions).
  if (process.platform !== "win32") {
    try {
      chmodSync(file, 0o600);
    } catch {
      // Best effort.
    }
  }

  const keys = [...names.values.keys()].sort();
  job.done(`Wrote ${count(keys.length, "secret")} to ${shown}`, keys, keys.length);
  stop();

  out.result({ file: shown, format, env: scope.env ?? null, count: keys.length, keys, gitignored: git.ignored });
  if (out.full) {
    out.gap();
    out.line(yellow(`  ${symbols.warn} ${shown} holds real secret values.`));
    out.line(
      dim(
        git.inRepo
          ? `  It's in .gitignore ${green(symbols.ok)}, so git won't commit it. Delete it when you're done.`
          : "  This folder isn't a git repository. Keep the file private and delete it when you're done.",
      ),
    );
  } else {
    out.line(yellow(`  ${symbols.warn} ${shown} holds real secret values. Delete it when you're done.`));
  }
  return 0;
}
