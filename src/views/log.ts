// The simplest view: one line per event. Used when there's no interactive
// terminal (a pipe, CI), with --quiet or --no-animation, and by `--json`
// (each event as one line of JSON, for scripts).
//
// How much it says depends on the detail level:
//   full     each step, the real command, and (the first time) what it means
//   compact  one line per step; walking isn't shown
//   quiet    only problems

import type { EventBus } from "../events/bus.js";
import { commitCommand, explainCommand, explainProblem, explainTask } from "../events/explain.js";
import { summarizeKeys, summarizeSources } from "../events/state.js";
import { BUILDING_NAMES, type TaskKind, type VillageEvent } from "../events/types.js";
import { bold, cyan, dim, green, red, symbols, yellow } from "../lib/style.js";
import { teachOnce, type Detail } from "../lib/ui.js";

export interface LogViewOptions {
  json?: boolean;
  detail?: Detail;
  write?: (line: string) => void;
}

const AGENT_WIDTH = 9;
const INDENT = " ".repeat(10 + AGENT_WIDTH + 1);

function clock(ts: number): string {
  return new Date(ts).toTimeString().slice(0, 8);
}

/**
 * Makes a function that turns one event into the line(s) a person reads.
 * It remembers a little (which explanations it has shown, and each robot's
 * last command), so a long log teaches without repeating itself.
 */
export function createFormatter(detail: Detail = "full"): (event: VillageEvent) => string[] {
  const teach = teachOnce();
  const lastCommand = new Map<string, string>();
  // What kind of work each task is, so a problem can say what usually helps.
  const kinds = new Map<string, TaskKind>();

  // The real command and its explanation, under the event's own line.
  const extras = (command: string | undefined, explanation: string | undefined): string[] => {
    if (detail !== "full") return [];
    const lines: string[] = [];
    if (command) lines.push(`${INDENT}  ${dim(symbols.arrow)} ${cyan(command)}`);
    const taught = teach(explanation);
    if (taught) lines.push(dim(`${INDENT}    ${taught}`));
    return lines;
  };

  return (event) => {
    if (detail === "quiet" && event.type !== "fail") return [];
    const who = bold(event.agent.padEnd(AGENT_WIDTH));
    const time = dim(clock(event.ts));
    const line = (text: string) => `${time}  ${who} ${text}`;
    // Commits and pushes don't carry a command, so show the git one, unless the robot's
    // start step just showed it. Each start step counts once.
    const shownBefore = (matches: (shown: string) => boolean) => {
      const shown = lastCommand.get(event.agent);
      lastCommand.delete(event.agent);
      return shown !== undefined && matches(shown);
    };

    switch (event.type) {
      case "start": {
        kinds.set(event.task, event.kind);
        if (kinds.size > 500) kinds.delete(kinds.keys().next().value!);
        if (event.command) lastCommand.set(event.agent, event.command);
        else lastCommand.delete(event.agent);
        const where = dim(`at the ${BUILDING_NAMES[event.building]}`);
        if (detail === "compact") {
          return [line(`${cyan(symbols.start)} ${event.title} ${event.command ? `${dim(symbols.arrow)} ${cyan(event.command)}` : where}`)];
        }
        return [line(`${cyan(symbols.start)} ${event.title} ${where}`), ...extras(event.command, explainTask(event.kind, event.command))];
      }
      case "move":
        if (detail === "compact") return [];
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
        const keys = event.keys?.length
          ? dim(`: ${summarizeKeys(event.keys, event.count)}`)
          : event.sources?.length
            ? dim(` (${summarizeSources(event.sources)})`)
            : "";
        return [line(`${green(`${symbols.ok} done`)} ${event.message ?? "finished"}${keys}`)];
      }
      case "fail": {
        const kind = kinds.get(event.task);
        return [line(bold(red(`${symbols.fail} problem: ${event.message}`))), ...extras(undefined, kind && explainProblem(kind))];
      }
      case "commit": {
        const sha = event.sha ? `${event.sha} ` : "";
        const files = event.files !== undefined ? dim(` (${event.files} file${event.files === 1 ? "" : "s"})`) : "";
        const command = commitCommand(event.message);
        const shown = shownBefore((c) => c.startsWith("git commit"));
        return [
          line(`${yellow(`${symbols.commit} commit`)} ${sha}"${event.message}"${files}`),
          ...extras(shown ? undefined : command, explainCommand("git commit")),
        ];
      }
      case "push": {
        const remote = event.remote ?? "origin";
        const branch = event.branch ?? "main";
        const n = event.commits ?? 1;
        const command = `git push ${remote} ${branch}`;
        const shown = shownBefore((c) => c.startsWith("git push"));
        return [
          line(`${green(`${symbols.push} pushed`)} ${n} commit${n === 1 ? "" : "s"} to ${remote}/${branch}. The ship sails!`),
          ...extras(shown ? undefined : command, explainCommand("git push")),
        ];
      }
    }
  };
}

/** Print every event on the bus. Returns a function that stops printing. */
export function attachLogView(bus: EventBus, options: LogViewOptions = {}): () => void {
  const write = options.write ?? ((text: string) => process.stdout.write(`${text}\n`));
  const format = createFormatter(options.detail);
  return bus.subscribe((event) => {
    if (options.json) write(JSON.stringify(event));
    else for (const text of format(event)) write(text);
  });
}
