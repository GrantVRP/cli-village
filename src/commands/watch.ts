// `cli-village` (in a terminal) or `cli-village watch`: the live village for
// real work. It opens the local socket, so your commands (status, test,
// commit, push, secrets, run) and your AI agents (`cli-village emit`) show up
// here. If a village is already open, this one follows it instead.

import { EventBus } from "../events/bus.js";
import { summarize } from "../events/state.js";
import { VillageStore } from "../events/store.js";
import { follow } from "../hub/client.js";
import { startHub } from "../hub/server.js";
import { bold, cyan, dim } from "../lib/style.js";
import type { Ui } from "../lib/ui.js";
import { attachLogView } from "../views/log.js";
import type { WaitingHint } from "../views/terminal/App.js";
import { runTerminalView, wantsLiveView } from "../views/terminal/index.js";

/** What the terminal view suggests before anything has happened. */
export const WAITING: WaitingHint = {
  subtitle: "Waiting for work. In another terminal, try:",
  command: 'cli-village status · test · commit -m "..." · push',
  explain: "AI agents can report their work too: cli-village emit (docs/EVENTS.md)",
};

export type Joined =
  | { ok: true; role: "host" | "follower"; path: string; ended?: Promise<void>; close: () => Promise<void> }
  | { ok: false; error: string };

/** Open the village's socket, or follow the village that already has it. */
export async function joinVillage(bus: EventBus): Promise<Joined> {
  const started = await startHub(bus);
  if (started.ok) return { ok: true, role: "host", path: started.hub.address.path, close: () => started.hub.close() };
  if (!started.busy) return { ok: false, error: started.error };
  const followed = await follow(bus, started.address);
  if (!followed.ok) return { ok: false, error: "Another village seems to be open, but it didn't answer. Close it, then try again." };
  return {
    ok: true,
    role: "follower",
    path: started.address.path,
    ended: followed.ended,
    close: async () => followed.stop(),
  };
}

export async function runWatch(ui: Ui): Promise<number> {
  const bus = new EventBus();
  const store = VillageStore.fromBus(bus);
  const quiet = !ui.json && ui.detail === "quiet";
  const say = (text: string) => (quiet ? process.stderr : process.stdout).write(`${text}\n`);

  const joined = await joinVillage(bus);
  if (!joined.ok) {
    if (ui.json) console.log(JSON.stringify({ ok: false, error: joined.error }));
    else say(joined.error);
    return 1;
  }

  const controller = new AbortController();
  const stop = () => controller.abort();
  const stopped = new Promise<void>((resolve) => controller.signal.addEventListener("abort", () => resolve(), { once: true }));
  let hostClosed = false;
  void joined.ended?.then(() => {
    hostClosed = true;
    stop();
  });
  const finished = stopped.then(() => bus.close());

  const live = wantsLiveView(ui);
  const following = joined.role === "follower";
  if (ui.json) console.log(JSON.stringify({ ok: true, watching: true, following, socket: joined.path }));
  else if (!live && ui.detail === "full") {
    say("");
    say(`${bold("CLI Village")} ${dim(following ? "· following the village that's already open" : "· watching for work")}`);
    say(dim(`  ${WAITING.subtitle} ${cyan("cli-village test")} (or status, commit, push, secrets, run)`));
    say(dim(`  ${WAITING.explain}`));
    say(dim("  Press Ctrl+C to stop."));
    say("");
  } else if (!live && !quiet) {
    say(`${bold("CLI Village")} ${dim(following ? "· following" : "· watching")}`);
  }

  process.on("SIGINT", stop);
  try {
    if (live) {
      await runTerminalView({ bus, mode: following ? "following" : "live", onStop: stop, compact: ui.detail === "compact", waiting: WAITING });
    } else {
      const stopPrinting = attachLogView(bus, { json: ui.json, detail: ui.detail, write: quiet ? (text) => process.stderr.write(`${text}\n`) : undefined });
      await finished;
      stopPrinting();
    }
  } finally {
    process.off("SIGINT", stop);
    stop();
    await finished;
    await joined.close();
  }

  if (!ui.json && !quiet) {
    if (hostClosed) say(dim("The village you were following has closed."));
    say(`${bold("CLI Village closed")} ${dim(`· ${summarize(store.getState())}`)}`);
  }
  return 0;
}
