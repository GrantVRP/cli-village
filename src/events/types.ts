// The event "language" every part of CLI Village speaks.
// Workers, the demo and external agents send events; the terminal view and
// the 3D village both listen to the same stream.
//
// This file must stay free of Node-only imports: the browser village uses it too.

export const EVENT_VERSION = 1;

/** Places in the village. Each building stands for a kind of task. */
export const BUILDINGS = ["townhall", "vault", "library", "workshop", "lab", "harbor", "home"] as const;
export type Building = (typeof BUILDINGS)[number];

/** Kinds of work an agent can start. */
export const TASK_KINDS = ["coordinate", "secrets", "research", "code", "test", "git", "scan"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/** Where each kind of work happens. */
export const KIND_TO_BUILDING: Record<TaskKind, Building> = {
  coordinate: "townhall",
  secrets: "vault",
  research: "library",
  code: "workshop",
  test: "lab",
  git: "harbor",
  scan: "harbor", // the secret-scan checkpoint gate before the dock
};

export const BUILDING_NAMES: Record<Building, string> = {
  townhall: "TOWN HALL",
  vault: "VAULT",
  library: "LIBRARY",
  workshop: "WORKSHOP",
  lab: "LAB",
  harbor: "GITHUB HARBOR",
  home: "HOME",
};

/** Plain-English meaning of each building, for the ? help overlay and the 3D village. */
export const BUILDING_HELP: Record<Building, string> = {
  vault: "Secrets from Infisical. Only key names and counts are shown, never values.",
  library: "Research gathered from the internet.",
  workshop: "Writing and editing code.",
  lab: "Running your tests.",
  townhall: "The coordinator that hands out tasks.",
  home: "Where idle robots rest.",
  harbor: "Commits become crates. A gate scans them for leaked secrets, then the boat ships them to GitHub.",
};

export const EVENT_TYPES = ["start", "move", "progress", "done", "fail", "commit", "push"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Who sent an event. */
export type EventSource = "builtin" | "external" | "demo";

/** Fields the event bus adds to every event. */
export interface EventMeta {
  /** Schema version, so old and new versions can tell each other apart. */
  v: typeof EVENT_VERSION;
  /** Increasing number, unique within a session. */
  seq: number;
  /** When it happened (milliseconds since 1970). */
  ts: number;
  source: EventSource;
  /** Which agent (robot) this is about, e.g. "Bolt" or "my-agent". */
  agent: string;
}

/** An agent begins a task at the building for that kind of work. */
export interface StartEvent extends EventMeta {
  type: "start";
  /** Task id, used by later progress/done/fail events. */
  task: string;
  kind: TaskKind;
  building: Building;
  /** Plain-English description, e.g. "Fetching dev secrets". */
  title: string;
  /** The real command behind it, e.g. "infisical export --env=dev". */
  command?: string;
}

/** An agent walks to a building. */
export interface MoveEvent extends EventMeta {
  type: "move";
  to: Building;
  from?: Building;
}

export interface ProgressEvent extends EventMeta {
  type: "progress";
  task: string;
  /** 0–100, if known. */
  percent?: number;
  message?: string;
}

export interface DoneEvent extends EventMeta {
  type: "done";
  task: string;
  message?: string;
  /** Secret key NAMES only (never values), e.g. ["DATABASE_URL"]. */
  keys?: string[];
  /** How many things were handled, e.g. number of secrets or tests. */
  count?: number;
}

export interface FailEvent extends EventMeta {
  type: "fail";
  task: string;
  message: string;
}

/** Work was saved as a commit (it becomes a crate in the village). */
export interface CommitEvent extends EventMeta {
  type: "commit";
  message: string;
  /** Short commit id, e.g. "a1b2c3d". */
  sha?: string;
  files?: number;
}

/** Commits were sent to GitHub (the boat sails). */
export interface PushEvent extends EventMeta {
  type: "push";
  remote?: string;
  branch?: string;
  commits?: number;
}

export type VillageEvent =
  | StartEvent
  | MoveEvent
  | ProgressEvent
  | DoneEvent
  | FailEvent
  | CommitEvent
  | PushEvent;

/** What senders provide. The bus fills in v, seq, ts and source; `building` comes from `kind`. */
type ToInput<E> = E extends VillageEvent ? Omit<E, "v" | "seq" | "ts" | "source" | "building"> : never;
export type EventInput = ToInput<VillageEvent>;
