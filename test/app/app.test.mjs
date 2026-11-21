// Opens the real desktop app (Electron) and uses it like a person would: clicks, typing,
// the terminal, the menus. Run it with `npm run test:app` (it opens a window for about a
// minute). It isn't part of `npm test`, so the usual tests never open windows.
//
// The app runs as a demo (it never joins a village that's already open), in a temporary
// folder with its own settings, and with a debugging port only for this test. The test
// closes it at the end, even when something fails.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { dist } from "../helpers.mjs";
import { Cdp } from "./cdp.mjs";

/** A free port on this computer, for the debugging connection. */
async function freePort() {
  const server = net.createServer().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** JavaScript (run in the window) that counts the village's WebGL draw calls so far. */
const DRAWS = `(() => {
  const canvas = document.querySelector("#village").contentDocument.querySelector("canvas");
  const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
  if (gl.__draws === undefined) {
    gl.__draws = 0;
    for (const name of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]) {
      const real = gl[name]?.bind(gl);
      if (real) gl[name] = (...args) => (gl.__draws++, real(...args));
    }
  }
  return gl.__draws;
})()`;

const TERMINAL_LINES = `[...document.querySelectorAll("#terminal .xterm-rows > div")].map((row) => row.textContent.trim())`;
const byText = (selector, text) => `() => [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.trim() === ${JSON.stringify(text)})`;

describe("desktop app", () => {
  let app;
  let cdp;
  let port;
  let exited;
  const errors = [];
  const folders = [];

  before(async () => {
    // Electron downloads itself the first time it's asked for (about 100 MB).
    const electron = createRequire(import.meta.url)("electron");
    port = await freePort();
    const settings = mkdtempSync(path.join(tmpdir(), "cli-village-app-settings-"));
    const work = mkdtempSync(path.join(tmpdir(), "cli-village-app-work-"));
    folders.push(settings, work);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    // Node's test runner tells the programs it starts that they're tests too; the app isn't.
    delete env.NODE_TEST_CONTEXT;
    delete env.NODE_OPTIONS;
    const args = [fileURLToPath(dist("app/main.js")), "--demo", "--speed", "4", `--remote-debugging-port=${port}`, `--user-data-dir=${settings}`];
    // Keep drawing even when other windows cover this one (Chromium pauses covered windows on Windows).
    args.push("--disable-features=CalculateNativeWinOcclusion", "--disable-backgrounding-occluded-windows");
    // CI's Linux machines can't give Chromium its sandbox; the window itself stays sandboxed as always.
    if (process.platform === "linux" && process.env.CI) args.push("--no-sandbox");
    app = spawn(electron, args, { cwd: work, env, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    app.stderr.on("data", (d) => (stderr += d));
    exited = new Promise((resolve) => app.once("exit", (code) => resolve({ code, stderr })));

    try {
      cdp = await Cdp.connect(port);
    } catch (err) {
      throw new Error(`${err.message}\nElectron said: ${stderr.trim() || "(nothing)"}`);
    }
    cdp.on((m) => {
      if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
      if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
      if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push(m.params.entry.text);
    });
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    await cdp.until("the village and the terminal", () =>
      cdp.eval(`Boolean(document.querySelector("#village").contentDocument?.querySelector("canvas") && document.querySelector("#terminal .xterm-rows"))`),
    );
  });

  after(async () => {
    cdp?.close();
    if (app && app.exitCode === null && app.signalCode === null) app.kill();
    await exited;
    for (const folder of folders) rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  it("draws the village, and stops drawing while another tab covers it", async () => {
    const drawsDuring = async (ms) => {
      const before = await cdp.eval(DRAWS);
      await new Promise((r) => setTimeout(r, ms));
      return (await cdp.eval(DRAWS)) - before;
    };
    // Without a graphics card (like CI's machines) each picture is slow, and the window answers
    // slowly while the village is on screen: so wait for each change rather than a fixed time.
    const covered = async () => {
      await cdp.clickOn("the Welcome tab", byText("#tabs .tab-name", "Welcome"));
      await cdp.until("no drawing behind the Welcome tab", async () => (await drawsDuring(1000)) === 0, 60_000);
    };
    await cdp.clickOn("the Village tab", byText("#tabs .tab-name", "Village"));
    await cdp.until("the village drawing", async () => (await drawsDuring(500)) > 0, 60_000);
    await covered();
    await cdp.clickOn("the Village tab", byText("#tabs .tab-name", "Village"));
    await cdp.until("the village drawing again", async () => (await drawsDuring(500)) > 0, 60_000);
    // Covered again, so the rest of the test runs at full speed.
    await covered();
  });

  it("runs a menu item when you click it", async () => {
    // Before step 15, a click on a menu item closed the menu before the item could run.
    await cdp.clickOn("the Help menu", byText("#menubar .menu-title", "Help"));
    await cdp.clickOn("About CLI Village", byText(".menu-list .menu-label", "About CLI Village"));
    await cdp.until("the About box", () => cdp.eval(`!document.querySelector("#about").hidden`));
    await cdp.press("Escape");
    await cdp.until("the About box to close", () => cdp.eval(`document.querySelector("#about").hidden`));
  });

  it("runs commands in its terminal, also after Terminal › New Terminal", async () => {
    const say = async (marker) => {
      await cdp.clickOn("the terminal", `() => document.querySelector("#terminal .xterm-screen")`);
      await cdp.type(`echo ${marker}`);
      await cdp.press("Enter");
      // The answer is a line that's only the marker (the line you typed starts with the prompt).
      await cdp.until(`the shell to answer ${marker}`, async () => (await cdp.eval(TERMINAL_LINES)).includes(marker), 30_000);
    };
    await say("cv-first-shell");
    // Before step 15, the old shell's exit made the window think the new one had closed.
    await cdp.clickOn("the Terminal menu", byText("#menubar .menu-title", "Terminal"));
    await cdp.clickOn("New Terminal", byText(".menu-list .menu-label", "New Terminal"));
    await cdp.until("a fresh terminal", async () => !(await cdp.eval(TERMINAL_LINES)).includes("cv-first-shell"));
    await say("cv-second-shell");
  });

  it("plays the demo: robots walk into the village", async () => {
    await cdp.until("robots in the status bar", async () => {
      const text = await cdp.eval(`document.querySelector("#status-robots").textContent`);
      return Number(/(\d+) robot/.exec(text)?.[1] ?? 0) > 0;
    }, 30_000);
  });

  it("shows no errors", () => {
    assert.deepEqual(errors, []);
  });

  it("closes cleanly from its close button", async () => {
    if (process.platform === "darwin") await cdp.eval(`window.cliVillage.window("close")`); // macOS draws its own buttons
    else await cdp.clickOn("the close button", `() => document.querySelector('.tb-win[data-win="close"]')`);
    const { code, stderr } = await exited;
    assert.equal(code, 0, stderr);
    await assert.rejects(fetch(`http://127.0.0.1:${port}/json/version`), "the debugging port is closed");
    assert.ok(readdirSync(folders[0]).length > 0, "the app kept its settings in the test's own folder");
  });
});
