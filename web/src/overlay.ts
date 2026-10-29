// Everything drawn in HTML on top of the 3D scene: status bar, the one key
// caption, building labels, speech bubbles, the building log panel, help
// and key hints. Text from events is always set as plain text (never HTML).

import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import type * as THREE from "three";
import { EXPERT_FLAGS, GLOSSARY } from "../../src/events/explain.js";
import type { Headline, LogEntry, VillageState } from "../../src/events/state.js";
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

export class Overlay {
  readonly labelRenderer = new CSS2DRenderer();
  private readonly labels = new Map<Building, { el: HTMLElement; icon: HTMLElement; mode: LabelMode }>();
  private readonly bubbles = new Map<string, { el: HTMLElement; text: HTMLElement; value: string; mode: BubbleMode }>();
  private panelBuilding: Building | null = null;
  private captionKey = "";
  private captionTitle = "";

  constructor(root: HTMLElement) {
    this.labelRenderer.domElement.className = "labels";
    root.appendChild(this.labelRenderer.domElement);
    $("#help-close").addEventListener("click", () => this.toggleHelp(false));
    $("#panel-close").addEventListener("click", () => this.closePanel());
    $("#help-button").addEventListener("click", () => this.toggleHelp());
    this.buildHelp();
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

  // --- Status bar and caption -------------------------------------------------------

  setStatus(state: VillageState, mode: string): void {
    const agents = Object.values(state.agents);
    const working = agents.filter((a) => a.status === "working").length;
    const problems = Object.values(state.buildings).filter((b) => b.problem).length;
    $("#status-mode").textContent = `${mode}${state.stopped ? " · stopped" : ""}`;
    $("#status-robots").textContent = `${plural(agents.length, "robot")} · ${working} working`;
    const p = $("#status-problems");
    p.textContent = problems ? `✖ ${plural(problems, "problem")}` : "no problems";
    p.className = problems ? "problems bad" : "problems";
    const filled = Math.round(state.health * 5);
    $("#status-health-bar").textContent = "■".repeat(filled) + "□".repeat(5 - filled);
    $("#status-health-bar").className = `bar ${state.health >= 0.8 ? "good" : state.health >= 0.5 ? "fair" : "poor"}`;
    $("#status-health-text").textContent = `${Math.round(state.health * 100)}% ${state.health >= 0.8 ? "good" : state.health >= 0.5 ? "fair" : "poor"}`;
    document.body.classList.toggle("stopped", state.stopped);
  }

  /** The one key message, at the top. */
  setCaption(headline: Headline): void {
    const subtitle = headline.subtitle ?? "";
    const command = headline.command ?? "";
    const explain = headline.explain ?? "";
    const key = [headline.level, headline.title, subtitle, command, explain].join("|");
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

  // --- Building panel ------------------------------------------------------------------

  openPanel(id: Building, state: VillageState): void {
    this.panelBuilding = id;
    $("#panel").hidden = false;
    this.updatePanel(state);
  }

  closePanel(): void {
    this.panelBuilding = null;
    $("#panel").hidden = true;
  }

  get openBuilding(): Building | null {
    return this.panelBuilding;
  }

  updatePanel(state: VillageState): void {
    const id = this.panelBuilding;
    if (!id) return;
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
    const list = $("#panel-log");
    list.replaceChildren(
      ...(b.log.length ? [...b.log].reverse().slice(0, 14).map((entry) => this.logItem(entry)) : [el("li", "empty", "Nothing has happened here yet.")]),
    );
  }

  private logItem(entry: LogEntry): HTMLElement {
    const li = el("li", entry.emphasis);
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
