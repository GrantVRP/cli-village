// Starts the terminal view and gives the terminal back cleanly when it ends.

import { render } from "ink";
import type { EventBus } from "../../events/bus.js";
import type { VillageState } from "../../events/state.js";
import { VillageStore } from "../../events/store.js";
import type { Ui } from "../../lib/ui.js";
import { App, type WaitingHint } from "./App.js";

export interface TerminalViewOptions {
  bus: EventBus;
  mode: string;
  url?: string;
  /** --compact: fewer lines, no beginner explanations. */
  compact?: boolean;
  /** Called when you press q (or Ctrl+C) the first time. */
  onStop: () => void;
  /** What to suggest before anything has happened. */
  waiting?: WaitingHint;
}

/** True when we can draw the interactive view (a real terminal, not a pipe or CI log). */
export function canUseTerminalView(): boolean {
  return process.stdout.isTTY === true && process.stdin.isTTY === true && process.env.TERM !== "dumb";
}

/**
 * True when the live, redrawing view should be used. --json, --quiet and
 * --no-animation all ask for plain lines instead (nothing on screen moves).
 */
export function wantsLiveView(ui: Ui): boolean {
  return !ui.json && ui.detail !== "quiet" && ui.animation && canUseTerminalView();
}

/** Shows the live view until you quit. Returns the final village state for a summary. */
export async function runTerminalView(options: TerminalViewOptions): Promise<VillageState> {
  const store = VillageStore.fromBus(options.bus);

  // Safety net: if anything crashes, still show the cursor again.
  const showCursor = () => process.stdout.write("\u001B[?25h");
  process.once("exit", showCursor);

  const instance = render(<App store={store} mode={options.mode} url={options.url} onStop={options.onStop} compact={options.compact} waiting={options.waiting} />, {
    // Draw on a separate screen; your terminal comes back exactly as it was.
    alternateScreen: true,
    // We handle Ctrl+C ourselves so the robots can walk home first.
    exitOnCtrlC: false,
  });

  try {
    await instance.waitUntilExit();
  } finally {
    instance.unmount();
    process.off("exit", showCursor);
  }
  return store.getState();
}
