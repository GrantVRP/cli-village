// Turns the event stream into a picture of the village right now: where each
// robot is, what it's doing, which buildings need attention, the crates on
// their way to GitHub, and the ONE message that matters most at the moment.
//
// Both views use this: the terminal view and the 3D village in the browser.
// So: no Node-only imports, and `reduce` never changes the old state.

import { commitCommand, explainCommand, explainProblem, explainTask } from "./explain.js";
import {
  BUILDINGS,
  BUILDING_NAMES,
  type Building,
  type EventSource,
  type EventType,
  type TaskKind,
  type VillageEvent,
} from "./types.js";

export type AgentStatus = "idle" | "walking" | "working" | "failed";

export interface TaskState {
  id: string;
  agent: string;
  kind: TaskKind;
  building: Building;
  title: string;
  command?: string;
  percent?: number;
  message?: string;
  startedAt: number;
}

export interface AgentState {
  name: string;
  source: EventSource;
  /** Where the robot is, or where it's walking to. */
  location: Building;
  /** Where it's walking from (only set right after a move). */
  from?: Building;
  movedAt: number;
  status: AgentStatus;
  task?: TaskState;
  /** What its speech bubble says. */
  say?: string;
  updatedAt: number;
}

/** Visual weight: primary = bright/bold, secondary = normal, tertiary = dim. */
export type Emphasis = "primary" | "secondary" | "tertiary";

export interface LogEntry {
  seq: number;
  ts: number;
  type: EventType;
  agent: string;
  building?: Building;
  text: string;
  emphasis: Emphasis;
}

export interface BuildingState {
  id: Building;
  /** Robots working here right now. */
  working: string[];
  /** A problem here that hasn't been fixed yet. */
  problem?: { agent: string; message: string; seq: number };
  log: LogEntry[];
  lastActive: number;
}

export type CrateStatus = "packed" | "scanning" | "blocked" | "cleared" | "shipped";

export interface Crate {
  seq: number;
  agent: string;
  message: string;
  sha?: string;
  files?: number;
  status: CrateStatus;
  /**
   * Packed by the gate itself: a scan began before any snapshot arrived. That's
   * your changes (cli-village commit scans them before saving), or snapshots
   * made outside CLI Village (before a push). The next commit fills it in.
   */
  draft?: boolean;
}

/** The last time the boat sailed. */
export interface LastPush {
  remote: string;
  branch: string;
  commits: number;
  /** How many crates it took (0 when the push only published the branch). */
  crates: number;
  ts: number;
}

export type HeadlineLevel = "attention" | "active" | "calm";

/** The single most important thing happening, shown biggest in every view. */
export interface Headline {
  title: string;
  subtitle?: string;
  command?: string;
  /** The beginner explainer: what that command (or kind of work) means, in plain English. */
  explain?: string;
  level: HeadlineLevel;
  agent?: string;
  building?: Building;
  seq: number;
}

export interface VillageState {
  agents: Record<string, AgentState>;
  buildings: Record<Building, BuildingState>;
  tasks: Record<string, TaskState>;
  crates: Crate[];
  lastPush?: LastPush;
  headline: Headline;
  log: LogEntry[];
  stats: { done: number; failed: number; fixed: number; commits: number; pushes: number };
  /** 1 = all good, 0 = lots of unfixed problems. Drives the glowing column. */
  health: number;
  stopped: boolean;
  lastSeq: number;
}

const BUILDING_LOG_SIZE = 30;
const LOG_SIZE = 200;
const MAX_TASKS = 200;
const MAX_CRATES = 12;
/** How long a walk takes, roughly. Views use this to tell walking from standing. */
export const WALK_MS = 2500;

const IDLE_HEADLINE: Headline = {
  title: "The village is quiet",
  subtitle: "Waiting for work…",
  level: "calm",
  seq: 0,
};

export function createVillageState(): VillageState {
  const buildings = {} as Record<Building, BuildingState>;
  for (const id of BUILDINGS) buildings[id] = { id, working: [], log: [], lastActive: 0 };
  return {
    agents: {},
    buildings,
    tasks: {},
    crates: [],
    headline: IDLE_HEADLINE,
    log: [],
    stats: { done: 0, failed: 0, fixed: 0, commits: 0, pushes: 0 },
    health: 1,
    stopped: false,
    lastSeq: 0,
  };
}

const at = (building: Building) => `the ${BUILDING_NAMES[building]}`;

/** "DATABASE_URL, STRIPE_SECRET_KEY, REDIS_URL +9 more" */
export function summarizeKeys(keys: readonly string[], total = keys.length): string {
  const shown = keys.slice(0, 3).join(", ");
  const more = total - Math.min(keys.length, 3);
  return more > 0 ? `${shown} +${more} more` : shown;
}

/** "from docs.stripe.com, github.com +2 more": the sites research came from. */
export function summarizeSources(sources: readonly string[]): string {
  const sites = [...new Set(sources.map((s) => s.split("/")[0]!))];
  const more = sites.length - Math.min(sites.length, 3);
  return `from ${sites.slice(0, 3).join(", ")}${more > 0 ? ` +${more} more` : ""}`;
}

function computeHealth(buildings: Record<Building, BuildingState>): number {
  let health = 1;
  for (const b of Object.values(buildings)) {
    // A leaked secret at the harbor gate is the most serious problem.
    if (b.problem) health -= b.id === "harbor" ? 0.6 : 0.4;
  }
  return Math.max(0, Math.min(1, health));
}

function withLog(state: VillageState, entry: LogEntry): Pick<VillageState, "log" | "buildings"> {
  const log = [...state.log, entry].slice(-LOG_SIZE);
  if (!entry.building) return { log, buildings: state.buildings };
  const b = state.buildings[entry.building];
  return {
    log,
    buildings: {
      ...state.buildings,
      [entry.building]: { ...b, log: [...b.log, entry].slice(-BUILDING_LOG_SIZE), lastActive: entry.ts },
    },
  };
}

function setBuilding(
  buildings: Record<Building, BuildingState>,
  id: Building,
  change: (b: BuildingState) => BuildingState,
): Record<Building, BuildingState> {
  return { ...buildings, [id]: change(buildings[id]) };
}

const without = (list: string[], name: string) => list.filter((n) => n !== name);

/** Apply one event and return the new state. The old state is left untouched. */
export function reduce(state: VillageState, event: VillageEvent): VillageState {
  if (event.seq <= state.lastSeq) return state; // already seen (e.g. replayed history)

  const previous = state.agents[event.agent];
  const agent: AgentState = previous ?? {
    name: event.agent,
    source: event.source,
    location: "home",
    movedAt: 0,
    status: "idle",
    updatedAt: event.ts,
  };
  const next: VillageState = { ...state, lastSeq: event.seq };
  const entry = (text: string, emphasis: Emphasis, building?: Building): LogEntry => ({
    seq: event.seq,
    ts: event.ts,
    type: event.type,
    agent: event.agent,
    building,
    text,
    emphasis,
  });
  const putAgent = (a: AgentState) => (next.agents = { ...state.agents, [a.name]: { ...a, updatedAt: event.ts } });

  switch (event.type) {
    case "move": {
      putAgent({
        ...agent,
        from: event.from ?? agent.location,
        location: event.to,
        movedAt: event.ts,
        status: agent.status === "failed" ? "failed" : "walking",
        task: undefined,
        // A robot with a problem keeps saying what it was, even on its way home.
        say: agent.status === "failed" ? agent.say : undefined,
      });
      // Leaving a building means no longer working there.
      if (agent.task) next.buildings = setBuilding(state.buildings, agent.task.building, (b) => ({ ...b, working: without(b.working, agent.name) }));
      next.log = [...state.log, entry(`${event.agent} walks to ${at(event.to)}`, "tertiary")].slice(-LOG_SIZE);
      return next;
    }

    case "start": {
      const task: TaskState = {
        id: event.task,
        agent: event.agent,
        kind: event.kind,
        building: event.building,
        title: event.title,
        command: event.command,
        startedAt: event.ts,
      };
      putAgent({ ...agent, location: event.building, from: undefined, status: "working", task, say: event.title });
      next.tasks = trimTasks({ ...state.tasks, [task.id]: task });
      const logged = withLog(state, entry(`${event.agent} started: ${event.title}`, "secondary", event.building));
      next.log = logged.log;
      next.buildings = setBuilding(logged.buildings, event.building, (b) => ({
        ...b,
        working: [...without(b.working, agent.name), agent.name],
      }));
      if (event.kind === "scan") next.crates = startScan(state.crates, event.seq, event.agent);
      next.headline = {
        title: event.title,
        subtitle: `${event.agent} at ${at(event.building)}`,
        command: event.command,
        explain: explainTask(event.kind, event.command),
        level: "active",
        agent: event.agent,
        building: event.building,
        seq: event.seq,
      };
      return next;
    }

    case "progress": {
      const task = state.tasks[event.task];
      if (!task) return next;
      const updated = { ...task, percent: event.percent ?? task.percent, message: event.message ?? task.message };
      next.tasks = { ...state.tasks, [task.id]: updated };
      putAgent({ ...agent, task: agent.task?.id === task.id ? updated : agent.task, say: event.message ?? agent.say });
      const pct = event.percent !== undefined ? ` (${event.percent}%)` : "";
      const logged = withLog(state, entry(`${event.agent}: ${event.message ?? "working"}${pct}`, "tertiary", task.building));
      next.log = logged.log;
      next.buildings = logged.buildings;
      // Keep the headline on the same task, with fresh details.
      if (state.headline.agent === event.agent && state.headline.level === "active") {
        next.headline = {
          ...state.headline,
          subtitle: `${event.agent} at ${at(task.building)} · ${event.message ?? "working"}${pct}`,
        };
      }
      return next;
    }

    case "done": {
      const task = state.tasks[event.task];
      const building = task?.building ?? agent.location;
      const keys = event.keys?.length
        ? ` (${summarizeKeys(event.keys, event.count)})`
        : event.sources?.length
          ? ` (${summarizeSources(event.sources)})`
          : "";
      const text = event.message ?? (task ? `${task.title}: done` : "Finished");
      putAgent({ ...agent, status: "idle", task: agent.task?.id === event.task ? undefined : agent.task, say: text });
      const { [event.task]: _finished, ...tasks } = state.tasks;
      next.tasks = tasks;
      const logged = withLog(state, entry(`${event.agent} done: ${text}${keys}`, "secondary", building));
      next.log = logged.log;
      // A success here fixes the earlier problem. At the harbor, a crate stopped at
      // the gate stays a problem until a scan passes (or it's replaced or sent).
      const stillStopped = building === "harbor" && task?.kind !== "scan" && state.crates.some((c) => c.status === "blocked");
      const fixed = logged.buildings[building].problem !== undefined && !stillStopped;
      next.buildings = setBuilding(logged.buildings, building, (b) => ({
        ...b,
        working: without(b.working, agent.name),
        problem: stillStopped ? b.problem : undefined,
      }));
      next.stats = { ...state.stats, done: state.stats.done + 1, fixed: state.stats.fixed + (fixed ? 1 : 0) };
      if (task?.kind === "scan") next.crates = setCrates(state.crates, ["scanning"], "cleared");
      next.health = computeHealth(next.buildings);
      next.headline = {
        title: fixed ? `Fixed: ${text}` : text,
        subtitle: `${event.agent} finished at ${at(building)}${keys}`,
        level: "calm",
        agent: event.agent,
        building,
        seq: event.seq,
      };
      return next;
    }

    case "fail": {
      const task = state.tasks[event.task];
      const building = task?.building ?? agent.location;
      putAgent({ ...agent, status: "failed", task: undefined, say: event.message });
      const { [event.task]: _failed, ...tasks } = state.tasks;
      next.tasks = tasks;
      const logged = withLog(state, entry(`${event.agent} problem: ${event.message}`, "primary", building));
      next.log = logged.log;
      next.buildings = setBuilding(logged.buildings, building, (b) => ({
        ...b,
        working: without(b.working, agent.name),
        problem: { agent: event.agent, message: event.message, seq: event.seq },
      }));
      next.stats = { ...state.stats, failed: state.stats.failed + 1 };
      if (task?.kind === "scan") next.crates = stopAtGate(state.crates);
      // The snapshot couldn't be saved, so the crate the gate packed for it is unpacked again.
      else if (task?.kind === "git" && task.command?.startsWith("git commit")) {
        next.crates = state.crates.filter((c) => !isPassedDraft(c));
      }
      next.health = computeHealth(next.buildings);
      next.headline = {
        title: `Problem: ${event.message}`,
        subtitle: `${event.agent} at ${at(building)} needs attention`,
        explain: task ? explainProblem(task.kind) : undefined,
        level: "attention",
        agent: event.agent,
        building,
        seq: event.seq,
      };
      return next;
    }

    case "commit": {
      const crate: Crate = {
        seq: event.seq,
        agent: event.agent,
        message: event.message,
        sha: event.sha,
        files: event.files,
        status: "packed",
      };
      next.crates = packCommit(state.crates, crate);
      putAgent({ ...agent, say: `Packed "${event.message}"` });
      const logged = withLog(
        state,
        entry(`${event.agent} saved a snapshot${event.sha ? ` ${event.sha}` : ""}: "${event.message}"`, "secondary", "harbor"),
      );
      next.log = logged.log;
      next.buildings = logged.buildings;
      next.stats = { ...state.stats, commits: state.stats.commits + 1 };
      next.headline = {
        title: `Snapshot saved: "${event.message}"`,
        subtitle: `${event.agent} packed it into a crate for the GitHub Harbor`,
        command: commitCommand(event.message),
        explain: explainCommand("git commit"),
        level: "active",
        agent: event.agent,
        building: "harbor",
        seq: event.seq,
      };
      return next;
    }

    case "push": {
      const n = event.commits ?? 1;
      const target = `${event.remote ?? "origin"}/${event.branch ?? "main"}`;
      // With no new commits, the push only published the branch.
      const what = n === 0 ? "the branch" : `${n} commit${n === 1 ? "" : "s"}`;
      const shipped = shipCrates(state.crates);
      next.crates = shipped.crates;
      next.lastPush = {
        remote: event.remote ?? "origin",
        branch: event.branch ?? "main",
        commits: n,
        crates: shipped.count,
        ts: event.ts,
      };
      putAgent({ ...agent, say: "Bon voyage!" });
      const logged = withLog(state, entry(`${event.agent} pushed ${what} to ${target}`, "secondary", "harbor"));
      next.log = logged.log;
      next.buildings = logged.buildings;
      next.stats = { ...state.stats, pushes: state.stats.pushes + 1 };
      next.headline = {
        title: `Sent to GitHub: ${what} to ${target}`,
        subtitle: `${event.agent}'s boat sails from the GITHUB HARBOR`,
        command: `git push ${event.remote ?? "origin"} ${event.branch ?? "main"}`,
        explain: explainCommand("git push"),
        level: "active",
        agent: event.agent,
        building: "harbor",
        seq: event.seq,
      };
      return next;
    }
  }
}

// --- The harbor: crates on their way to GitHub ----------------------------------------
//
// Real commands and the demo send events in different orders, and both must look right:
//   cli-village commit:  scan your changes → save the snapshot → (push: scan what's unsent → push)
//   the demo, agents:    save the snapshot → scan → push

function setCrates(crates: Crate[], from: CrateStatus[], to: CrateStatus): Crate[] {
  return crates.map((c) => (from.includes(c.status) ? { ...c, status: to } : c));
}

const onTheWay = (c: Crate) => c.status !== "shipped";
const isPassedDraft = (c: Crate) => c.draft === true && c.status === "cleared";

/**
 * The crates on their way to GitHub, as every view shows them. A draft that passed the
 * gate but got no snapshot stands for a check before a push: when saved snapshots are on
 * the way too, it's them, so it isn't counted twice.
 */
export function cratesOnTheWay(crates: readonly Crate[]): Crate[] {
  const list = crates.filter(onTheWay);
  return list.some((c) => !c.draft) ? list.filter((c) => !isPassedDraft(c)) : list;
}

/** A scan begins. Crates waiting for the gate are checked; with none, the gate packs what it checks. */
function startScan(crates: Crate[], seq: number, agent: string): Crate[] {
  if (crates.some((c) => c.status === "packed" || c.status === "blocked")) return setCrates(crates, ["packed", "blocked"], "scanning");
  // Your changes before a commit, or the snapshots before a push. Reuse a draft from an earlier check.
  const earlier = crates.findLastIndex(isPassedDraft);
  if (earlier >= 0) return crates.map((c, i) => (i === earlier ? { ...c, status: "scanning" } : c));
  const draft: Crate = { seq, agent, message: "Your changes", status: "scanning", draft: true };
  return [...crates, draft].slice(-MAX_CRATES);
}

/** The scan found something (or couldn't run): the gate stays shut. */
function stopAtGate(crates: Crate[]): Crate[] {
  return setCrates(crates, ["scanning"], "blocked");
}

/** A snapshot was saved: it fills the crate the gate packed for it, or gets a new crate. */
function packCommit(crates: Crate[], crate: Crate): Crate[] {
  const newest = crates.findLastIndex(onTheWay);
  if (newest >= 0 && isPassedDraft(crates[newest]!)) return crates.map((c, i) => (i === newest ? { ...crate, status: "cleared" } : c));
  // A new snapshot replaces any crate that was stopped at the gate.
  return [...crates.filter((c) => c.status !== "blocked"), crate].slice(-MAX_CRATES);
}

/**
 * The boat sails with the crates on the way. Left behind: changes the gate stopped (never
 * saved), and drafts that only stood for crates already sailing.
 */
function shipCrates(crates: Crate[]): { crates: Crate[]; count: number } {
  const sailing = new Set(cratesOnTheWay(crates).filter((c) => !(c.draft && (c.status === "blocked" || c.status === "scanning"))));
  const kept = crates.filter((c) => !onTheWay(c) || sailing.has(c));
  return { crates: kept.map((c) => (onTheWay(c) ? { ...c, status: "shipped" } : c)), count: sailing.size };
}

export interface HarborSummary {
  level: HeadlineLevel;
  /** What the icon stands for: a scan, a stop, crates waiting, or the boat that sailed. */
  icon: "scan" | "stop" | "crate" | "boat";
  text: string;
}

/** One line about the harbor for every view: what's at the gate, what's waiting, or the last boat. */
export function describeHarbor(state: VillageState): HarborSummary | null {
  const waiting = cratesOnTheWay(state.crates);
  const crates = (n: number) => `${n} crate${n === 1 ? "" : "s"}`;
  if (waiting.some((c) => c.status === "blocked")) {
    return { level: "attention", icon: "stop", text: "A crate is stopped at the gate" };
  }
  if (waiting.some((c) => c.status === "scanning")) {
    return { level: "active", icon: "scan", text: "At the gate: scanning for secrets…" };
  }
  // Packed: saved without a scan (--skip-scan, or an agent's commit). The next push scans it.
  const unscanned = waiting.filter((c) => c.status === "packed").length;
  if (unscanned && unscanned < waiting.length) {
    return { level: "calm", icon: "crate", text: `${crates(waiting.length)} waiting (${unscanned} not scanned yet)` };
  }
  if (unscanned) return { level: "calm", icon: "crate", text: `${crates(unscanned)} waiting, not scanned yet` };
  if (waiting.length) return { level: "calm", icon: "crate", text: `${crates(waiting.length)} at the dock, ready to push` };
  const last = state.lastPush;
  if (last) {
    const what = last.commits ? `${last.commits} commit${last.commits === 1 ? "" : "s"}` : "the branch";
    return { level: "calm", icon: "boat", text: `Last boat: ${what} to ${last.remote}/${last.branch}` };
  }
  return null;
}

function trimTasks(tasks: Record<string, TaskState>): Record<string, TaskState> {
  const ids = Object.keys(tasks);
  if (ids.length <= MAX_TASKS) return tasks;
  const keep = ids.slice(-MAX_TASKS);
  return Object.fromEntries(keep.map((id) => [id, tasks[id]!]));
}

/** The stream ended: the plaza darkens and every robot walks home. */
export function markStopped(state: VillageState): VillageState {
  return {
    ...state,
    stopped: true,
    headline: { title: "Stopped", subtitle: "Everyone is walking home.", level: "calm", seq: state.lastSeq },
  };
}

/** One line for the end of a session: "26 tasks done · 2 problems (2 fixed) · 3 snapshots · 2 pushes" */
export function summarize(state: VillageState): string {
  const { done, failed, fixed, commits, pushes } = state.stats;
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const problems = failed === 0 ? "no problems" : `${count(failed, "problem", "problems")} (${fixed} fixed)`;
  return [
    `${count(done, "task", "tasks")} done`,
    problems,
    count(commits, "snapshot", "snapshots"),
    count(pushes, "push", "pushes"),
  ].join(" · ");
}

/** True while a robot is still on its way somewhere. */
export function isWalking(agent: AgentState, now: number): boolean {
  return agent.status === "walking" && now - agent.movedAt < WALK_MS;
}

/** Problems that haven't been fixed yet, newest first. */
export function openProblems(state: VillageState): BuildingState[] {
  return Object.values(state.buildings)
    .filter((b) => b.problem)
    .sort((a, b) => (b.problem?.seq ?? 0) - (a.problem?.seq ?? 0));
}
