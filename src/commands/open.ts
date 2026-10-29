// `cli-village open`: start the 3D village in your browser.
// The terminal keeps showing the live view (or plain lines), and both views
// follow the same events.
//
// --json prints {"ok":true,"url":...} and then each event as a JSON line.
// --quiet prints only the address. --no-animation also makes the 3D village still.

import { runDemo } from "../demo/runner.js";
import { EventBus } from "../events/bus.js";
import { summarize } from "../events/state.js";
import { VillageStore } from "../events/store.js";
import { bold, cyan, dim } from "../lib/style.js";
import type { Ui } from "../lib/ui.js";
import { openBrowser } from "../server/open-browser.js";
import { startVillageServer } from "../server/server.js";
import { attachLogView } from "../views/log.js";
import { runTerminalView, wantsLiveView } from "../views/terminal/index.js";

export interface OpenCommandOptions {
  demo?: boolean;
  speed?: number;
  port?: number;
  /** false = only print the address, don't open a browser. */
  open?: boolean;
  version: string;
}

export async function runOpenCommand(options: OpenCommandOptions, ui: Ui): Promise<number> {
  const bus = new EventBus();
  const store = VillageStore.fromBus(bus);
  const mode = options.demo ? "demo" : "live";
  const quiet = !ui.json && ui.detail === "quiet";
  const full = !ui.json && ui.detail === "full";

  let server;
  try {
    server = await startVillageServer({
      bus,
      mode,
      version: options.version,
      port: options.port,
      view: { compact: ui.detail !== "full", animation: ui.animation },
    });
  } catch (err) {
    const message = `Couldn't start the village: ${(err as Error).message}`;
    if (ui.json) console.log(JSON.stringify({ ok: false, error: message }));
    else console.error(message);
    return 1;
  }

  const controller = new AbortController();
  const stop = () => controller.abort();
  const work = options.demo
    ? runDemo(bus, { speed: options.speed, signal: controller.signal })
    : // Live mode: real workers and outside agents will send events here (later steps).
      new Promise<void>((resolve) => controller.signal.addEventListener("abort", () => resolve(), { once: true }));
  const finished = work.finally(() => bus.close());

  const opened = options.open !== false && openBrowser(server.url);
  const live = wantsLiveView(ui);

  if (ui.json) console.log(JSON.stringify({ ok: true, url: server.url }));
  else if (quiet) console.log(server.url);
  else if (!live && full) {
    console.log("");
    console.log(`${bold("CLI Village")} ${dim(`· ${mode}`)}`);
    console.log(`  3D village: ${cyan(server.url)}`);
    console.log(dim(opened ? "  Opening it in your browser…" : "  Open that address in your browser."));
    console.log(dim("  Only this computer can open it. Press Ctrl+C to stop."));
    console.log("");
  } else if (!live) {
    console.log(`${bold("CLI Village")} ${dim(`· ${mode} ·`)} ${cyan(server.url)}`);
  }

  process.on("SIGINT", stop);
  try {
    if (live) {
      await runTerminalView({ bus, mode, url: server.url, onStop: stop, compact: ui.detail === "compact" });
    } else {
      const stopPrinting = attachLogView(bus, {
        json: ui.json,
        detail: ui.detail,
        write: quiet ? (text) => process.stderr.write(`${text}\n`) : undefined,
      });
      await finished;
      stopPrinting();
    }
  } finally {
    process.off("SIGINT", stop);
    stop();
    await finished;
    await server.close();
  }

  if (!ui.json && !quiet) console.log(`${bold("CLI Village closed")} ${dim(`· ${summarize(store.getState())}`)}`);
  return 0;
}
