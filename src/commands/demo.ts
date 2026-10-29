// `cli-village --demo`: watch pretend robots work. Nothing real runs.

import { runDemo } from "../demo/runner.js";
import { EventBus } from "../events/bus.js";
import { bold, dim } from "../lib/style.js";
import { attachLogView } from "../views/log.js";

export interface DemoCommandOptions {
  json?: boolean;
  once?: boolean;
  speed?: number;
}

/** Returns the exit code: 0 when finished, 130 when stopped with Ctrl+C (the usual code for that). */
export async function runDemoCommand(options: DemoCommandOptions): Promise<number> {
  const bus = new EventBus();
  const stopPrinting = attachLogView(bus, { json: options.json });
  const say = (text: string) => {
    if (!options.json) console.log(text);
  };

  say("");
  say(`${bold("CLI Village demo")} ${dim("· pretend robots act out a workday. Nothing real runs.")}`);
  say(dim(options.once ? "  Plays one round. Press Ctrl+C to stop early." : "  Loops forever. Press Ctrl+C to stop."));
  say("");

  // First Ctrl+C: stop nicely (everyone walks home). Second Ctrl+C: quit right away.
  const controller = new AbortController();
  let stopped = false;
  const onCtrlC = () => {
    if (stopped) process.exit(130);
    stopped = true;
    controller.abort();
  };
  process.on("SIGINT", onCtrlC);

  try {
    await runDemo(bus, { speed: options.speed, once: options.once, signal: controller.signal });
  } finally {
    process.off("SIGINT", onCtrlC);
    bus.close();
    stopPrinting();
  }

  say("");
  say(stopped ? "Stopped. Everyone walked home." : "Demo finished. Everyone is home.");
  return stopped ? 130 : 0;
}
