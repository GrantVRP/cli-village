// The robot that does the work you start yourself ("you"), told as events so
// every view can show it: it walks to the right building, starts a job,
// reports progress, and finishes (or hits a problem), then walks home.

import type { EventBus } from "../events/bus.js";
import { secretGuard } from "../events/guard.js";
import { KIND_TO_BUILDING, type Building, type TaskKind } from "../events/types.js";
import { forwardToVillage } from "../hub/client.js";

/** The robot name for work you start yourself. */
export const YOU = "you";

const KEY_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
const MAX_EVENT_KEYS = 100;

export class Worker {
  private at: Building = "home";
  private static nextTask = 0;

  constructor(
    readonly bus: EventBus,
    readonly name = YOU,
  ) {
    // If a village is open (in another terminal or the browser), it shows this work too.
    forwardToVillage(bus);
  }

  /** Walk somewhere (only if not already there). */
  walk(to: Building): void {
    if (this.at === to) return;
    this.bus.emit({ type: "move", agent: this.name, to, from: this.at });
    this.at = to;
  }

  /** Start a piece of work at the building for its kind. */
  job(kind: TaskKind, title: string, command?: string): Job {
    this.walk(KIND_TO_BUILDING[kind]);
    const task = `${kind}-${++Worker.nextTask}`;
    this.bus.emit({ type: "start", agent: this.name, task, kind, title, command });
    return new Job(this, task);
  }

  /** All done: back home to rest. */
  home(): void {
    this.walk("home");
  }
}

export class Job {
  constructor(
    private readonly worker: Worker,
    readonly task: string,
  ) {}

  progress(message: string, percent?: number): void {
    this.worker.bus.emit({ type: "progress", agent: this.worker.name, task: this.task, message, percent });
  }

  /** Finished. `keys` are secret NAMES only; anything that doesn't look like a name is left out. */
  done(message: string, keys?: readonly string[], count?: number): void {
    const { bus, name } = this.worker;
    const names = keys?.filter((k) => KEY_NAME.test(k) && !secretGuard.containsSecret(k)).slice(0, MAX_EVENT_KEYS);
    const sent = bus.emit({ type: "done", agent: name, task: this.task, message, keys: names, count });
    // If a name was refused for any reason, still report the result, just without names.
    if (!sent.ok) bus.emit({ type: "done", agent: name, task: this.task, message, count });
  }

  fail(message: string): void {
    this.worker.bus.emit({ type: "fail", agent: this.worker.name, task: this.task, message });
  }
}
