// The simplest view: one line per event. Used by the demo for now, and later
// as the fallback when there's no interactive terminal (e.g. in CI).
// `json` mode prints each event as one line of JSON instead (for scripts).

import type { EventBus } from "../events/bus.js";
import { BUILDING_NAMES, type VillageEvent } from "../events/types.js";
import { bold, cyan, dim, green, red, symbols, yellow } from "../lib/style.js";

export interface LogViewOptions {
  json?: boolean;
  write?: (line: string) => void;
}

const AGENT_WIDTH = 9;

function clock(ts: number): string {
  return new Date(ts).toTimeString().slice(0, 8);
}

/** "DATABASE_URL, STRIPE_SECRET_KEY, REDIS_URL +9 more" */
export function summarizeKeys(keys: string[], total = keys.length): string {
  const shown = keys.slice(0, 3).join(", ");
  const more = total - Math.min(keys.length, 3);
  return more > 0 ? `${shown} +${more} more` : shown;
}

/** Turn one event into the line(s) a person reads. */
export function formatEvent(event: VillageEvent): string[] {
  const who = bold(event.agent.padEnd(AGENT_WIDTH));
  const time = dim(clock(event.ts));
  const line = (text: string) => `${time}  ${who} ${text}`;
  const indent = " ".repeat(10 + AGENT_WIDTH + 1);

  switch (event.type) {
    case "start": {
      const lines = [line(`${cyan(symbols.start)} ${event.title} ${dim(`at the ${BUILDING_NAMES[event.building]}`)}`)];
      if (event.command) lines.push(`${indent}  ${dim(symbols.arrow)} ${cyan(event.command)}`);
      return lines;
    }
    case "move":
      return [
        dim(
          `${clock(event.ts)}  ${event.agent.padEnd(AGENT_WIDTH)} ${symbols.move} walks ${
            event.from ? `from ${BUILDING_NAMES[event.from]} ` : ""
          }to ${BUILDING_NAMES[event.to]}`,
        ),
      ];
    case "progress": {
      const pct = event.percent !== undefined ? ` (${event.percent}%)` : "";
      return [line(dim(`${symbols.progress} ${event.message ?? "working"}${pct}`))];
    }
    case "done": {
      const keys = event.keys?.length ? dim(`: ${summarizeKeys(event.keys, event.count)}`) : "";
      return [line(`${green(`${symbols.ok} done`)} ${event.message ?? "finished"}${keys}`)];
    }
    case "fail":
      return [line(bold(red(`${symbols.fail} problem: ${event.message}`)))];
    case "commit": {
      const sha = event.sha ? `${event.sha} ` : "";
      const files = event.files !== undefined ? dim(` (${event.files} file${event.files === 1 ? "" : "s"})`) : "";
      return [line(`${yellow(`${symbols.commit} commit`)} ${sha}"${event.message}"${files}`)];
    }
    case "push": {
      const target = `${event.remote ?? "origin"}/${event.branch ?? "main"}`;
      const n = event.commits ?? 1;
      return [line(`${green(`${symbols.push} pushed`)} ${n} commit${n === 1 ? "" : "s"} to ${target}. The boat sails!`)];
    }
  }
}

/** Print every event on the bus. Returns a function that stops printing. */
export function attachLogView(bus: EventBus, options: LogViewOptions = {}): () => void {
  const write = options.write ?? ((text: string) => process.stdout.write(`${text}\n`));
  return bus.subscribe((event) => {
    if (options.json) write(JSON.stringify(event));
    else for (const text of formatEvent(event)) write(text);
  });
}
