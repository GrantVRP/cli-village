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

import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { spawn, spawnSync } from "node:child_process";
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
  /** win32, darwin or linux: the window draws its own title bar except on macOS. */
  platform: string;
  maximized: boolean;
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

/** The web pages the Help menu may open in the system browser, and nothing else. */
const LINKS: Record<string, string> = {
  repo: "https://github.com/GrantVRP/cli-village",
  issues: "https://github.com/GrantVRP/cli-village/issues/new",
  infisical: "https://infisical.com/docs/cli/overview",
};

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

  const mac = process.platform === "darwin";
  // The page draws its own menus; Electron's default menu (and its shortcuts) would get in the way.
  if (!mac) Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 620,
    title: "CLI Village",
    backgroundColor: "#1a1b2b",
    // The page draws the title bar (menus, window buttons) itself, like VS Code does.
    ...(mac ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 12, y: 12 } } : { frame: false }),
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
  const tell = (channel: string, ...payload: unknown[]) => {
    if (!win.isDestroyed()) win.webContents.send(channel, ...payload);
  };
  win.on("maximize", () => tell("window:state", { maximized: true, fullScreen: win.isFullScreen() }));
  win.on("unmaximize", () => tell("window:state", { maximized: false, fullScreen: win.isFullScreen() }));
  win.on("enter-full-screen", () => tell("window:state", { maximized: win.isMaximized(), fullScreen: true }));
  win.on("leave-full-screen", () => tell("window:state", { maximized: win.isMaximized(), fullScreen: false }));

  // --- The bridge (see preload.cjs) --------------------------------------------------------------

  ipcMain.handle("app:info", (e): AppInfo | null => {
    if (!fromWindow(e)) return null;
    return {
      mode,
      version: pkg.version,
      cwd,
      platform: process.platform,
      maximized: win.isMaximized(),
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
    // Only the current shell speaks to the window. A shell we replaced (Terminal › New) still
    // ends a moment later; its "I closed" must not make the window think the new one closed.
    current.onData((data) => {
      if (term === current && !win.isDestroyed()) win.webContents.send("pty:data", data);
    });
    current.onExit(({ exitCode }) => {
      if (term !== current) return;
      term = null;
      if (!win.isDestroyed()) win.webContents.send("pty:exit", exitCode);
    });
    return path.basename(shell);
  });
  ipcMain.on("pty:write", (e, data: unknown) => {
    if (fromWindow(e) && typeof data === "string") term?.write(data);
  });
  ipcMain.on("pty:kill", (e) => {
    if (!fromWindow(e)) return;
    // The shell's exit (above) tells the window, so it offers to start a new one.
    term?.kill();
  });
  // Terminal › Clear: on Windows the shell's side keeps its own copy of the screen and would
  // print it again; this empties that copy too (a no-op elsewhere).
  ipcMain.on("pty:clear", (e) => {
    if (fromWindow(e)) term?.clear();
  });
  ipcMain.on("pty:resize", (e, cols: unknown, rows: unknown) => {
    if (fromWindow(e) && typeof cols === "number" && typeof rows === "number") term?.resize(Math.max(2, Math.floor(cols)), Math.max(1, Math.floor(rows)));
  });

  // --- The title bar's buttons and menus ----------------------------------------------------------

  ipcMain.on("window:control", (e, action: unknown) => {
    if (!fromWindow(e)) return;
    if (action === "minimize") win.minimize();
    else if (action === "maximize") win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === "close") win.close();
    else if (action === "fullscreen") win.setFullScreen(!win.isFullScreen());
    else if (action === "zoom-in") win.webContents.setZoomLevel(Math.min(5, win.webContents.getZoomLevel() + 0.5));
    else if (action === "zoom-out") win.webContents.setZoomLevel(Math.max(-3, win.webContents.getZoomLevel() - 0.5));
    else if (action === "zoom-reset") win.webContents.setZoomLevel(0);
    else if (action === "devtools") win.webContents.toggleDevTools();
    else if (action === "reload") win.webContents.reload();
  });

  // Edit menu: the usual actions, on whatever has the focus (the terminal, a text box).
  const EDIT = ["undo", "redo", "cut", "copy", "paste", "selectAll"] as const;
  ipcMain.on("edit:do", (e, action: unknown) => {
    if (!fromWindow(e) || !EDIT.includes(action as (typeof EDIT)[number])) return;
    win.webContents[action as (typeof EDIT)[number]]();
  });

  // File › Open Folder: a second CLI Village opens in that folder (a village per project).
  ipcMain.handle("app:open-folder", async (e): Promise<string | null> => {
    if (!fromWindow(e)) return null;
    const picked = await dialog.showOpenDialog(win, { title: "Open a project folder", properties: ["openDirectory"] });
    const folder = picked.filePaths[0];
    if (picked.canceled || !folder) return null;
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.CLI_VILLAGE_SCREENSHOT;
    const child = spawn(process.execPath, process.argv.slice(1).filter((a) => !a.startsWith("--remote-debugging")), { cwd: folder, detached: true, stdio: "ignore", env });
    child.unref();
    return folder;
  });

  // Help menu: a few known web pages open in the system browser (never an arbitrary URL).
  ipcMain.on("app:open-link", (e, name: unknown) => {
    const url = typeof name === "string" ? LINKS[name] : undefined;
    if (fromWindow(e) && url) void shell.openExternal(url);
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
