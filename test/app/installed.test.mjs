// Opens the desktop app as the installers build it (`npm run dist:dir`), started the way a
// shortcut starts it: from its own folder, with no project. It checks what only the
// installed app does differently (see src/app/main.ts):
// - it opens in your home folder, and the Guide offers to open a project;
// - its terminal has the app's own `cli-village`, run by the app's Electron from app.asar;
// - node-pty, kept outside app.asar, gives that terminal a real shell.
//
// It runs only when CLI_VILLAGE_TEST_INSTALLED_APP names the app's program, as CI's installer
// job does:
//   CLI_VILLAGE_TEST_INSTALLED_APP="release/win-unpacked/CLI Village.exe" node --test test/app/installed.test.mjs

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Cdp } from "./cdp.mjs";

const program = process.env.CLI_VILLAGE_TEST_INSTALLED_APP;
const TERMINAL = `[...document.querySelectorAll("#terminal .xterm-rows > div")].map((row) => row.textContent).join("\\n")`;
/** The village page's quality, graphics card and frame time (see web/src/render/pipeline.ts). */
const VILLAGE = `({ ...document.querySelector("#village")?.contentDocument?.documentElement.dataset })`;

/**
 * For a failure message: the busiest processes, by program name only. Never their command
 * lines: those can hold values that mustn't reach a log, and CI logs can be public.
 */
function whatIsRunning() {
  const run = (command, args) => {
    const result = spawnSync(command, args, { encoding: "utf8", timeout: 30_000 });
    return (result.stdout || result.stderr || String(result.error ?? "")).trim();
  };
  if (process.platform === "win32") {
    return run("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Get-Process | Sort-Object CPU -Descending | Select-Object -First 15 Name,Id,CPU,@{n='MB';e={[int]($_.WS/1MB)}} | Format-Table -AutoSize | Out-String -Width 120",
    ]);
  }
  // comm: the program's name, without its arguments.
  const sort = process.platform === "darwin" ? ["-r"] : ["--sort=-pcpu"];
  return run("ps", ["-A", "-o", "pid,ppid,pcpu,rss,comm", ...sort]).split("\n").slice(0, 16).join("\n");
}

async function freePort() {
  const server = net.createServer().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

describe("the installed desktop app", { skip: program ? false : "set CLI_VILLAGE_TEST_INSTALLED_APP to the packaged app's program" }, () => {
  let app;
  let cdp;
  let exited;
  let info;
  let stderr = "";
  const settings = mkdtempSync(path.join(tmpdir(), "cli-village-installed-"));

  /** Type a command line into the terminal; resolves with the screen once `marker` shows. */
  async function run(command) {
    // $((6*7)) is 42 in PowerShell, bash and zsh alike, and the line you type doesn't contain "42".
    const marker = `cv-${Math.random().toString(36).slice(2, 8)}-`;
    await cdp.clickOn("the terminal", `() => document.querySelector("#terminal .xterm-screen")`);
    await cdp.type(`${command}; echo ${marker}$((6*7))`);
    await cdp.press("Enter");
    try {
      await cdp.until(`the terminal to finish: ${command}`, async () => (await cdp.eval(TERMINAL)).includes(`${marker}42`), 90_000);
    } catch (err) {
      throw new Error(
        `${err.message}\nThe terminal showed:\n${await cdp.eval(TERMINAL)}\nThe village: ${JSON.stringify(await cdp.eval(VILLAGE))}\nThe app said: ${stderr.trim().slice(-2000) || "(nothing)"}\nRunning:\n${whatIsRunning()}`,
      );
    }
    return cdp.eval(TERMINAL);
  }

  before(async () => {
    assert.ok(existsSync(program), `no app at ${program}`);
    const port = await freePort();
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_TEST_CONTEXT;
    delete env.NODE_OPTIONS;
    const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${settings}`];
    // CI's Linux machines have no graphics card, and Chromium won't draw 3D in software there
    // unless asked; nor can they give Chromium its sandbox. (Test machines only.)
    if (process.platform === "linux" && process.env.CI) args.push("--no-sandbox", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist");
    // From its own folder, as a shortcut or the Start menu starts it.
    app = spawn(program, args, { cwd: path.dirname(program), env, stdio: ["ignore", "ignore", "pipe"] });
    app.stderr.on("data", (d) => (stderr += d));
    exited = new Promise((resolve) => app.once("exit", (code) => resolve({ code, stderr })));
    try {
      cdp = await Cdp.connect(port);
    } catch (err) {
      throw new Error(`${err.message}\nThe app said: ${stderr.trim() || "(nothing)"}`);
    }
    await cdp.send("Runtime.enable");
    const parts = `({
      canvas: Boolean(document.querySelector("#village")?.contentDocument?.querySelector("canvas")),
      terminal: Boolean(document.querySelector("#terminal .xterm-rows")),
      village: (document.querySelector("#village")?.contentDocument?.body?.innerText ?? "").slice(0, 300),
    })`;
    try {
      await cdp.until("the village and the terminal", async () => {
        const p = await cdp.eval(parts);
        return p.canvas && p.terminal;
      }, 60_000);
    } catch (err) {
      throw new Error(`${err.message}\nThe window has: ${JSON.stringify(await cdp.eval(parts))}\nThe app said: ${stderr.trim().slice(-3000) || "(nothing)"}`);
    }
    info = await cdp.eval("window.cliVillage.info()");
  });

  after(async () => {
    cdp?.close();
    if (app && app.exitCode === null && app.signalCode === null) app.kill();
    await exited;
    try {
      rmSync(settings, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    } catch (err) {
      console.warn(`Couldn't remove ${settings}: ${err.message}`);
    }
  });

  it("opens in your home folder and offers to open a project", async () => {
    assert.equal(path.resolve(info.cwd).toLowerCase(), path.resolve(homedir()).toLowerCase());
    assert.equal(info.project, false);
    await cdp.until("the Guide's first step", async () => /Open your project/.test(await cdp.eval(`document.querySelector("#guide-body")?.textContent ?? ""`)));
  });

  it("draws the village", async () => {
    const frames = await cdp.eval(`new Promise((done) => {
      const w = document.querySelector("#village").contentWindow;
      let n = 0;
      const tick = () => (++n < 10 ? w.requestAnimationFrame(tick) : done(n));
      w.requestAnimationFrame(tick);
    })`);
    assert.equal(frames, 10);
  });

  it("has its own cli-village in its terminal, without crash-reporter noise", async () => {
    assert.equal(info.cli, "cli-village");
    const screen = await run("cli-village --version");
    assert.match(screen, new RegExp(`^${info.version.replaceAll(".", "\\.")}\\s*$`, "m"));
    assert.doesNotMatch(screen, /crashpad/);
  });

  it("runs cli-village's commands in its terminal (doctor)", async () => {
    const screen = await run("cli-village doctor --compact");
    assert.match(screen, /Infisical CLI/);
  });

  it("closes cleanly from its close button", async () => {
    if (process.platform === "darwin") await cdp.eval(`window.cliVillage.window("close")`);
    else {
      await cdp.clickOn("the close button", `() => document.querySelector('.tb-win[data-win="close"]')`).catch((err) => {
        if (!/window closed/.test(err.message)) throw err;
      });
    }
    const { code, stderr } = await exited;
    assert.equal(code, 0, `exit code ${code}\n${stderr}`);
  });
});
