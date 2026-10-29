// A short, friendly printout for one-off commands like `cli-village secrets fetch`:
// what's happening, the real command behind it, what that command means, and
// how it ended. --compact folds the first part into one line; --quiet shows
// only problems.

import type { EventBus } from "../events/bus.js";
import { explainTask } from "../events/explain.js";
import { BUILDING_NAMES } from "../events/types.js";
import { bold, cyan, dim, green, red, symbols } from "../lib/style.js";
import type { Detail } from "../lib/ui.js";

export function attachTaskView(bus: EventBus, write: (line: string) => void, detail: Detail = "full"): () => void {
  return bus.subscribe((event) => {
    if (detail === "quiet" && event.type !== "fail") return;
    switch (event.type) {
      case "start":
        if (detail === "compact") {
          write(`${cyan(symbols.start)} ${bold(event.title)}${event.command ? ` ${dim(symbols.arrow)} ${cyan(event.command)}` : ""}`);
          break;
        }
        write(`${cyan(symbols.start)} ${bold(event.title)} ${dim(`at the ${BUILDING_NAMES[event.building]}`)}`);
        if (event.command) write(`  ${dim(symbols.arrow)} ${cyan(event.command)}`);
        write(dim(`    ${explainTask(event.kind, event.command)}`));
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
