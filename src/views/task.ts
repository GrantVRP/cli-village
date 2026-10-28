// A short, friendly printout for one-off commands like `cli-village secrets fetch`:
// what's happening, the real command behind it, and how it ended.

import type { EventBus } from "../events/bus.js";
import { BUILDING_NAMES } from "../events/types.js";
import { bold, cyan, dim, green, red, symbols } from "../lib/style.js";

export function attachTaskView(bus: EventBus, write: (line: string) => void): () => void {
  return bus.subscribe((event) => {
    switch (event.type) {
      case "start":
        write(`${cyan(symbols.start)} ${bold(event.title)} ${dim(`at the ${BUILDING_NAMES[event.building]}`)}`);
        if (event.command) write(`  ${dim(symbols.arrow)} ${cyan(event.command)}`);
        break;
      case "progress":
        if (event.message) write(dim(`  ${symbols.progress} ${event.message}`));
        if (event.message === undefined && event.percent !== undefined) write(dim(`  ${symbols.progress} ${event.percent}%`));
        break;
      case "done":
        write(`${green(symbols.ok)} ${event.message ?? "Done"}`);
        break;
      case "fail":
        write(`${red(symbols.fail)} ${event.message}`);
        break;
      default:
        break;
    }
  });
}
