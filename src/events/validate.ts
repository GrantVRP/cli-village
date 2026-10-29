// Checks that an incoming event has the right shape, keeps only known fields,
// and cleans every piece of text through the privacy guard.
// Error messages are written for humans: external agents will see them.

import { secretGuard, type SecretGuard } from "./guard.js";
import {
  BUILDINGS,
  EVENT_TYPES,
  KIND_TO_BUILDING,
  TASK_KINDS,
  type EventType,
  type VillageEvent,
} from "./types.js";

/** An event before the bus adds its meta fields (v, seq, ts, source). */
type ToBody<E> = E extends VillageEvent ? Omit<E, "v" | "seq" | "ts" | "source"> : never;
export type EventBody = ToBody<VillageEvent>;

export type ParseResult = { ok: true; body: EventBody } | { ok: false; error: string };

const MAX_TEXT = 200;
const MAX_KEYS = 100;
const AGENT_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,31}$/;
const TASK_ID = /^[A-Za-z0-9][\w.:#-]{0,63}$/;
const KEY_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
const GIT_REF = /^[\w./-]{1,100}$/;
const SHA = /^[0-9a-f]{4,64}$/i;
const MAX_SOURCES = 10;
const MAX_SOURCE = 120;

class InvalidEvent extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

/** Reads and checks fields from one raw event. */
class Fields {
  constructor(
    private readonly raw: Record<string, unknown>,
    private readonly type: EventType,
    private readonly guard: SecretGuard,
  ) {}

  private fail(message: string): never {
    throw new InvalidEvent(`"${this.type}" event: ${message}`);
  }

  text(key: string): string {
    const value = this.optionalText(key);
    if (value === undefined) this.fail(`"${key}" is required (a short piece of text).`);
    return value;
  }

  optionalText(key: string): string | undefined {
    const value = this.raw[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") this.fail(`"${key}" must be text.`);
    const cleaned = this.guard.clean(value);
    if (!cleaned) return undefined;
    return cleaned.length > MAX_TEXT ? `${cleaned.slice(0, MAX_TEXT - 1)}…` : cleaned;
  }

  agent(): string {
    const value = this.raw.agent;
    if (typeof value !== "string" || !AGENT_NAME.test(value.trim())) {
      this.fail(`"agent" must be a short name like "Bolt" or "my-agent" (letters, numbers, spaces, . _ -; up to 32 characters).`);
    }
    return value.trim();
  }

  taskId(): string {
    const value = this.raw.task;
    if (typeof value !== "string" || !TASK_ID.test(value)) {
      this.fail(`"task" must be an id like "fetch-1" (letters, numbers, . _ : # -; up to 64 characters).`);
    }
    return value;
  }

  oneOf<T extends string>(key: string, list: readonly T[]): T {
    const value = this.raw[key];
    if (!isOneOf(list, value)) this.fail(`"${key}" must be one of: ${list.join(", ")}.`);
    return value;
  }

  optionalOneOf<T extends string>(key: string, list: readonly T[]): T | undefined {
    return this.raw[key] === undefined ? undefined : this.oneOf(key, list);
  }

  /** A whole number of 0 or more, e.g. a count of files. */
  optionalCount(key: string): number | undefined {
    const value = this.raw[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1_000_000) {
      this.fail(`"${key}" must be a whole number of 0 or more.`);
    }
    return value;
  }

  optionalPercent(): number | undefined {
    const value = this.raw.percent;
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value)) this.fail(`"percent" must be a number from 0 to 100.`);
    return Math.round(Math.min(100, Math.max(0, value)));
  }

  /** Secret key NAMES. Anything that looks like a value is refused. */
  optionalKeys(): string[] | undefined {
    const value = this.raw.keys;
    if (value === undefined || value === null) return undefined;
    if (!Array.isArray(value)) this.fail(`"keys" must be a list of secret names, like ["DATABASE_URL"].`);
    if (value.length > MAX_KEYS) this.fail(`"keys" can list at most ${MAX_KEYS} names. Use "count" for the total.`);
    return value.map((name) => {
      if (typeof name !== "string" || !KEY_NAME.test(name) || this.guard.clean(name) !== name || this.guard.containsSecret(name)) {
        this.fail(`"keys" must only contain secret NAMES (like DATABASE_URL), never values.`);
      }
      return name;
    });
  }

  /**
   * Web pages research came from. Each is cut down to site + path: the query
   * string, #fragment and any login are dropped (they can hold tokens), and
   * the rest goes through the privacy guard.
   */
  optionalSources(): string[] | undefined {
    const value = this.raw.sources;
    if (value === undefined || value === null) return undefined;
    const usage = `"sources" must be a list of web addresses, like ["https://docs.stripe.com/api"].`;
    if (!Array.isArray(value)) this.fail(usage);
    if (value.length > MAX_SOURCES) this.fail(`"sources" can list at most ${MAX_SOURCES} addresses.`);
    const seen = new Set<string>();
    for (const item of value) {
      let url: URL | null = null;
      try {
        // Already cut down (site + path, no https://) is fine too, so a checked event checks out the same again.
        url = typeof item === "string" ? new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(item) ? item : `https://${item}`) : null;
      } catch {
        url = null;
      }
      if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) this.fail(usage);
      // A site name that looks like a token is left out. In the path, each part is checked on its own,
      // so a token becomes [hidden] and the rest of the address stays readable.
      if (this.guard.clean(url.host) !== url.host) continue;
      const parts = url.pathname === "/" ? [] : url.pathname.split("/").map((part) => this.guard.clean(part));
      seen.add(`${url.host}${parts.join("/")}`.slice(0, MAX_SOURCE));
    }
    return [...seen];
  }

  optionalSha(): string | undefined {
    const value = this.raw.sha;
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string" || !SHA.test(value)) this.fail(`"sha" must be a commit id like "a1b2c3d".`);
    return value.slice(0, 7).toLowerCase();
  }

  optionalRef(key: string): string | undefined {
    const value = this.raw[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string" || !GIT_REF.test(value)) this.fail(`"${key}" must be a name like "origin" or "main".`);
    return value;
  }
}

/** Drop fields that weren't provided, so events stay small and tidy. */
function compact<T extends object>(obj: T): T {
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] === undefined) delete obj[key];
  }
  return obj;
}

function build(input: unknown, guard: SecretGuard): EventBody {
  if (!isRecord(input)) {
    throw new InvalidEvent(`An event must be a JSON object, like {"type":"start","agent":"Bolt",...}.`);
  }
  if (!isOneOf(EVENT_TYPES, input.type)) {
    throw new InvalidEvent(`Unknown event type ${JSON.stringify(input.type)}. Use one of: ${EVENT_TYPES.join(", ")}.`);
  }
  const type = input.type;
  const f = new Fields(input, type, guard);
  const agent = f.agent();

  switch (type) {
    case "start": {
      const kind = f.oneOf("kind", TASK_KINDS);
      return compact({
        type,
        agent,
        task: f.taskId(),
        kind,
        building: KIND_TO_BUILDING[kind],
        title: f.text("title"),
        command: f.optionalText("command"),
      });
    }
    case "move":
      return compact({ type, agent, to: f.oneOf("to", BUILDINGS), from: f.optionalOneOf("from", BUILDINGS) });
    case "progress":
      return compact({ type, agent, task: f.taskId(), percent: f.optionalPercent(), message: f.optionalText("message") });
    case "done":
      return compact({
        type,
        agent,
        task: f.taskId(),
        message: f.optionalText("message"),
        keys: f.optionalKeys(),
        count: f.optionalCount("count"),
        sources: f.optionalSources(),
      });
    case "fail":
      return compact({ type, agent, task: f.taskId(), message: f.text("message") });
    case "commit":
      return compact({
        type,
        agent,
        message: f.text("message"),
        sha: f.optionalSha(),
        files: f.optionalCount("files"),
      });
    case "push":
      return compact({
        type,
        agent,
        remote: f.optionalRef("remote"),
        branch: f.optionalRef("branch"),
        commits: f.optionalCount("commits"),
      });
  }
}

/** Check and clean one raw event. Never throws for bad input: returns { ok: false, error } instead. */
export function parseEvent(input: unknown, guard: SecretGuard = secretGuard): ParseResult {
  try {
    return { ok: true, body: build(input, guard) };
  } catch (err) {
    if (err instanceof InvalidEvent) return { ok: false, error: err.message };
    throw err;
  }
}
