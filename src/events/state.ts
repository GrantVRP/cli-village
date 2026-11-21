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
  /** From the demo's pretend robots: in a live village, the views mark it so it isn't taken for real work. */
  demo?: boolean;
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

/** Why the gate packed a crate itself, before there was a snapshot to pack. */
export type DraftKind = "changes" | "snapshots";

export interface Crate {
  seq: number;
  agent: string;
  message: string;
  sha?: string;
  files?: number;
  status: CrateStatus;
  /**
   * Packed by the gate itself. "changes": your changes, scanned before they're
   * saved (cli-village commit does this; the commit fills the crate in).
   * "snapshots": commits made outside CLI Village, scanned before a push.
   */
  draft?: DraftKind;
  /** The scan checking this crate right now (its task id). */
  scan?: string;
  /** What the gate found, while the crate is stopped there. */
  reason?: string;
  /** Redone (`git commit --amend`) after the gate stopped it: not fixed until a scan passes. */
  recheck?: true;
}

/** The last time the boat sailed. */
export interface LastPush {
  remote: string;
  branch: string;
  commits: number;
  /** How many crates it took (0 when the push only published the branch). */
  crates: number;
  ts: number;
  /** A pretend push, from the demo. */
  demo?: boolean;
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
  /** A crate the gate had stopped was sent anyway. The harbor says so until a scan passes. */
  harborWarning?: string;
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
    ...(event.source === "demo" ? { demo: true } : {}),
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
      if (event.kind === "scan") next.crates = startScan(state.crates, state.tasks, task, event.seq);
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
      if (task?.kind === "scan") {
        next.crates = finishScan(state.crates, task, null, event.seq);
        next.harborWarning = undefined; // a passing scan is the all-clear
      } else if (task?.kind === "git" && task.command === "git status" && event.count === 0) {
        // Nothing left to save: changes the gate had stopped were thrown away.
        next.crates = state.crates.filter((c) => !(c.draft === "changes" && c.status !== "scanning"));
      }
      // A success here fixes the earlier problem. At the harbor, a crate stopped at the
      // gate (or one redone or sent anyway since) stays the problem until a scan passes.
      const stillStopped = building === "harbor" ? harborTrouble(next) : undefined;
      const fixed = logged.buildings[building].problem !== undefined && !stillStopped;
      next.buildings = setBuilding(logged.buildings, building, (b) => ({
        ...b,
        working: without(b.working, agent.name),
        problem: stillStopped ? { agent: b.problem?.agent ?? event.agent, seq: b.problem?.seq ?? event.seq, message: stillStopped } : undefined,
      }));
      next.stats = { ...state.stats, done: state.stats.done + 1, fixed: state.stats.fixed + (fixed ? 1 : 0) };
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
      if (task?.kind === "scan") next.crates = finishScan(state.crates, task, event.message, event.seq);
      // The snapshot couldn't be saved, so the crate the gate packed for it is unpacked again.
      else if (task?.kind === "git" && task.command?.startsWith("git commit")) {
        next.crates = state.crates.filter((c) => !(c.draft === "changes" && c.status === "cleared"));
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
      // `git commit --amend` rewrites the newest snapshot instead of adding one.
      next.crates = packCommit(state.crates, crate, Boolean(agent.task?.command?.includes("--amend")));
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
      // A pretend push never hides your real last one.
      const pretend = event.source === "demo";
      if (!pretend || !state.lastPush || state.lastPush.demo) {
        next.lastPush = {
          remote: event.remote ?? "origin",
          branch: event.branch ?? "main",
          commits: n,
          crates: shipped.count,
          ts: event.ts,
          ...(pretend ? { demo: true } : {}),
        };
      }
      putAgent({ ...agent, say: "Bon voyage!" });
      const logged = withLog(state, entry(`${event.agent} pushed ${what} to ${target}`, shipped.flagged ? "primary" : "secondary", "harbor"));
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
      if (shipped.flagged) {
        // The gate had stopped one of these crates, and it was sent anyway (the scan was skipped).
        next.harborWarning = SENT_ANYWAY;
        next.buildings = setBuilding(next.buildings, "harbor", (b) => ({ ...b, problem: { agent: event.agent, message: SENT_ANYWAY, seq: event.seq } }));
        next.health = computeHealth(next.buildings);
        next.headline = { ...next.headline, title: `Sent to GitHub with a possible secret in it`, subtitle: SENT_ANYWAY, level: "attention" };
      }
      return next;
    }
  }
}

// --- The harbor: crates on their way to GitHub ----------------------------------------
//
// Real commands and the demo send events in different orders, and both must look right:
//   cli-village commit:  scan your changes → save the snapshot → (push: scan what's unsent → push)
//   the demo, agents:    save the snapshot → scan → push
// There are two kinds of scan. One checks your changes before they're saved
// (`infisical scan git-changes --staged`); the other checks the snapshots a push would
// send (`infisical scan --log-opts=…`). Each only moves the crates it checks.

const SENT_ANYWAY = "A crate the gate had stopped was sent anyway. Change that secret now: make a new one in Infisical.";

const onTheWay = (c: Crate) => c.status !== "shipped";
/** Your changes, packed by the gate: not a snapshot yet, so never part of a push. */
const isChanges = (c: Crate) => c.draft === "changes" && onTheWay(c);
/** Saved snapshots (or ones made outside CLI Village) that a push would send. */
const isSaved = (c: Crate) => c.draft !== "changes" && onTheWay(c);

/** What a scan checks, from its command. Without one: snapshots waiting at the gate, or else your changes. */
function scanScope(crates: readonly Crate[], command?: string): DraftKind {
  if (command && /\bgit-changes\b/.test(command)) return "changes";
  if (command && /\binfisical\s+scan\b|--log-opts/.test(command)) return "snapshots";
  return crates.some((c) => isSaved(c) && (c.status === "packed" || c.status === "blocked")) ? "snapshots" : "changes";
}

function startScan(crates: Crate[], running: Record<string, TaskState>, task: TaskState, seq: number): Crate[] {
  const mark = (c: Crate): Crate => ({ ...c, status: "scanning", scan: task.id, reason: undefined });
  // A crate still marked by a scan that's no longer running (it never finished) can be checked again.
  const waiting = (c: Crate) => c.status === "packed" || c.status === "blocked" || (c.status === "scanning" && !running[c.scan ?? ""]);
  if (scanScope(crates, task.command) === "changes") {
    const earlier = crates.findLastIndex((c) => isChanges(c) && (waiting(c) || c.status === "cleared"));
    if (earlier >= 0) return crates.map((c, i) => (i === earlier ? mark(c) : c));
    return [...crates, mark({ seq, agent: task.agent, message: "Your changes", status: "scanning", draft: "changes" })].slice(-MAX_CRATES);
  }
  // Before a push: every saved crate that hasn't passed the gate. Ones that passed wait at the dock.
  if (!crates.some(isSaved)) {
    return [...crates, mark({ seq, agent: task.agent, message: "Your snapshots", status: "scanning", draft: "snapshots" })].slice(-MAX_CRATES);
  }
  return crates.map((c) => (isSaved(c) && waiting(c) ? mark(c) : c));
}

/** A scan ended: what it checked passes the gate (`reason` null) or is stopped there. */
function finishScan(crates: Crate[], task: TaskState, reason: string | null, seq: number): Crate[] {
  const mine = (c: Crate) => c.scan === task.id && c.status === "scanning";
  if (reason === null) return crates.map((c) => (mine(c) ? { ...c, status: "cleared", scan: undefined, recheck: undefined } : c));
  if (crates.some(mine)) return crates.map((c) => (mine(c) ? { ...c, status: "blocked", scan: undefined, reason, recheck: undefined } : c));
  // A check before a push found something, but every crate here had passed: it's in
  // snapshots CLI Village didn't see being made.
  const outside = crates.findLastIndex((c) => c.draft === "snapshots" && onTheWay(c));
  if (outside >= 0) return crates.map((c, i) => (i === outside ? { ...c, status: "blocked", reason } : c));
  return [...crates, { seq, agent: task.agent, message: "Your snapshots", status: "blocked", draft: "snapshots", reason } satisfies Crate].slice(-MAX_CRATES);
}

/** A snapshot was saved: it fills the crate the gate packed for your changes, or gets a new crate. */
function packCommit(crates: Crate[], crate: Crate, amend: boolean): Crate[] {
  if (amend) {
    // The newest snapshot was rewritten: its crate gets the new one, to be checked again.
    // If the gate had stopped it, it isn't fixed until that check passes.
    const newest = crates.findLastIndex(isSaved);
    if (newest >= 0) {
      const old = crates[newest]!;
      const redone: Crate = old.status === "blocked" || old.recheck ? { ...crate, recheck: true } : crate;
      return crates.map((c, i) => (i === newest ? redone : c)).filter((c) => !(isChanges(c) && c.status !== "scanning"));
    }
  }
  const changes = crates.findLastIndex((c) => isChanges(c) && (c.status === "cleared" || c.status === "blocked"));
  if (changes >= 0) {
    // Changes the gate had stopped, saved anyway (--skip-scan), stay stopped: the secret is in the snapshot now.
    const { status, reason } = crates[changes]!;
    return crates.map((c, i) => (i === changes ? { ...crate, status, reason } : c));
  }
  return [...crates, crate].slice(-MAX_CRATES);
}

/**
 * The boat sails with every saved crate on the way (your unsaved changes stay behind).
 * `flagged`: one of them was stopped at the gate, and went anyway.
 */
function shipCrates(crates: Crate[]): { crates: Crate[]; count: number; flagged: boolean } {
  const sailing = crates.filter(isSaved);
  return {
    crates: crates.map((c) => (isSaved(c) ? { ...c, status: "shipped", scan: undefined } : c)),
    count: sailing.length,
    flagged: sailing.some((c) => c.status === "blocked" || c.recheck),
  };
}

const RECHECK = "The snapshot was redone. The next scan checks that the secret is gone.";

/** What still needs attention at the harbor: a crate stopped at the gate, one redone but not checked yet, or one that was sent anyway. */
function harborTrouble(state: Pick<VillageState, "crates" | "harborWarning">): string | undefined {
  const stopped = state.crates.findLast((c) => onTheWay(c) && c.status === "blocked");
  if (stopped) return stopped.reason ?? "A crate is stopped at the gate";
  if (state.crates.some((c) => onTheWay(c) && c.recheck)) return RECHECK;
  return state.harborWarning;
}

/** Where the crates are, for drawing the harbor. */
export interface HarborLoad {
  /** Crates that haven't passed the gate yet: being scanned, stopped, or not scanned. */
  atGate: number;
  /** Crates that passed, waiting at the dock for a push. */
  atDock: number;
  /** What the gate's lights show. */
  gate: "stopped" | "scanning" | "waiting" | "clear" | "idle";
}

export function harborLoad(state: Pick<VillageState, "crates" | "tasks">): HarborLoad {
  const waiting = state.crates.filter(onTheWay);
  const atGate = waiting.filter((c) => c.status !== "cleared");
  // A check before a push can run with every crate already past the gate.
  const scanning = atGate.some((c) => c.status === "scanning") || Object.values(state.tasks).some((t) => t.kind === "scan");
  const gate = atGate.some((c) => c.status === "blocked") ? "stopped" : scanning ? "scanning" : atGate.length ? "waiting" : waiting.length ? "clear" : "idle";
  return { atGate: atGate.length, atDock: waiting.length - atGate.length, gate };
}

export interface HarborSummary {
  level: HeadlineLevel;
  /** What the icon stands for: a scan, a stop, crates waiting, or the boat that sailed. */
  icon: "scan" | "stop" | "crate" | "boat";
  text: string;
}

/** One line about the harbor for every view: what's at the gate, what's waiting, or the last boat. */
export function describeHarbor(state: VillageState): HarborSummary | null {
  const load = harborLoad(state);
  const crates = (n: number) => `${n} crate${n === 1 ? "" : "s"}`;
  if (load.gate === "stopped") return { level: "attention", icon: "stop", text: "A crate is stopped at the gate" };
  if (load.gate === "scanning") return { level: "active", icon: "scan", text: "At the gate: scanning for secrets…" };
  if (state.harborWarning) return { level: "attention", icon: "stop", text: "A possible secret went to GitHub" };
  // Not scanned yet: saved with --skip-scan, or by an agent. The next push scans it.
  const total = load.atGate + load.atDock;
  if (load.atGate && load.atDock) return { level: "calm", icon: "crate", text: `${crates(total)} waiting (${load.atGate} not scanned yet)` };
  if (load.atGate) return { level: "calm", icon: "crate", text: `${crates(load.atGate)} waiting, not scanned yet` };
  if (load.atDock) return { level: "calm", icon: "crate", text: `${crates(load.atDock)} at the dock, ready to push` };
  const last = state.lastPush;
  if (last) {
    const what = last.commits ? `${last.commits} commit${last.commits === 1 ? "" : "s"}` : "the branch";
    return { level: "calm", icon: "boat", text: `Last boat${last.demo ? " (demo)" : ""}: ${what} to ${last.remote}/${last.branch}` };
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
