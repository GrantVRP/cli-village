// `cli-village open`: start the 3D village in your browser.
// The terminal keeps showing the live view (or a plain log), and both views
// follow the same events.

import { runDemo } from "../demo/runner.js";
import { EventBus } from "../events/bus.js";
import { summarize } from "../events/state.js";
import { VillageStore } from "../events/store.js";
import { bold, cyan, dim } from "../lib/style.js";
import { openBrowser } from "../server/open-browser.js";
import { startVillageServer } from "../server/server.js";
import { attachLogView } from "../views/log.js";
import { canUseTerminalView, runTerminalView } from "../views/terminal/index.js";

export interface OpenCommandOptions {
  demo?: boolean;
  speed?: number;
  port?: number;
  /** false = only print the address, don't open a browser. */
  open?: boolean;
  version: string;
}

export async function runOpenCommand(options: OpenCommandOptions): Promise<number> {
  const bus = new EventBus();
  const store = VillageStore.fromBus(bus);
  const mode = options.demo ? "demo" : "live";

  let server;
  try {
    server = await startVillageServer({ bus, mode, version: options.version, port: options.port });
  } catch (err) {
    console.error(`Couldn't start the village: ${(err as Error).message}`);
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
  const live = canUseTerminalView();

  if (!live) {
    console.log("");
    console.log(`${bold("CLI Village")} ${dim(`· ${mode}`)}`);
    console.log(`  3D village: ${cyan(server.url)}`);
    console.log(dim(opened ? "  Opening it in your browser…" : "  Open that address in your browser."));
    console.log(dim("  Only this computer can open it. Press Ctrl+C to stop."));
    console.log("");
  }

  process.on("SIGINT", stop);
  try {
    if (live) {
      await runTerminalView({ bus, mode, url: server.url, onStop: stop });
    } else {
      const stopPrinting = attachLogView(bus);
      await finished;
      stopPrinting();
    }
  } finally {
    process.off("SIGINT", stop);
    stop();
    await finished;
    await server.close();
  }

  console.log(`${bold("CLI Village closed")} ${dim(`· ${summarize(store.getState())}`)}`);
  return 0;
}
