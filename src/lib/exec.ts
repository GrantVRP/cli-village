// Helpers for finding and running other programs (git, infisical, ...).
// Uses only Node's built-in child_process, so there's no extra dependency.

import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";

const isWindows = process.platform === "win32";

/** Find a program on PATH, like `which` / `where`. Returns its full path, or null if it isn't installed. */
export function findExecutable(name: string): string | null {
  const dirs = (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((dir) => dir.replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
  // On Windows a program is "infisical.exe" or "infisical.cmd", never a bare "infisical".
  const extensions = isWindows
    ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];

  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, name + ext);
      try {
        if (!statSync(candidate).isFile()) continue;
        if (!isWindows) accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Not here; keep looking.
      }
    }
  }
  return null;
}

// cmd.exe's special characters.
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;
// Characters cmd.exe can't pass on reliably: %, line breaks and NUL.
const CMD_UNSAFE = /[%\r\n\u0000]/;

/** Quote one argument the way Windows programs read their arguments (the usual C runtime rules). */
export function quoteArg(arg: string): string {
  // Backslashes right before a quote (or at the very end) are doubled, and quotes are escaped.
  const escaped = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1");
  return `"${escaped}"`;
}

export type SpawnPlan = { command: string; args: string[]; options: SpawnOptions } | { error: string };

/**
 * How to start a program. On Windows, tools installed by npm are .cmd scripts,
 * which only run through cmd.exe. cmd.exe reads the command line twice (once
 * itself, and again when the script passes its arguments on), so special
 * characters like & | > are escaped twice. Otherwise "a&b" could run "b".
 */
export function spawnPlan(file: string, args: readonly string[], windows = isWindows): SpawnPlan {
  if (!windows || !/\.(cmd|bat)$/i.test(file)) return { command: file, args: [...args], options: {} };
  // The script's own path goes on the same command line. It's quoted, which makes & | > plain
  // text, but cmd.exe still expands %NAME% inside quotes, and a quote would end the quoting.
  // (Windows doesn't allow quotes in file names; this checks anyway.)
  if (CMD_UNSAFE.test(file) || file.includes('"')) {
    return {
      error: `${path.basename(file)} is a Windows script in a folder whose path has %, a quote or a line break, which cmd.exe can't run safely. Move it, or install Infisical as a program (winget install infisical).`,
    };
  }
  if (args.some((a) => CMD_UNSAFE.test(a))) {
    return {
      error: `${path.basename(file)} is a Windows script, which can't safely pass the characters %, line breaks or NUL. Remove them, or install Infisical as a program (winget install infisical).`,
    };
  }
  const escape = (a: string) => quoteArg(a).replace(CMD_META, "^$1").replace(CMD_META, "^$1");
  const line = [`"${file}"`, ...args.map(escape)].join(" ");
  return {
    command: process.env.ComSpec ?? "cmd.exe",
    args: ["/d", "/s", "/c", `"${line}"`],
    options: { windowsVerbatimArguments: true },
  };
}

export interface RunResult {
  /** Exit code, or null if the program couldn't start or was stopped. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  /** Stop collecting output after this many characters per stream (default 1 MB). */
  maxOutput?: number;
  /** "inherit": the program can read the keyboard (e.g. a passphrase prompt) while its output is still collected. */
  stdin?: "inherit";
}

/**
 * Stop a program that took too long, and what it started. On Windows a .cmd
 * runs inside cmd.exe, and child.kill() would stop only cmd.exe, so taskkill
 * (part of Windows) stops the whole tree.
 */
function stopTree(child: ChildProcess): void {
  if (isWindows && child.pid) {
    const taskkill = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
    spawn(taskkill, ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => child.kill());
  } else {
    child.kill();
  }
}

/** Run a program and collect its output. Never throws: failures come back in the result. */
export function run(file: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  const maxOutput = options.maxOutput ?? 1024 * 1024;
  const plan = spawnPlan(file, args);
  if ("error" in plan) return Promise.resolve({ code: null, stdout: "", stderr: plan.error, timedOut: false });

  return new Promise((resolve) => {
    const child = spawn(plan.command, plan.args, {
      ...plan.options,
      cwd: options.cwd,
      windowsHide: true,
      stdio: [options.stdin === "inherit" ? "inherit" : "ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (stdout.length < maxOutput) stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < maxOutput) stderr += chunk;
    });

    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          stopTree(child);
          // A program it started can keep the output open after it stops: don't wait for that.
          setTimeout(() => {
            child.stdout?.destroy();
            child.stderr?.destroy();
            finish(null);
          }, 2000).unref();
        }, options.timeoutMs)
      : undefined;

    const finish = (code: number | null, extraError?: string) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr: extraError ? `${stderr}${extraError}` : stderr, timedOut });
    };

    child.on("error", (err) => finish(null, err.message));
    child.on("close", (code) => finish(code));
  });
}

/**
 * Run a program that shares this terminal (its output goes straight to the
 * screen, and it can read the keyboard). Resolves with its exit code.
 * Ctrl+C reaches the program itself, so we wait for it to finish rather than exiting first.
 */
export function runInherit(
  file: string,
  args: string[],
  options: {
    cwd?: string;
    /** Send the program's stdout to our stderr (so stdout can carry a JSON result). */
    stdoutToStderr?: boolean;
  } = {},
): Promise<{ code: number | null; error?: string }> {
  const plan = spawnPlan(file, args);
  if ("error" in plan) return Promise.resolve({ code: null, error: plan.error });

  return new Promise((resolve) => {
    const ignore = () => {};
    process.on("SIGINT", ignore);
    process.on("SIGTERM", ignore);
    const done = (result: { code: number | null; error?: string }) => {
      process.off("SIGINT", ignore);
      process.off("SIGTERM", ignore);
      resolve(result);
    };
    const child = spawn(plan.command, plan.args, {
      ...plan.options,
      cwd: options.cwd,
      stdio: options.stdoutToStderr ? ["inherit", 2, "inherit"] : "inherit",
    });
    child.on("error", (err) => done({ code: null, error: err.message }));
    // Stopped by a signal (e.g. Ctrl+C): report it the usual way, 128 + signal number (SIGINT = 2).
    child.on("close", (code, signal) => done({ code: code ?? (signal ? 130 : null) }));
  });
}
