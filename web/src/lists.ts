// Small pieces of HTML both pages draw from the village state: a robot's row,
// the harbor line, a log line. The 3D page's side panel and the desktop app's
// side bar share them. Text from events is always set as plain text (never HTML).

import {
  describeHarbor,
  isWalking,
  type AgentState,
  type AgentStatus,
  type HarborSummary,
  type LogEntry,
  type VillageState,
} from "../../src/events/state.js";
import { BUILDING_NAMES } from "../../src/events/types.js";

export function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export const clock = (ts: number): string => new Date(ts).toTimeString().slice(0, 8);
export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

export const ICONS = { start: "▶", move: "·", progress: "…", done: "✔", fail: "✖", commit: "■", push: "▲" } as const;
export const HARBOR_ICONS: Record<HarborSummary["icon"], string> = { scan: "…", stop: "✖", crate: "■", boat: "▲" };
export const ROBOT_ICONS: Record<AgentStatus, string> = { working: "▶", failed: "✖", walking: "·", idle: "○" };
/** Problems first, then robots at work, then the ones walking or resting (same as the terminal). */
const ROBOT_ORDER: Record<AgentStatus, number> = { failed: 0, working: 1, walking: 2, idle: 3 };

export function sortedRobots(state: VillageState): AgentState[] {
  return Object.values(state.agents).sort((a, b) => ROBOT_ORDER[a.status] - ROBOT_ORDER[b.status] || a.name.localeCompare(b.name));
}

/** One robot: icon · name · place, and what it's doing underneath. */
export function robotRow(agent: AgentState, now: number): HTMLElement {
  const walking = isWalking(agent, now);
  const status: AgentStatus = walking ? "walking" : agent.status === "walking" ? "idle" : agent.status;
  const place = walking ? `→ ${BUILDING_NAMES[agent.location]}` : BUILDING_NAMES[agent.location];
  const activity =
    status === "failed"
      ? `problem: ${agent.task?.message ?? agent.say ?? "something went wrong"}`
      : status === "working"
        ? (agent.say ?? agent.task?.title ?? "working")
        : walking
          ? "walking"
          : agent.location === "home"
            ? "resting"
            : (agent.say ?? "idle");
  const li = el("li", status);
  li.append(el("span", "icon", ROBOT_ICONS[status]), el("span", "name", agent.name), el("span", "place", place), el("span", "activity", activity));
  li.title = `${agent.name} · ${place} · ${activity}`;
  return li;
}

/** Fills `node` with the harbor's one-line summary, or hides it when there's nothing to say. */
export function harborLine(node: HTMLElement, state: VillageState): void {
  const harbor = describeHarbor(state);
  node.hidden = !harbor;
  if (!harbor) return;
  node.className = `harbor-line ${harbor.level}`;
  node.replaceChildren(el("span", "icon", HARBOR_ICONS[harbor.icon]), el("span", "name", "Harbor"), el("span", "text", harbor.text));
}

export function logItem(entry: LogEntry): HTMLElement {
  const li = el("li", `${entry.emphasis} ${entry.type}`);
  const text = el("span", "text", entry.text);
  if (entry.demo) text.append(" ", el("span", "demo-tag", "demo"));
  li.append(el("time", undefined, clock(entry.ts)), el("span", "icon", ICONS[entry.type]), text);
  return li;
}

/** Oldest at the top, newest at the bottom (like the terminal). Keeps following the bottom unless you scrolled up. */
export function renderLog(list: HTMLElement, log: readonly LogEntry[], details: boolean, empty: string, lines = 60): void {
  const entries = (details ? log : log.filter((e) => e.emphasis !== "tertiary")).slice(-lines);
  list.replaceChildren(...(entries.length ? entries.map(logItem) : [el("li", "empty", empty)]));
  if (list.dataset.follow !== "0") list.scrollTop = list.scrollHeight;
}

/**
 * A log follows its newest line until you scroll up, and follows again once you scroll
 * back down. Only your scrolling decides: the list getting shorter (because something
 * above it grew) must not stop it following.
 */
export function followBottom(list: HTMLElement): void {
  list.dataset.follow = "1";
  list.addEventListener("scroll", () => {
    list.dataset.follow = list.scrollHeight - list.scrollTop - list.clientHeight < 24 ? "1" : "0";
  });
  new ResizeObserver(() => {
    if (list.dataset.follow === "1") list.scrollTop = list.scrollHeight;
  }).observe(list);
}
