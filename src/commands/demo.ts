// `cli-village --demo`: watch pretend robots work. Nothing real runs.
// In a real terminal you get the live view; otherwise (a pipe, CI) a plain log.

import { runDemo } from "../demo/runner.js";
import { EventBus } from "../events/bus.js";
import { summarize } from "../events/state.js";
import { VillageStore } from "../events/store.js";
import { bold, dim } from "../lib/style.js";
import { attachLogView } from "../views/log.js";
import { canUseTerminalView, runTerminalView } from "../views/terminal/index.js";

export interface DemoCommandOptions {
  json?: boolean;
  once?: boolean;
  speed?: number;
}

export async function runDemoCommand(options: DemoCommandOptions): Promise<number> {
  if (!options.json && canUseTerminalView()) return runLive(options);
  return runPlain(options);
}

/** The interactive terminal view. */
async function runLive(options: DemoCommandOptions): Promise<number> {
  const bus = new EventBus();
  const controller = new AbortController();
  const stop = () => controller.abort();
  const demo = runDemo(bus, { speed: options.speed, once: options.once, signal: controller.signal }).finally(() =>
    bus.close(),
  );

  process.on("SIGINT", stop);
  let final;
  try {
    final = await runTerminalView({ bus, mode: "demo", onStop: stop });
  } finally {
    process.off("SIGINT", stop);
    stop();
    await demo;
  }
  console.log(`${bold("CLI Village demo ended")} ${dim(`· ${summarize(final)}`)}`);
  return 0;
}

/** One line per event (or JSON lines with --json). */
async function runPlain(options: DemoCommandOptions): Promise<number> {
  const bus = new EventBus();
  const store = VillageStore.fromBus(bus);
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
  say(dim(summarize(store.getState())));
  return stopped ? 130 : 0;
}
