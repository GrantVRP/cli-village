// Printing for one-off commands (secrets, status, commit, push, test):
// lines for people, or one JSON object for scripts (--json).
// With --quiet, only results go to stdout and problems go to stderr,
// so `names=$(cli-village secrets fetch --quiet)` captures just the names.
// Commands that run your own program (test) send every line for people to
// stderr instead, so the program's output on stdout stays clean.

import type { EventBus } from "../events/bus.js";
import { cyan, dim, red, symbols } from "../lib/style.js";
import type { Detail, Ui } from "../lib/ui.js";
import { attachTaskView } from "../views/task.js";

const stdout = (text: string) => process.stdout.write(`${text}\n`);
const stderr = (text: string) => process.stderr.write(`${text}\n`);

/** "1 file", "3 files". */
export const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A problem to show: what went wrong in plain English, and a command that might fix it. */
export interface Problem {
  error: string;
  hint?: string;
  /** What the other program said (already cleaned). Shown here only, never in an event. */
  details?: string;
}

export class Output {
  readonly json: boolean;
  readonly detail: Detail;
  /** Where lines for people go. Problems in --quiet mode always go to stderr. */
  private readonly human: (text: string) => void;
  /** Fields every later JSON result or problem includes (see keep). */
  private kept: object = {};

  constructor(ui: Ui, options: { humanTo?: "stdout" | "stderr" } = {}) {
    this.json = ui.json;
    this.detail = ui.detail;
    this.human = options.humanTo === "stderr" ? stderr : stdout;
  }

  get quiet(): boolean {
    return !this.json && this.detail === "quiet";
  }

  get full(): boolean {
    return !this.json && this.detail === "full";
  }

  /** A line for people. Not shown with --json or --quiet. */
  line = (text = "") => {
    if (!this.json && !this.quiet) this.human(text);
  };

  /** A blank line for breathing room (full detail only). */
  gap(): void {
    if (this.full) this.human("");
  }

  /** A line of the result itself, which --quiet still prints. */
  data(text: string): void {
    if (!this.json) this.human(text);
  }

  /** A note about a problem that isn't the final error (shown even with --quiet, on stderr). */
  warn(text: string): void {
    if (this.json) return;
    (this.quiet ? stderr : this.human)(text);
  }

  /** Follow a job's events: what's happening and how it ended. */
  watch(bus: EventBus): () => void {
    if (this.json) return () => {};
    return attachTaskView(bus, this.quiet ? stderr : this.human, this.detail);
  }

  /**
   * Remember fields for the final JSON line, whatever happens next. E.g. a
   * snapshot that was saved before sending it failed: scripts still need its id.
   */
  keep(data: object): void {
    this.kept = { ...this.kept, ...data };
  }

  /** The JSON result (only with --json). */
  result(data: object): void {
    if (this.json) stdout(JSON.stringify({ ok: true, ...this.kept, ...data }));
  }

  /**
   * Show a problem (and what might fix it). Returns the exit code, 1.
   * `alreadyShown`: the task view already printed the error line, so only add the hint.
   */
  problem(err: Problem, alreadyShown = false, extra: object = {}): number {
    if (this.json) {
      stdout(JSON.stringify({ ok: false, error: err.error, hint: err.hint, details: err.details, ...this.kept, ...extra }));
    } else {
      const write = this.quiet ? stderr : this.human;
      if (!alreadyShown) write(`${red(symbols.fail)} ${err.error}`);
      if (err.details) write(`  ${dim(`It said: ${err.details}`)}`);
      if (err.hint) write(`  ${dim("Try:")} ${cyan(err.hint)}`);
    }
    return 1;
  }
}
