// Plays the demo script on the event bus, at any speed, until stopped.

import { setTimeout as sleep } from "node:timers/promises";
import type { EventBus } from "../events/bus.js";
import type { Building, EventInput } from "../events/types.js";
import { DEMO_AGENTS, demoRound } from "./script.js";

export interface DemoOptions {
  /** 2 = twice as fast. */
  speed?: number;
  /** Play one round instead of looping forever. */
  once?: boolean;
  /** Abort this to stop the demo (e.g. on Ctrl+C). */
  signal?: AbortSignal;
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/** Runs until the round(s) finish or the signal aborts. When stopped, every robot walks home. */
export async function runDemo(bus: EventBus, options: DemoOptions = {}): Promise<void> {
  const speed = options.speed ?? 1;
  const where = new Map<string, Building>(DEMO_AGENTS.map((agent) => [agent, "home"]));

  const send = (event: EventInput) => {
    // Fill in where a robot is walking from, so the script doesn't have to.
    if (event.type === "move") {
      const from = where.get(event.agent) ?? "home";
      if (from === event.to) return;
      where.set(event.agent, event.to);
      event = { ...event, from };
    }
    bus.emit(event, "demo");
  };

  try {
    for (let round = 1; ; round++) {
      for (const step of demoRound(round)) {
        await sleep(step.wait / speed, undefined, { signal: options.signal });
        if (step.event) send(step.event);
      }
      if (options.once) break;
    }
  } catch (err) {
    if (!isAbort(err)) throw err;
    // Stopped: everyone walks home.
    for (const agent of DEMO_AGENTS) send({ type: "move", agent, to: "home" });
  }
}
