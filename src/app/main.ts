// The CLI Village desktop app (Electron's main process). `cli-village app` starts it.
//
// It runs the same village server the browser page uses, and shows its /app/ page
// in a window: a VS Code-like shell with the 3D village in the middle and a real
// terminal at the bottom. Commands you run in that terminal (cli-village secrets,
// commit, push, test…) reach the village through the local socket, as always.
//
// Safety: the window can't use Node.js (context isolation, sandbox, no node
// integration); it talks to this process only through the small bridge in
// preload.cjs. It can't open other sites or windows. The server still binds to
// 127.0.0.1 with a per-session token. Secret values never pass through here.

import { app, BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pty from "node-pty";
import { joinVillage, type Joined } from "../commands/watch.js";
import { runDemo } from "../demo/runner.js";
import { EventBus } from "../events/bus.js";
import { startVillageServer, type VillageServer } from "../server/server.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(here, "../../package.json"), "utf8")) as { version: string };

// --- Arguments: cli-village app [--demo] [--speed n] [--once] --------------------------------

const args = process.argv.slice(process.defaultApp ? 2 : 1);
const demo = args.includes("--demo");
const once = args.includes("--once");
const speedAt = args.indexOf("--speed");
const speed = speedAt >= 0 ? Number(args[speedAt + 1]) || 1 : 1;
const mode = demo ? "demo" : "live";
const cwd = process.cwd();

// --- What the window may ask for ----------------------------------------------------------------

export interface AppInfo {
  mode: string;
  version: string;
  cwd: string;
  /** How to run CLI Village in the terminal: `cli-village` if installed, else `node …/cli.js`. */
  cli: string;
  branch: string | null;
  /** The Infisical CLI and whether this folder is linked to a project. */
  infisical: "linked" | "not linked" | "not installed";
  /** The village's socket: hosting it, following another village, or why it couldn't. */
  hub: { role: "host" | "follower"; path: string } | { role: "none"; error: string };
}

function run(cmd: string, cmdArgs: string[]): string | null {
  const result = spawnSync(cmd, cmdArgs, { cwd, encoding: "utf8", windowsHide: true, timeout: 5000 });
  return result.status === 0 ? result.stdout.trim() : null;
}

function cliCommand(): string {
  const found = run(process.platform === "win32" ? "where" : "which", ["cli-village"]);
  if (found) return "cli-village";
  return `node "${path.join(here, "../cli.js")}"`;
}

function infisicalStatus(): AppInfo["infisical"] {
  if (run("infisical", ["--version"]) === null) return "not installed";
  return existsSync(path.join(cwd, ".infisical.yaml")) || existsSync(path.join(cwd, ".infisical.json")) ? "linked" : "not linked";
}

// --- Start ------------------------------------------------------------------------------------------

let server: VillageServer | null = null;
let joined: Joined | null = null;
let term: pty.IPty | null = null;
let demoRunning = false;
const controller = new AbortController();

async function shutdown(): Promise<void> {
  controller.abort();
  term?.kill();
  term = null;
  await server?.close();
  if (joined?.ok) await joined.close();
  app.quit();
}

app.whenReady().then(async () => {
  const bus = new EventBus();

  if (!demo) joined = await joinVillage(bus);

  try {
    server = await startVillageServer({
      bus,
      mode,
      version: pkg.version,
      appRoot: path.join(here, "renderer"),
      view: { compact: false, animation: true },
    });
  } catch (err) {
    console.error(`Couldn't start the village: ${(err as Error).message}`);
    app.exit(1);
    return;
  }

  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 620,
    title: "CLI Village",
    backgroundColor: "#0b0b0d",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const origin = `http://127.0.0.1:${server.port}`;
  // The window shows our page and nothing else.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(`${origin}/`)) e.preventDefault();
  });
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => void shutdown());
  const fromWindow = (e: IpcMainEvent | IpcMainInvokeEvent) => e.sender === win.webContents;

  // --- The bridge (see preload.cjs) --------------------------------------------------------------

  ipcMain.handle("app:info", (e): AppInfo | null => {
    if (!fromWindow(e)) return null;
    return {
      mode,
      version: pkg.version,
      cwd,
      cli: cliCommand(),
      branch: run("git", ["rev-parse", "--abbrev-ref", "HEAD"]),
      infisical: infisicalStatus(),
      hub: joined?.ok ? { role: joined.role, path: joined.path } : { role: "none", error: joined?.ok === false ? joined.error : "demo" },
    };
  });

  ipcMain.handle("pty:create", (e, cols: number, rows: number): string | null => {
    if (!fromWindow(e)) return null;
    term?.kill();
    const shell = process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "bash";
    const shellArgs = process.platform === "win32" ? ["-NoLogo"] : [];
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    env.CLI_VILLAGE_APP = "1";
    term = pty.spawn(shell, shellArgs, { name: "xterm-256color", cols: cols || 80, rows: rows || 24, cwd, env });
    const current = term;
    current.onData((data) => {
      if (!win.isDestroyed()) win.webContents.send("pty:data", data);
    });
    current.onExit(({ exitCode }) => {
      if (term === current) term = null;
      if (!win.isDestroyed()) win.webContents.send("pty:exit", exitCode);
    });
    return path.basename(shell);
  });
  ipcMain.on("pty:write", (e, data: unknown) => {
    if (fromWindow(e) && typeof data === "string") term?.write(data);
  });
  ipcMain.on("pty:resize", (e, cols: unknown, rows: unknown) => {
    if (fromWindow(e) && typeof cols === "number" && typeof rows === "number") term?.resize(Math.max(2, Math.floor(cols)), Math.max(1, Math.floor(rows)));
  });

  // Play one round of the demo in the open village (also in live mode: pretend robots, nothing real runs).
  ipcMain.handle("demo:play", async (e): Promise<boolean> => {
    if (!fromWindow(e) || demoRunning) return false;
    demoRunning = true;
    try {
      await runDemo(bus, { once: true, speed, signal: controller.signal });
    } finally {
      demoRunning = false;
    }
    return true;
  });

  await win.loadURL(server.appUrl!);

  // For screenshots of the app in docs: CLI_VILLAGE_SCREENSHOT=<file.png> saves one after 12 seconds.
  const shot = process.env.CLI_VILLAGE_SCREENSHOT;
  if (shot) {
    setTimeout(async () => {
      const image = await win.webContents.capturePage();
      const { writeFileSync } = await import("node:fs");
      writeFileSync(shot, image.toPNG());
    }, 12000);
  }

  if (demo) {
    void runDemo(bus, { speed, once, signal: controller.signal }).then(() => {
      if (once) bus.close();
    });
  }
});

app.on("window-all-closed", () => void shutdown());
