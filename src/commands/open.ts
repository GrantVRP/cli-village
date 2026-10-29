// `cli-village open`: start the 3D village in your browser.
// The terminal keeps showing the live view (or plain lines), and both views
// follow the same events.
//
// Without --demo it shows real work: it opens the village's local socket (or
// follows a village that's already open), so your commands and AI agents show up.
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
import { joinVillage, WAITING, type Joined } from "./watch.js";

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

  // Real work arrives over the local socket.
  let joined: Joined | null = null;
  if (!options.demo) {
    joined = await joinVillage(bus);
    if (!joined.ok) {
      if (ui.json) console.log(JSON.stringify({ ok: false, error: joined.error }));
      else console.error(joined.error);
      return 1;
    }
  }
  const hub = joined?.ok ? joined : null;

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
    await hub?.close();
    return 1;
  }

  const controller = new AbortController();
  const stop = () => controller.abort();
  const work = options.demo
    ? runDemo(bus, { speed: options.speed, signal: controller.signal })
    : // Live mode: runs until you stop it (or the village it follows closes).
      new Promise<void>((resolve) => {
        controller.signal.addEventListener("abort", () => resolve(), { once: true });
        void hub?.ended?.then(() => resolve());
      });
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
    if (hub) console.log(dim(`  ${WAITING.subtitle} ${cyan("cli-village test")} (or status, commit, push…)`));
    console.log("");
  } else if (!live) {
    console.log(`${bold("CLI Village")} ${dim(`· ${mode} ·`)} ${cyan(server.url)}`);
  }

  process.on("SIGINT", stop);
  try {
    if (live) {
      await runTerminalView({ bus, mode, url: server.url, onStop: stop, compact: ui.detail === "compact", waiting: hub ? WAITING : undefined });
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
    await hub?.close();
  }

  if (!ui.json && !quiet) console.log(`${bold("CLI Village closed")} ${dim(`· ${summarize(store.getState())}`)}`);
  return 0;
}
