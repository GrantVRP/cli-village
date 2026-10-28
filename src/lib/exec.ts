// Helpers for finding and running other programs (git, infisical, ...).
// Uses only Node's built-in child_process, so there's no extra dependency.

import { spawn } from "node:child_process";
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
}

const MAX_OUTPUT = 1024 * 1024; // keep at most 1 MB of output per stream
const SAFE_ARG = /^[\w.\-=/:@]+$/;

/** Run a program and collect its output. Never throws: failures come back in the result. */
export function run(file: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  // Windows can't start .cmd/.bat scripts directly (npm installs tools that way),
  // so those go through cmd.exe. That path only accepts simple, fixed arguments.
  const viaShell = isWindows && /\.(cmd|bat)$/i.test(file);
  if (viaShell && !args.every((arg) => SAFE_ARG.test(arg))) {
    return Promise.resolve({
      code: null,
      stdout: "",
      stderr: "Refusing to pass unusual arguments through cmd.exe.",
      timedOut: false,
    });
  }

  return new Promise((resolve) => {
    const child = viaShell
      ? // Arguments were checked against SAFE_ARG above, so joining them is safe.
        spawn([`"${file}"`, ...args].join(" "), { cwd: options.cwd, shell: true, windowsHide: true })
      : spawn(file, args, { cwd: options.cwd, windowsHide: true });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk;
    });

    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill();
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
