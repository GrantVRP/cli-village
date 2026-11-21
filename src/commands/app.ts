// `cli-village app`: open the desktop app, a window with the 3D village, a real
// terminal and the tools, like a small VS Code. It runs on Electron (the same
// base VS Code uses), which is installed with the project's dev dependencies.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { bold, cyan, dim } from "../lib/style.js";
import type { Ui } from "../lib/ui.js";

export interface AppCommandOptions {
  demo?: boolean;
  speed?: number;
  once?: boolean;
  version: string;
}

const require = createRequire(import.meta.url);

/**
 * Harmless noise from Electron on Windows, kept out of your terminal. Everything else passes through.
 * - The terminal library (node-pty) closes a shell with a helper program that can't attach to
 *   the shell's console, so the helper dies with a stack trace. The shell is closed anyway.
 * - Electron's crash reporter says it can't find its pipe.
 * Returns a function that says whether to keep each line of the app's error output.
 */
export function noiseFilter(): (line: string) => boolean {
  let dropping = 0; // lines left to drop in the current block
  return (line) => {
    if (dropping > 0) {
      // The helper's trace ends with "Node.js v24…". Never drop more than a trace's worth.
      dropping = /^Node\.js v\d/.test(line.trim()) ? 0 : dropping - 1;
      return false;
    }
    if (/conpty_console_list_agent\.js:\d+\s*$/.test(line)) {
      dropping = 20;
      return false;
    }
    return !/:ERROR:.*crashpad.*registration_protocol_win/.test(line);
  };
}

/** Where Electron's program is, or null when it isn't installed. */
function findElectron(): string | null {
  try {
    const found = require("electron") as unknown;
    return typeof found === "string" && existsSync(found) ? found : null;
  } catch {
    return null;
  }
}

export async function runAppCommand(options: AppCommandOptions, ui: Ui): Promise<number> {
  const quiet = !ui.json && ui.detail === "quiet";
  const fail = (message: string, fix?: string) => {
    if (ui.json) console.log(JSON.stringify({ ok: false, error: message }));
    else {
      console.error(message);
      if (fix) console.error(dim(`  Fix: ${fix}`));
    }
    return 1;
  };

  const main = fileURLToPath(new URL("../app/main.js", import.meta.url));
  const page = fileURLToPath(new URL("../app/renderer/index.html", import.meta.url));
  if (!existsSync(main) || !existsSync(page)) return fail("The desktop app isn't built yet.", "Run `npm run build` in the cli-village folder.");

  const electron = findElectron();
  if (!electron) return fail("The desktop app needs Electron, which isn't installed.", "Run `npm install` in the cli-village folder (it's a dev dependency).");

  const args = [main];
  if (options.demo) args.push("--demo");
  if (options.once) args.push("--once");
  if (options.speed) args.push("--speed", String(options.speed));

  // If we're inside a program built on Electron (like VS Code's terminal), this would make
  // Electron behave like plain Node.js. We want a real window.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  if (ui.json) console.log(JSON.stringify({ ok: true, mode: options.demo ? "demo" : "live" }));
  else if (!quiet) {
    console.log(`${bold("CLI Village app")} ${dim(`· ${options.demo ? "demo" : "live"} · opening a window…`)}`);
    if (!options.demo) console.log(dim(`  Run ${cyan("cli-village test")} (or status, commit, push…) in its terminal, and watch the village.`));
    console.log(dim("  Close the window to stop."));
  }

  const child = spawn(electron, args, { cwd: process.cwd(), env, stdio: ["ignore", "inherit", "pipe"], windowsHide: false });
  const keep = noiseFilter();
  createInterface({ input: child.stderr! }).on("line", (line) => {
    if (keep(line)) process.stderr.write(`${line}\n`);
  });
  return await new Promise<number>((resolve) => {
    child.on("error", (err) => resolve(fail(`Couldn't start the app: ${err.message}`)));
    // "close", not "exit": wait until the last of its output is through.
    child.on("close", (code) => resolve(code ?? 0));
  });
}
