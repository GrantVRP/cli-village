// Everything drawn in HTML on top of the 3D scene: the top bar, the one key
// caption, building labels, speech bubbles, the side panel (robots and the
// log, or one building's log), help and key hints. The zones mirror the
// terminal view. Text from events is always set as plain text (never HTML).

import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import type * as THREE from "three";
import { EXPERT_FLAGS, GLOSSARY } from "../../src/events/explain.js";
import {
  describeHarbor,
  isWalking,
  type AgentState,
  type AgentStatus,
  type Headline,
  type HarborSummary,
  type LogEntry,
  type VillageState,
} from "../../src/events/state.js";
import { BUILDING_HELP, BUILDING_NAMES, type Building } from "../../src/events/types.js";

export type LabelMode = "idle" | "active" | "problem";
export type BubbleMode = "primary" | "secondary" | "hidden";

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const clock = (ts: number) => new Date(ts).toTimeString().slice(0, 8);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const ICONS = { start: "▶", move: "·", progress: "…", done: "✔", fail: "✖", commit: "■", push: "▲" } as const;
const HARBOR_ICONS: Record<HarborSummary["icon"], string> = { scan: "…", stop: "✖", crate: "■", boat: "▲" };
const ROBOT_ICONS: Record<AgentStatus, string> = { working: "▶", failed: "✖", walking: "·", idle: "○" };
/** Problems first, then robots at work, then the ones walking or resting (same as the terminal). */
const ROBOT_ORDER: Record<AgentStatus, number> = { failed: 0, working: 1, walking: 2, idle: 3 };
/** How many log lines the side panel keeps. */
const LOG_LINES = 60;
/** Below this width the side panel floats over the picture instead of beside it. */
const NARROW = 900;

export class Overlay {
  readonly labelRenderer = new CSS2DRenderer();
  private readonly labels = new Map<Building, { el: HTMLElement; icon: HTMLElement; mode: LabelMode }>();
  private readonly bubbles = new Map<string, { el: HTMLElement; text: HTMLElement; value: string; mode: BubbleMode }>();
  private panelBuilding: Building | null = null;
  private panelCovers = 0;
  private sideOpen = innerWidth > NARROW;
  private details = false;
  private state: VillageState | null = null;
  private captionKey = "";
  private captionTitle = "";

  constructor(root: HTMLElement) {
    this.labelRenderer.domElement.className = "labels";
    root.appendChild(this.labelRenderer.domElement);
    $("#help-close").addEventListener("click", () => this.toggleHelp(false));
    $("#panel-close").addEventListener("click", () => this.closePanel());
    $("#help-button").addEventListener("click", () => this.toggleHelp());
    $("#side-toggle").addEventListener("click", () => this.toggleSide());
    $("#details-toggle").addEventListener("click", () => this.toggleDetails());
    this.buildHelp();
    this.applySide();
    for (const list of [$("#activity-log"), $("#panel-log")]) this.followBottom(list);
    // "walking" wears off by the clock, not by an event, so the robots list ticks on its own.
    setInterval(() => this.state && this.renderRobots(this.state), 1000);
  }

  /**
   * A log follows its newest line until you scroll up, and follows again once you scroll
   * back down. Only your scrolling decides: the list getting shorter (because the robots
   * list above it grew) must not stop it following.
   */
  private followBottom(list: HTMLElement): void {
    list.dataset.follow = "1";
    list.addEventListener("scroll", () => {
      list.dataset.follow = list.scrollHeight - list.scrollTop - list.clientHeight < 24 ? "1" : "0";
    });
    new ResizeObserver(() => {
      if (list.dataset.follow === "1") list.scrollTop = list.scrollHeight;
    }).observe(list);
  }

  // --- Labels -------------------------------------------------------------------

  /** An UPPERCASE name tag floating above a building. Click it to see the building's log. */
  addLabel(id: Building, anchor: THREE.Object3D, onClick: (id: Building) => void): void {
    const node = el("button", "label idle") as HTMLButtonElement;
    node.type = "button";
    const icon = el("span", "label-icon");
    node.append(icon, el("span", "label-name", BUILDING_NAMES[id]));
    node.addEventListener("click", () => onClick(id));
    const obj = new CSS2DObject(node);
    anchor.add(obj);
    this.labels.set(id, { el: node, icon, mode: "idle" });
  }

  setLabel(id: Building, mode: LabelMode): void {
    const label = this.labels.get(id);
    if (!label || label.mode === mode) return;
    label.mode = mode;
    label.el.className = `label ${mode}`;
    // Never color alone: active and problem labels also get an icon.
    label.icon.textContent = mode === "problem" ? "✖ " : mode === "active" ? "▶ " : "";
  }

  // --- Speech bubbles ------------------------------------------------------------

  addBubble(name: string, anchor: THREE.Object3D): void {
    const node = el("div", "bubble hidden");
    const text = el("span", "bubble-text");
    node.append(el("b", "bubble-name", name), text);
    const obj = new CSS2DObject(node);
    obj.center.set(0.5, 1); // sit above the robot, not on top of it
    anchor.add(obj);
    this.bubbles.set(name, { el: node, text, value: "", mode: "hidden" });
  }

  setBubble(name: string, value: string, mode: BubbleMode, failed: boolean): void {
    const bubble = this.bubbles.get(name);
    if (!bubble) return;
    if (bubble.value !== value) {
      bubble.value = value;
      bubble.text.textContent = value;
    }
    const cls = `bubble ${mode}${failed ? " failed" : ""}`;
    if (bubble.el.className !== cls) bubble.el.className = cls;
    bubble.mode = mode;
  }

  // --- Top bar and caption -------------------------------------------------------

  setStatus(state: VillageState, mode: string): void {
    const agents = Object.values(state.agents);
    const working = agents.filter((a) => a.status === "working").length;
    const problems = Object.values(state.buildings).filter((b) => b.problem).length;
    $("#status-mode").textContent = `${mode}${state.stopped ? " · stopped" : ""}`;
    $("#status-robots").textContent = `${plural(agents.length, "robot")} · ${working} working`;
    const p = $("#status-problems");
    p.textContent = problems ? `✖ ${plural(problems, "problem")}` : "no problems";
    p.className = problems ? "stat problems bad" : "stat problems";
    const filled = Math.round(state.health * 5);
    const grade = state.health >= 0.8 ? "good" : state.health >= 0.5 ? "fair" : "poor";
    const meter = $("#status-health-bar");
    meter.className = `meter ${grade}`;
    meter.querySelectorAll("i").forEach((seg, i) => seg.classList.toggle("on", i < filled));
    $("#status-health-text").textContent = `${Math.round(state.health * 100)}% ${grade}`;
    document.body.classList.toggle("stopped", state.stopped);
  }

  /** The one key message, at the top. `suggestion`: the command is something to try, not one that ran. */
  setCaption(headline: Headline, suggestion = false): void {
    const subtitle = headline.subtitle ?? "";
    const command = headline.command ?? "";
    const explain = headline.explain ?? "";
    const key = [headline.level, headline.title, subtitle, command, explain, suggestion].join("|");
    if (key === this.captionKey) return;
    // Only a new message gets the little entrance animation, not small updates to the same one.
    const isNew = headline.title !== this.captionTitle;
    this.captionKey = key;
    this.captionTitle = headline.title;
    const caption = $("#caption");
    const icon = headline.level === "attention" ? "✖" : headline.level === "active" ? "▶" : headline.seq === 0 ? "○" : "✔";
    $("#caption-icon").textContent = icon;
    $("#caption-title").textContent = headline.title;
    $("#caption-subtitle").textContent = subtitle;
    $("#caption-command").hidden = !command;
    $("#caption-command-label").textContent = suggestion ? "Try" : "Real command";
    $("#caption-command-text").textContent = command;
    $("#caption-explain").textContent = explain;
    caption.className = `caption ${headline.level}`;
    if (isNew) {
      void caption.offsetWidth; // restart the animation
      caption.classList.add("pop");
    }
  }

  setConnection(message: string | null): void {
    const node = $("#connection");
    node.hidden = !message;
    node.textContent = message ?? "";
  }

  // --- Side panel: open, close, size ------------------------------------------------

  toggleSide(open?: boolean): void {
    this.sideOpen = open ?? !this.sideOpen;
    this.applySide();
  }

  get sideIsOpen(): boolean {
    return this.sideOpen;
  }

  private applySide(): void {
    $("#side").classList.toggle("closed", !this.sideOpen);
    $("#side-toggle").setAttribute("aria-pressed", String(this.sideOpen));
    this.measurePanel();
  }

  /** How much of the window's right side the open side panel covers, in pixels. */
  get panelInset(): number {
    return this.panelCovers;
  }

  /** Measured when the panel opens or closes, or the window changes size (not every frame). */
  measurePanel(): void {
    // On a narrow screen the panel floats over the picture, so there's no room to move the picture into.
    const covers = this.sideOpen && innerWidth > NARROW ? innerWidth - $("#side").getBoundingClientRect().left : 0;
    this.panelCovers = covers > 0 && covers < innerWidth * 0.45 ? covers : 0;
    document.documentElement.style.setProperty("--inset", `${this.panelCovers}px`);
  }

  // --- Side panel: a building's log ------------------------------------------------------

  openPanel(id: Building, state: VillageState): void {
    this.panelBuilding = id;
    $("#side-overview").hidden = true;
    $("#panel").hidden = false;
    this.toggleSide(true);
    this.updatePanel(state);
  }

  /** Back to all robots and the whole log. The panel stays open. */
  closePanel(): void {
    this.panelBuilding = null;
    $("#panel").hidden = true;
    $("#side-overview").hidden = false;
    if (this.state) this.updatePanel(this.state);
  }

  get openBuilding(): Building | null {
    return this.panelBuilding;
  }

  /** Redraws the side panel from the state: the robots and the log, or one building's log. */
  updatePanel(state: VillageState): void {
    this.state = state;
    if (this.panelBuilding) this.renderBuilding(state, this.panelBuilding);
    else {
      this.renderRobots(state);
      this.renderActivity(state);
    }
  }

  toggleDetails(): void {
    this.details = !this.details;
    const button = $("#details-toggle");
    button.textContent = this.details ? "all details" : "summary";
    button.setAttribute("aria-pressed", String(this.details));
    if (this.state) this.updatePanel(this.state);
  }

  private renderRobots(state: VillageState): void {
    const now = Date.now();
    const agents = Object.values(state.agents).sort(
      (a, b) => ROBOT_ORDER[a.status] - ROBOT_ORDER[b.status] || a.name.localeCompare(b.name),
    );
    $("#robots-count").textContent = agents.length ? String(agents.length) : "";
    $("#robots-list").replaceChildren(
      ...(agents.length ? agents.map((agent) => this.robotRow(agent, now)) : [el("li", "empty", "No robots yet.")]),
    );
    const harbor = describeHarbor(state);
    const line = $("#harbor-line");
    line.hidden = !harbor;
    if (harbor) {
      line.className = `harbor-line ${harbor.level}`;
      line.replaceChildren(el("span", "icon", HARBOR_ICONS[harbor.icon]), el("span", "name", "Harbor"), el("span", "text", harbor.text));
    }
  }

  private robotRow(agent: AgentState, now: number): HTMLElement {
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

  private renderActivity(state: VillageState): void {
    this.renderLog($("#activity-log"), state.log, "Nothing yet.");
  }

  private renderBuilding(state: VillageState, id: Building): void {
    const b = state.buildings[id];
    $("#panel-title").textContent = BUILDING_NAMES[id];
    $("#panel-help").textContent = BUILDING_HELP[id];
    const status = $("#panel-status");
    status.className = b.problem ? "panel-status bad" : "panel-status";
    status.textContent = b.problem
      ? `✖ Needs attention: ${b.problem.message}`
      : b.working.length
        ? `▶ Working here: ${b.working.join(", ")}`
        : "○ Quiet right now";
    // At the harbor: what's at the gate, what's waiting, or the last boat.
    const harbor = id === "harbor" ? describeHarbor(state) : null;
    const note = $("#panel-note");
    note.hidden = !harbor;
    note.className = `panel-note ${harbor?.level ?? ""}`;
    note.textContent = harbor ? `${HARBOR_ICONS[harbor.icon]} ${harbor.text}` : "";
    this.renderLog($("#panel-log"), b.log, "Nothing has happened here yet.");
  }

  /** Oldest at the top, newest at the bottom (like the terminal). Keeps following the bottom unless you scrolled up. */
  private renderLog(list: HTMLElement, log: LogEntry[], empty: string): void {
    const entries = (this.details ? log : log.filter((e) => e.emphasis !== "tertiary")).slice(-LOG_LINES);
    list.replaceChildren(...(entries.length ? entries.map((entry) => this.logItem(entry)) : [el("li", "empty", empty)]));
    if (list.dataset.follow !== "0") list.scrollTop = list.scrollHeight;
  }

  private logItem(entry: LogEntry): HTMLElement {
    const li = el("li", `${entry.emphasis} ${entry.type}`);
    li.append(el("time", undefined, clock(entry.ts)), el("span", "icon", ICONS[entry.type]), el("span", "text", entry.text));
    return li;
  }

  // --- Help ---------------------------------------------------------------------------

  toggleHelp(open?: boolean): void {
    const help = $("#help");
    help.hidden = open === undefined ? !help.hidden : !open;
  }

  get helpOpen(): boolean {
    return !$("#help").hidden;
  }

  private buildHelp(): void {
    const list = $("#help-buildings");
    const order: Building[] = ["vault", "library", "workshop", "lab", "townhall", "home", "harbor"];
    for (const id of order) {
      const row = el("div", "help-row");
      row.append(el("b", undefined, BUILDING_NAMES[id]), el("span", undefined, BUILDING_HELP[id]));
      list.append(row);
    }
    const words = $("#help-words");
    for (const { word, meaning } of GLOSSARY) {
      const row = el("div", "help-row");
      row.append(el("b", undefined, word), el("span", undefined, meaning));
      words.append(row);
    }
    $("#help-experts").textContent = `Fewer words? In the terminal, add ${EXPERT_FLAGS}.`;
  }
}
