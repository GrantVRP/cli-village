// The desktop app's window: a VS Code-like shell around the 3D village.
//
//   title bar: File Edit Selection View Go Run Terminal Help · command box · layout and window buttons
//   activity bar · side bar (robots, secrets, git, tests, research, agents, help)
//   editor: Welcome, the village, building logs as tabs · bottom panel: terminal, output, problems
//   secondary side bar: the Guide · status bar · command palette (Ctrl+Shift+P)
//
// It follows the same events as every other view, over the village server's
// WebSocket. Commands run in the real terminal at the bottom; the village reacts.
// The window's colours follow the village's light (day, dusk, night).
// Text from events is always set as plain text (never HTML).

import { EXPERT_FLAGS, GLOSSARY } from "../../src/events/explain.js";
import { describeHarbor, openProblems, type LogEntry, type VillageState } from "../../src/events/state.js";
import { BUILDING_HELP, BUILDING_NAMES, BUILDINGS, type Building } from "../../src/events/types.js";
import { connect } from "../../web/src/connection.js";
import { el, followBottom, HARBOR_ICONS, harborLine, plural, renderLog, robotRow, sortedRobots } from "../../web/src/lists.js";
import type { AppInfo } from "./bridge.js";
import { MenuBar, type Menu, type MenuEntry } from "./menu.js";
import { Palette, type Command } from "./palette.js";
import { createTerminal } from "./terminal.js";
import { CSS_NAMES, DUSK, shadeAt, type Shade } from "../../src/views/colors.js";
import "./style.css";

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const $$ = (selector: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(selector)];
const token = new URLSearchParams(location.search).get("token") ?? "";
const bridge = window.cliVillage;
const store = {
  get: (key: string) => localStorage.getItem(`cli-village.${key}`),
  set: (key: string, value: string) => localStorage.setItem(`cli-village.${key}`, value),
};

type View = "village" | "secrets" | "git" | "tests" | "research" | "agents" | "help";
const VIEW_TITLES: Record<View, string> = {
  village: "Village",
  secrets: "Secrets",
  git: "Git",
  tests: "Tests",
  research: "Research",
  agents: "Agents",
  help: "Help",
};
/** One line under each side bar title: what this tool is for. */
const VIEW_SUBS: Record<View, string> = {
  village: "Who is working where",
  secrets: "The Vault · key names and counts from Infisical, never values",
  git: "The Harbor · snapshots of your work, scanned for secrets first",
  tests: "The Lab · your project's tests",
  research: "The Library · what agents found online",
  agents: "The Town Hall · any program can be a robot here",
  help: "What am I looking at?",
};
/** The Guide's tip for each tool. */
const VIEW_TIPS: Record<View, string> = {
  village: "Click a building in the village, or in the list, and its log opens as a tab. Robots walk to the building for the kind of work they do.",
  secrets: "Fetch lists the key names in one environment. Compare shows which keys one environment has and the other lacks. Run starts a command with the secrets injected.",
  git: "A commit is a saved snapshot. Before it's saved, the gate at the harbor scans the change for passwords and keys. Push sends your snapshots to GitHub.",
  tests: "Run the tests picks npm test, cargo test, go test or pytest for you. A failing run shows up as a problem at the Lab.",
  research: "Agents report what they read with cli-village emit. The Library's log keeps it; nothing secret is sent anywhere.",
  agents: "Any program becomes a robot by sending start, progress, done and fail events. The demo plays pretend robots so you can see how it looks.",
  help: "The side bar explains the buildings, the words and the keys. The Guide on the right follows you around.",
};
const BUILDING_ORDER: Building[] = ["townhall", "vault", "library", "workshop", "lab", "harbor", "home"];

let info: AppInfo | null = null;
let state: VillageState | null = null;
let view: View = "village";
let details = false;
let findText = "";

// --- Colours: the window follows the village's light -----------------------------------------
//
// Day and night colours (src/views/colors.ts), mixed by how dark the village is (0..1).

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(" ");

let light = DUSK;
let lightPending: number | null = null;
function applyLight(k: number): void {
  light = k;
  const root = document.documentElement.style;
  const shade = shadeAt(k);
  for (const key of Object.keys(shade) as (keyof Shade)[]) {
    root.setProperty(`--${CSS_NAMES[key]}`, shade[key]);
    root.setProperty(`--${CSS_NAMES[key]}-rgb`, channels(shade[key]));
  }
  root.setProperty("--k", String(k));
  // The terminal sits on the work area, like the logs.
  terminal.setTheme({
    background: shade.bg3,
    foreground: shade.text,
    cursor: shade.accent,
    cursorAccent: shade.bg3,
    selectionBackground: `rgb(${channels(shade.accent)} / 0.3)`,
  });
  $("#status-light").textContent = `${k < 0.3 ? "☼ day" : k < 0.95 ? "◐ dusk" : "☾ night"}${lighting === "cycle" ? " · cycling" : ""}`;
}
/** The village reports its light many times a second while it changes; the colours update once a frame. */
function queueLight(k: number): void {
  if (lightPending === null) requestAnimationFrame(() => {
    const next = lightPending ?? light;
    lightPending = null;
    applyLight(next);
  });
  lightPending = k;
}

type Lighting = "day" | "dusk" | "night" | "cycle";
const LIGHTINGS: Lighting[] = ["day", "dusk", "night", "cycle"];
const LIGHT_LEVEL: Record<Exclude<Lighting, "cycle">, number> = { day: 0, dusk: DUSK, night: 1 };
const LIGHTING_LABELS: Record<Lighting, string> = { day: "Day", dusk: "Dusk", night: "Night", cycle: "Day and night, over and over (10 minutes)" };
let lighting: Lighting = LIGHTINGS.includes(store.get("lighting") as Lighting) ? (store.get("lighting") as Lighting) : "dusk";
function setLighting(mode: Lighting): void {
  lighting = mode;
  store.set("lighting", mode);
  if (mode === "cycle") tellVillage({ action: "cycle", seconds: 600 });
  else tellVillage({ action: "light", night: LIGHT_LEVEL[mode] });
  applyLight(light);
}

// How much the 3D village draws: "auto" lets it pick for this computer (and step down if
// it runs slow); the others fix a tier. Changing it reloads the village.
type Graphics = "auto" | "low" | "medium" | "high";
const GRAPHICS: Graphics[] = ["auto", "low", "medium", "high"];
const GRAPHICS_LABELS: Record<Graphics, string> = {
  auto: "Automatic (fits this computer)",
  low: "Low (fastest)",
  medium: "Medium (soft shadows, sky reflections)",
  high: "High (plus shading in corners, sharper shadows)",
};
let graphics: Graphics = GRAPHICS.includes(store.get("graphics") as Graphics) ? (store.get("graphics") as Graphics) : "auto";
function setGraphics(mode: Graphics): void {
  if (mode === graphics) return;
  graphics = mode;
  store.set("graphics", mode);
  frame.src = villageAddress();
}

// --- The village, in a frame ---------------------------------------------------------------

const frame = $<HTMLIFrameElement>("#village");
const villageAddress = () =>
  `/?token=${encodeURIComponent(token)}&embed=1&night=${lighting === "cycle" ? DUSK : LIGHT_LEVEL[lighting]}${graphics === "auto" ? "" : `&quality=${graphics}`}`;
frame.src = villageAddress();
frame.addEventListener("load", () => {
  setLighting(lighting);
  tellVillage({ action: "visible", visible: activeTab === "village" });
});
const tellVillage = (message: Record<string, unknown>) => frame.contentWindow?.postMessage({ type: "cli-village", ...message }, location.origin);
const focusBuilding = (id: Building) => {
  showTab("village");
  tellVillage({ action: "focus", building: id });
};
addEventListener("message", (e: MessageEvent<{ type?: string; action?: string; building?: string; night?: number }>) => {
  if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
  const m = e.data;
  if (m?.type !== "cli-village") return;
  if (m.action === "selected" && (BUILDINGS as readonly string[]).includes(m.building ?? "")) openTab(m.building as Building);
  else if (m.action === "light" && typeof m.night === "number") queueLight(Math.min(1, Math.max(0, m.night)));
});

// --- Editor tabs: Welcome, the village, and any building's log ------------------------------

type Tab = "village" | "welcome" | Building;
const TAB_NAMES: Record<Tab, string> = { village: "Village", welcome: "Welcome", ...BUILDING_NAMES };
let openTabs: Tab[] = [];
let activeTab: Tab = "village";
/** Where you've been, for Back and Forward. */
const visited: Tab[] = ["village"];
let visitedAt = 0;
const docLog = el("ol", "log");
followBottom(docLog);
const docStatus = el("p", "doc-status");
const docNote = el("p", "doc-note");
/** Which building's log the page shows now. */
let docFor: Building | null = null;

function showTab(id: Tab, remember = true): void {
  if (id !== "village" && !openTabs.includes(id)) openTabs = [...openTabs, id];
  activeTab = id;
  if (remember && visited[visitedAt] !== id) {
    visited.splice(visitedAt + 1);
    visited.push(id);
    visitedAt = visited.length - 1;
  }
  renderTabs();
  renderDoc();
}
const openTab = (id: Tab) => showTab(id);

function closeTab(id: Tab): void {
  openTabs = openTabs.filter((b) => b !== id);
  if (activeTab === id) showTab(openTabs.at(-1) ?? "village");
  else renderTabs();
}
const closableTab = () => (activeTab === "village" ? null : activeTab);

function goBack(): void {
  if (visitedAt > 0) showTab(visited[--visitedAt]!, false);
}
function goForward(): void {
  if (visitedAt < visited.length - 1) showTab(visited[++visitedAt]!, false);
}
function nextTab(step: 1 | -1): void {
  const all: Tab[] = ["village", ...openTabs];
  const at = all.indexOf(activeTab);
  showTab(all[(at + step + all.length) % all.length]!);
}

/** Each open tab's element, kept while the tab is open. */
const tabElements = new Map<Tab, HTMLElement>();
let tabOrder = "";
function makeTab(id: Tab): HTMLElement {
  const tab = el("div", "tab");
  tab.setAttribute("role", "tab");
  const name = el("button", "tab-name", TAB_NAMES[id]);
  name.addEventListener("click", () => showTab(id));
  name.addEventListener("auxclick", (e) => e.button === 1 && id !== "village" && closeTab(id));
  tab.append(name);
  if (id !== "village") {
    const close = el("button", "tab-close", "×");
    close.title = "Close (Ctrl+W)";
    close.addEventListener("click", () => closeTab(id));
    tab.append(close);
  }
  tabElements.set(id, tab);
  return tab;
}

function renderTabs(): void {
  // Every robot's step calls this, so the tabs are only changed, not built again: a tab built
  // again between pressing and releasing the mouse loses the click (in a busy village, often).
  const ids: Tab[] = ["village", ...openTabs];
  if (ids.join("|") !== tabOrder) {
    tabOrder = ids.join("|");
    for (const id of tabElements.keys()) if (!ids.includes(id)) tabElements.delete(id);
    $("#tabs").replaceChildren(...ids.map((id) => tabElements.get(id) ?? makeTab(id)));
  }
  for (const id of ids) {
    const b = id !== "village" && id !== "welcome" && state ? state.buildings[id] : null;
    const look = b?.problem ? " problem" : b?.working.length ? " active" : "";
    const name = `tab${activeTab === id ? " on" : ""}${look}`;
    const tab = tabElements.get(id)!;
    if (tab.className !== name) tab.className = name;
  }
  $<HTMLButtonElement>("#nav-back").disabled = visitedAt <= 0;
  $<HTMLButtonElement>("#nav-forward").disabled = visitedAt >= visited.length - 1;
}

function renderDoc(): void {
  const doc = $("#doc");
  const welcome = $("#welcome");
  const hide = activeTab !== "village";
  // Behind another tab the village keeps up with events but stops drawing (saves the graphics card).
  if (hide !== frame.classList.contains("hidden")) tellVillage({ action: "visible", visible: !hide });
  frame.classList.toggle("hidden", hide);
  welcome.hidden = activeTab !== "welcome";
  doc.hidden = activeTab === "village" || activeTab === "welcome";
  $("#findbar").hidden = !findOpen;
  if (activeTab === "village" || activeTab === "welcome" || !state) return;
  const id = activeTab;
  const b = state.buildings[id];
  // Every robot's step calls this: build the page only when another building's log opens, then
  // only change it. A button built again between pressing and releasing the mouse loses the click.
  if (docFor !== id) {
    docFor = id;
    const head = el("div", "doc-head");
    head.append(el("h2", "doc-title", BUILDING_NAMES[id]), button("Show in the village", () => focusBuilding(id)));
    doc.replaceChildren(head, el("p", "doc-help", BUILDING_HELP[id]), docStatus, docNote, docLog);
  }
  docStatus.className = b.problem ? "doc-status bad" : "doc-status";
  docStatus.textContent = b.problem
    ? `✖ Needs attention: ${b.problem.message}`
    : b.working.length
      ? `▶ Working here: ${b.working.join(", ")}`
      : "○ Quiet right now";
  const harbor = id === "harbor" ? describeHarbor(state) : null;
  docNote.style.display = harbor ? "" : "none";
  if (harbor) {
    docNote.className = `doc-note ${harbor.level}`;
    docNote.textContent = `${HARBOR_ICONS[harbor.icon]} ${harbor.text}`;
  }
  renderLog(docLog, found(b.log), details, findText ? "Nothing in this log matches." : "Nothing has happened here yet.", 120);
}

// --- Small pieces --------------------------------------------------------------------------------

function button(label: string, onClick: () => void, kind: "" | "primary" | "ghost" = ""): HTMLButtonElement {
  const b = el("button", `button ${kind}`.trim(), label) as HTMLButtonElement;
  b.addEventListener("click", onClick);
  return b;
}
function section(title: string, hint: string | null, ...children: HTMLElement[]): HTMLElement {
  const s = el("section", "sb-section");
  s.append(el("h3", "sb-title", title));
  if (hint) s.append(el("p", "sb-hint", hint));
  s.append(...children);
  return s;
}
const note = (text: string) => el("p", "sb-note", text);
function row(...children: HTMLElement[]): HTMLElement {
  const r = el("div", "sb-row");
  r.append(...children);
  return r;
}
function input(id: string, placeholder: string, value = ""): HTMLInputElement {
  const i = el("input", "input") as HTMLInputElement;
  i.id = id;
  i.placeholder = placeholder;
  i.value = value;
  i.spellcheck = false;
  return i;
}
const valueOf = (id: string) => (document.querySelector(`#${id}`) as HTMLInputElement | null)?.value.trim() ?? "";
interface Step {
  title: string;
  text: string;
  done?: boolean;
  action?: HTMLElement;
}
/**
 * Numbered steps, in order: the clearest way to say "do this, then this". When the steps say
 * which are done, the first one that isn't is "next": its number and its button are the only
 * gold in the list, so there's one obvious thing to do.
 */
function steps(list: Step[]): HTMLElement {
  const ol = el("ol", "steps");
  const tracked = list.some((s) => s.done !== undefined);
  const next = tracked ? list.findIndex((s) => !s.done) : -1;
  list.forEach((s, i) => {
    const li = el("li", s.done ? "step done" : i === next ? "step next" : "step");
    if (tracked && s.action instanceof HTMLButtonElement) {
      s.action.classList.toggle("primary", i === next);
      s.action.classList.toggle("ghost", i !== next);
    }
    li.append(el("span", "step-n", s.done ? "✓" : String(i + 1)), el("b", "step-title", s.title), el("span", "step-text", s.text));
    if (s.action) {
      s.action.classList.add("step-action");
      li.append(s.action);
    }
    ol.append(li);
  });
  return ol;
}
function rows(pairs: [string, string][], mono = false): HTMLElement {
  const box = el("div", "help-rows");
  for (const [k, v] of pairs) {
    const r = el("div", "help-row");
    r.append(el("b", mono ? "mono" : undefined, k), el("span", undefined, v));
    box.append(r);
  }
  return box;
}
function fold(title: string, open: boolean, ...children: HTMLElement[]): HTMLElement {
  const d = el("details", "fold") as HTMLDetailsElement;
  d.open = open;
  d.append(el("summary", "sb-title", title), ...children);
  return d;
}
const found = (log: readonly LogEntry[]) => (findText ? log.filter((e) => e.text.toLowerCase().includes(findText)) : log);

// --- Side bar -------------------------------------------------------------------------------------

/** Built once per view (so typed values survive), then filled from the state. */
function buildSidebar(): void {
  $("#sidebar-title").textContent = VIEW_TITLES[view];
  $("#sidebar-sub").textContent = VIEW_SUBS[view];
  $$(".activity-item").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
  const body = $("#sidebar-body");
  const parts: HTMLElement[] = [];
  const log = (building: Building) => {
    const list = el("ol", "log");
    list.id = "sb-log";
    list.dataset.building = building;
    followBottom(list);
    return section(`${BUILDING_NAMES[building]} log`, null, list);
  };
  const installed = info ? info.infisical !== "not installed" : null;
  const linked = info?.infisical === "linked";

  if (view === "village") {
    const robots = el("ul", "robots");
    robots.id = "sb-robots";
    const harbor = el("div", "harbor-line");
    harbor.id = "sb-harbor";
    const buildings = el("div", "buildings");
    for (const id of BUILDING_ORDER) {
      const b = el("button", "building-row");
      b.dataset.building = id;
      b.append(el("span", "icon", "○"), el("b", undefined, BUILDING_NAMES[id]), el("span", "help", BUILDING_HELP[id]));
      b.addEventListener("click", () => {
        openTab(id);
        tellVillage({ action: "focus", building: id });
      });
      buildings.append(b);
    }
    parts.push(section("Robots", "Each robot is an agent: a helper program at work.", robots, harbor), section("Buildings", "Click one: its log opens as a tab.", buildings));
  } else if (view === "secrets") {
    if (!linked) {
      parts.push(
        section(
          "Start here",
          "Three steps, once per project.",
          steps([
            {
              title: "Install the Infisical CLI",
              text: installed === false ? "Not installed yet. Doctor prints the command for your computer." : installed ? "Installed." : "Checking…",
              done: installed === true,
              action: button("Check my tools (doctor)", () => runCli("doctor"), installed ? "ghost" : "primary"),
            },
            {
              title: "Log in to Infisical",
              text: "Opens your browser once; the CLI remembers you.",
              action: button("infisical login", () => shellRun("infisical login"), "ghost"),
            },
            {
              title: "Link this folder to a project",
              text: info?.infisical === "not linked" ? "Not linked yet: pick your project and it writes a small .infisical.yaml file." : "Pick your project; it writes a small .infisical.yaml file.",
              done: linked,
              action: button("infisical init", () => shellRun("infisical init"), installed ? "primary" : "ghost"),
            },
          ]),
        ),
      );
    }
    parts.push(
      section(
        "Secrets",
        "Key names and counts only. Values never appear here, in the terminal or in the village.",
        row(input("sb-env", "environment, like dev", "dev"), button("Fetch key names", () => runCli(`secrets fetch${envFlag(valueOf("sb-env"))}`), "primary")),
        row(input("sb-env2", "compare with, like prod", "prod"), button("Compare", () => runCli(`secrets diff ${valueOf("sb-env") || "dev"} ${valueOf("sb-env2") || "prod"}`))),
        row(input("sb-run", "a command to run with secrets, like npm start"), button("Run", () => valueOf("sb-run") && runCli(`run${envFlag(valueOf("sb-env"))} -- ${valueOf("sb-run")}`))),
      ),
      log("vault"),
    );
  } else if (view === "git") {
    const push = el("label", "sb-check");
    const check = el("input") as HTMLInputElement;
    check.type = "checkbox";
    check.id = "sb-push";
    push.append(check, el("span", undefined, "then push"));
    parts.push(
      section(
        "Snapshots",
        "A commit is a saved snapshot of your work. The gate at the harbor scans it for passwords and keys first.",
        steps([
          { title: "See what changed", text: "Since your last snapshot.", action: button("What changed?", () => runCli("status"), "ghost") },
          { title: "Save a snapshot", text: "With a short note about the change.", action: row(input("sb-message", "a short note about what changed"), button("Commit", () => commit(valueOf("sb-message"), check.checked), "primary")) },
          { title: "Send it to GitHub", text: "Push sends every saved snapshot.", action: row(push, button("Push", () => runCli("push"), "ghost")) },
        ]),
      ),
      section("Harbor", null, (() => {
        const h = el("div", "harbor-line");
        h.id = "sb-harbor";
        return h;
      })(), (() => {
        // Shown instead of the harbor line while nothing is at the harbor.
        const quiet = el("p", "sb-hint", "Nothing at the harbor yet. Commit, and your snapshot rides down here as a crate.");
        quiet.id = "sb-harbor-quiet";
        return quiet;
      })()),
      log("harbor"),
    );
  } else if (view === "tests") {
    parts.push(
      section(
        "Tests",
        "Runs your project's tests (npm test, cargo test, go test or pytest). Your robot carries the result to the Lab.",
        row(button("Run the tests", () => runCli("test"), "primary")),
        row(input("sb-test", "or your own command, like npm run test:unit"), button("Run this", () => valueOf("sb-test") && runCli(`test -- ${valueOf("sb-test")}`))),
      ),
      log("lab"),
    );
  } else if (view === "research") {
    parts.push(
      section(
        "Research",
        "Research gathered from the internet shows up at the Library. AI agents report it with cli-village emit; nothing secret is ever sent anywhere.",
        el("pre", "sb-code", `${CLI} emit '{"type":"start","agent":"my-agent","task":"r1","kind":"research","title":"Reading the docs"}'`),
      ),
      log("library"),
    );
  } else if (view === "agents") {
    parts.push(
      section(
        "External agents",
        "Any program can be a robot here. It sends events (start, progress, done, fail) with cli-village emit, or writes the same JSON lines to the local socket.",
        el("pre", "sb-code", `${CLI} emit '{"type":"start","agent":"my-agent","task":"c1","kind":"code","title":"Editing src/app.ts"}'\n${CLI} emit '{"type":"done","agent":"my-agent","task":"c1"}'`),
        row(button("Play the demo (one round)", () => void bridge.playDemo(), "primary"), button("Every event type", () => runCli("emit --help"), "ghost")),
      ),
      log("townhall"),
    );
  } else {
    parts.push(
      fold(
        "Start here",
        true,
        note("Each robot is an agent (a helper program). When it starts a task, it walks to the building for that kind of work. The glowing column in the plaza shows how healthy the village is."),
        steps([
          { title: "Check your tools", text: "Doctor says what's installed and what's missing.", action: button("Run doctor", () => runCli("doctor"), "primary") },
          { title: "Watch a workday", text: "Pretend robots act one out. Nothing real runs.", action: button("Play the demo", () => void bridge.playDemo(), "ghost") },
          { title: "Then use the tools", text: "Secrets, Git and Tests, in the bar on the left.", action: button("Open Secrets", () => showView("secrets"), "ghost") },
        ]),
      ),
      fold("Buildings", false, rows(BUILDING_ORDER.map((id) => [BUILDING_NAMES[id], BUILDING_HELP[id]]), true)),
      fold(
        "Keys",
        false,
        rows(
          [
            ["Ctrl+Shift+P", "every command"],
            ["Ctrl+J", "show or hide the bottom panel"],
            ["Ctrl+B", "show or hide the side bar"],
            ["Ctrl+Alt+B", "show or hide the Guide"],
            ["Ctrl+W", "close the tab"],
            ["Alt+← →", "back and forward"],
            ["Ctrl+F", "find in a log"],
            ["Alt", "the menus"],
            ["click", "a building: its log opens as a tab"],
            ["drag · scroll", "look around the village, zoom"],
            ["n · h", "in the village: night or day, back to the whole village"],
          ],
          true,
        ),
      ),
      fold("Words you'll see", false, rows(GLOSSARY.map(({ word, meaning }) => [word, meaning]))),
      fold("Safe by design", false, note("Secret values never appear here: only key names and counts. The village only listens on this computer, behind a one-time link.")),
      fold("For experts", false, note(`In the terminal, add ${EXPERT_FLAGS}.`)),
    );
  }
  body.replaceChildren(...parts);
  if (state) updateSidebar(state);
}

function updateSidebar(s: VillageState): void {
  const robots = document.querySelector<HTMLElement>("#sb-robots");
  if (robots) {
    const now = Date.now();
    const agents = sortedRobots(s);
    robots.replaceChildren(...(agents.length ? agents.map((a) => robotRow(a, now)) : [el("li", "empty", "No robots yet. Run a command in the terminal, or play the demo.")]));
  }
  const harbor = document.querySelector<HTMLElement>("#sb-harbor");
  if (harbor) harborLine(harbor, s);
  const quiet = document.querySelector<HTMLElement>("#sb-harbor-quiet");
  if (quiet && harbor) quiet.hidden = !harbor.hidden;
  document.querySelectorAll<HTMLElement>(".building-row").forEach((b) => {
    const id = b.dataset.building as Building;
    const st = s.buildings[id];
    b.className = `building-row ${st.problem ? "problem" : st.working.length ? "active" : "idle"}`;
    b.querySelector(".icon")!.textContent = st.problem ? "✖" : st.working.length ? "▶" : "○";
  });
  const log = document.querySelector<HTMLElement>("#sb-log");
  if (log) renderLog(log, s.buildings[log.dataset.building as Building].log, details, "Nothing has happened here yet.");
}

function showView(next: View): void {
  view = next;
  setPart("sidebar", true);
  buildSidebar();
  renderGuide();
}
$$(".activity-item[data-view]").forEach((b) =>
  b.addEventListener("click", () => {
    const next = b.dataset.view as View;
    if (next === view && layout.sidebar) setPart("sidebar", false);
    else showView(next);
  }),
);

// --- The Guide (secondary side bar) ------------------------------------------------------------------

let guideKey = "";
function renderGuide(): void {
  const agents = state ? Object.keys(state.agents).length : 0;
  const key = `${view}|${info?.infisical}|${info?.branch}|${agents}|${info?.hub.role}|${info?.project}`;
  if (key === guideKey) return;
  guideKey = key;
  const installed = info ? info.infisical !== "not installed" : null;
  const linked = info?.infisical === "linked";
  markWelcomeNext([installed === true, linked, agents > 0]);
  const body = $("#guide-body");
  body.replaceChildren(
    section(
      "Start here",
      "What a new village needs, in order.",
      steps([
        // Started from a shortcut, the installed app opens in your home folder: no project yet.
        ...(info && !info.project
          ? [
              {
                title: "Open your project",
                text: "The folder with your code. Its village opens in this window.",
                done: false,
                action: button("Open Folder", () => void openFolder(), "primary"),
              },
            ]
          : []),
        {
          title: "Check your tools",
          text: installed === null ? "Checking…" : installed ? "Infisical CLI found." : "The Infisical CLI isn't installed. Doctor prints the fix.",
          done: installed === true,
          action: button("Run doctor", () => runCli("doctor"), installed ? "ghost" : "primary"),
        },
        {
          title: "Link your secrets",
          text: linked ? "This folder is linked to an Infisical project." : "Log in, then link this folder to a project.",
          done: linked,
          action: button("Open Secrets", () => showView("secrets"), linked || !installed ? "ghost" : "primary"),
        },
        {
          title: "Watch it work",
          text: agents ? `${plural(agents, "robot")} ${agents === 1 ? "has" : "have"} been here.` : "Play the demo, or run any command in the terminal.",
          done: agents > 0,
          action: button("Play the demo", () => void bridge.playDemo(), agents ? "ghost" : "primary"),
        },
        {
          title: "Save your work",
          text: info?.branch
            ? `On branch ${info.branch}. Commit at the Harbor.`
            : !info
              ? "Checking…"
              : info.project
                ? "Not a git project yet (git init in the terminal)."
                : "Open a project first.",
          done: Boolean(info?.branch),
          action: button("Open Git", () => showView("git"), "ghost"),
        },
      ]),
    ),
    section(`In ${VIEW_TITLES[view]}`, null, note(VIEW_TIPS[view])),
    section(
      "Keys",
      null,
      rows(
        [
          ["Ctrl+Shift+P", "every command"],
          ["Ctrl+J", "the terminal"],
          ["Ctrl+B", "the side bar"],
          ["Alt", "the menus"],
        ],
        true,
      ),
    ),
  );
}
$("#guide-close").addEventListener("click", () => setPart("guide", false));

// --- Welcome ------------------------------------------------------------------------------------------

/** Make the first Welcome card that isn't done the gold one (as in the Guide's steps). */
function markWelcomeNext(done: boolean[]): void {
  const next = done.findIndex((d) => !d);
  for (const card of document.querySelectorAll<HTMLElement>("#welcome .card")) {
    const isNext = Number(card.dataset.step) - 1 === next;
    card.classList.toggle("next", isNext);
    const action = card.querySelector(".button");
    action?.classList.toggle("primary", isNext);
    action?.classList.toggle("ghost", !isNext);
  }
}

function renderWelcome(): void {
  const page = $("#welcome");
  const head = el("header", "welcome-head");
  head.append(el("h1", "welcome-title", "CLI Village"), el("p", "welcome-sub", "Watch your agents work in a tiny village. Secrets stay in Infisical; the harbor gate scans your commits."));
  const start = el("section", "welcome-section");
  start.append(el("h2", "sb-title", "Start here"));
  const cards = el("div", "cards");
  const card = (n: string, title: string, text: string, action: HTMLElement) => {
    const c = el("div", "card");
    c.dataset.step = n;
    c.append(el("span", "step-n", n), el("h3", undefined, title), el("p", undefined, text), action);
    return c;
  };
  cards.append(
    card("1", "Check your tools", "Doctor looks for git, Node and the Infisical CLI, and prints the fix for anything missing.", button("Run doctor", () => runCli("doctor"), "ghost")),
    card("2", "Link your secrets", "Log in to Infisical, then link this folder to a project. Only key names ever show here.", button("Open Secrets", () => showView("secrets"), "ghost")),
    card("3", "Watch a workday", "Pretend robots act one out: research, code, tests, a commit. Nothing real runs.", button("Play the demo", () => void bridge.playDemo(), "ghost")),
  );
  start.append(cards);
  const then = el("section", "welcome-section");
  then.append(el("h2", "sb-title", "Then, day to day"));
  then.append(
    rows([
      ["Secrets", "fetch key names, compare environments, run a command with secrets"],
      ["Git", "see what changed, save a snapshot (commit), push to GitHub"],
      ["Tests", "run your project's tests; failures show up as problems"],
      ["Agents", "let your own programs and AI agents appear as robots"],
    ]),
  );
  const keys = el("section", "welcome-section");
  keys.append(el("h2", "sb-title", "Keys"));
  keys.append(
    rows(
      [
        ["Ctrl+Shift+P", "every command, by name"],
        ["Ctrl+J", "show or hide the terminal"],
        ["Ctrl+B · Ctrl+Alt+B", "the side bar · the Guide"],
        ["Alt", "the menus"],
      ],
      true,
    ),
  );
  const foot = el("footer", "welcome-foot");
  const show = el("label", "sb-check");
  const check = el("input") as HTMLInputElement;
  check.type = "checkbox";
  check.checked = store.get("welcome") !== "0";
  check.addEventListener("change", () => store.set("welcome", check.checked ? "1" : "0"));
  show.append(check, el("span", undefined, "Show Welcome when the app starts"));
  foot.append(show, button("Open the Guide", () => setPart("guide", true), "ghost"));
  page.replaceChildren(head, start, then, keys, foot);
}

// --- Layout: which parts are showing ----------------------------------------------------------------

type Part = "sidebar" | "guide" | "panel" | "statusbar";
const PART_LABELS: Record<Part, string> = { sidebar: "Primary Side Bar", guide: "Secondary Side Bar (the Guide)", panel: "Panel", statusbar: "Status Bar" };
const layout: Record<Part, boolean> = { sidebar: true, guide: true, panel: true, statusbar: true };
try {
  Object.assign(layout, JSON.parse(store.get("layout") ?? "{}"));
} catch {
  /* a fresh layout, then */
}
function setPart(part: Part, on: boolean): void {
  layout[part] = on;
  store.set("layout", JSON.stringify(layout));
  document.body.classList.toggle(`no-${part}`, !on);
  $$(".tb-icon[data-layout]").forEach((b) => b.classList.toggle("on", layout[b.dataset.layout as Part]));
  if (part === "panel" && on) showPanel();
  terminal.fit();
}
const togglePart = (part: Part) => setPart(part, !layout[part]);
function resetLayout(): void {
  for (const part of Object.keys(layout) as Part[]) setPart(part, true);
  document.body.classList.remove("panel-max");
  document.documentElement.style.removeProperty("--panel");
  terminal.fit();
}
$$(".tb-icon[data-layout]").forEach((b) => b.addEventListener("click", () => togglePart(b.dataset.layout as Part)));

const layoutMenu = $("#layout-menu");
function openLayoutMenu(): void {
  const box = el("div", "layout-box");
  box.append(el("h3", "sb-title", "Customize Layout"));
  for (const part of Object.keys(layout) as Part[]) {
    const label = el("label", "sb-check");
    const check = el("input") as HTMLInputElement;
    check.type = "checkbox";
    check.checked = layout[part];
    check.addEventListener("change", () => setPart(part, check.checked));
    label.append(check, el("span", undefined, PART_LABELS[part]));
    box.append(label);
  }
  const max = el("label", "sb-check");
  const maxCheck = el("input") as HTMLInputElement;
  maxCheck.type = "checkbox";
  maxCheck.checked = document.body.classList.contains("panel-max");
  maxCheck.addEventListener("change", () => togglePanelMax());
  max.append(maxCheck, el("span", undefined, "Maximized Panel"));
  box.append(max, row(button("Reset layout", () => { resetLayout(); closeLayoutMenu(); }, "ghost"), button("Done", closeLayoutMenu, "primary")));
  layoutMenu.replaceChildren(box);
  layoutMenu.hidden = false;
}
const closeLayoutMenu = () => (layoutMenu.hidden = true);
layoutMenu.addEventListener("mousedown", (e) => e.target === layoutMenu && closeLayoutMenu());
$("#layout-button").addEventListener("click", openLayoutMenu);

// --- Bottom panel ------------------------------------------------------------------------------------

type PanelTab = "terminal" | "output" | "problems";
let panelTab: PanelTab = "terminal";
const output = $("#output");
followBottom(output);

function showPanel(tab?: PanelTab): void {
  if (!layout.panel) setPart("panel", true);
  if (tab) panelTab = tab;
  $$(".panel-tab[data-panel]").forEach((b) => b.classList.toggle("on", b.dataset.panel === panelTab));
  $("#terminal").hidden = panelTab !== "terminal";
  output.hidden = panelTab !== "output";
  $("#problems").hidden = panelTab !== "problems";
  terminal.fit();
  if (panelTab === "terminal") terminal.focus();
}
function togglePanel(): void {
  if (layout.panel) setPart("panel", false);
  else showPanel();
}
function togglePanelMax(): void {
  document.body.classList.toggle("panel-max");
  terminal.fit();
}
$$(".panel-tab[data-panel]").forEach((b) => b.addEventListener("click", () => showPanel(b.dataset.panel as PanelTab)));
$("#panel-hide").addEventListener("click", () => setPart("panel", false));
$("#panel-max").addEventListener("click", togglePanelMax);

// Drag the panel's top edge to resize it.
const grip = $("#panel-grip");
grip.addEventListener("pointerdown", (down) => {
  grip.setPointerCapture(down.pointerId);
  const startY = down.clientY;
  const startHeight = $("#panel").getBoundingClientRect().height;
  const move = (e: PointerEvent) => {
    const height = Math.min(innerHeight * 0.8, Math.max(120, startHeight + (startY - e.clientY)));
    document.documentElement.style.setProperty("--panel", `${height}px`);
  };
  const up = () => {
    grip.removeEventListener("pointermove", move);
    grip.removeEventListener("pointerup", up);
    terminal.fit();
  };
  grip.addEventListener("pointermove", move);
  grip.addEventListener("pointerup", up);
});

let problemsKey = "";
function updatePanel(s: VillageState): void {
  renderLog(output, found(s.log), details, findText ? "Nothing in the log matches." : "Nothing yet. Run a command in the terminal, or play the demo.", 200);
  const problems = openProblems(s);
  $("#problems-count").textContent = problems.length ? String(problems.length) : "";
  // Like the tabs: only build the list again when it changed, so its Open buttons keep their clicks.
  const key = JSON.stringify(problems.map((b) => [b.id, b.problem!.agent, b.problem!.message]));
  if (key === problemsKey) return;
  problemsKey = key;
  $("#problems").replaceChildren(
    ...(problems.length
      ? problems.map((b) => {
          const r = el("div", "problem-row");
          r.append(el("span", "icon", "✖"), el("b", "mono", BUILDING_NAMES[b.id]), el("span", "text", `${b.problem!.agent}: ${b.problem!.message}`), button("Open", () => openTab(b.id), "ghost"));
          return r;
        })
      : [el("p", "empty", "No problems. Nice.")]),
  );
}

// --- Find (Ctrl+F): filter the log you're looking at -------------------------------------------------

let findOpen = false;
const findInput = $<HTMLInputElement>("#find-input");
function openFind(): void {
  findOpen = true;
  if (activeTab === "village" || activeTab === "welcome") showPanel("output");
  $("#findbar").hidden = false;
  findInput.focus();
  findInput.select();
  updateFind();
}
function closeFind(): void {
  findOpen = false;
  findText = "";
  findInput.value = "";
  $("#findbar").hidden = true;
  if (state) refresh(state);
}
function updateFind(): void {
  findText = findInput.value.trim().toLowerCase();
  if (!state) return;
  refresh(state);
  const source = activeTab !== "village" && activeTab !== "welcome" ? state.buildings[activeTab].log : state.log;
  // Count what the log shows: the summary leaves out the small steps (like progress).
  const shown = found(source).filter((e) => details || e.emphasis !== "tertiary");
  $("#find-count").textContent = findText ? `${plural(shown.length, "line")}` : "";
}
findInput.addEventListener("input", updateFind);
findInput.addEventListener("keydown", (e) => e.key === "Escape" && closeFind());
$("#find-close").addEventListener("click", closeFind);

// --- Terminal and commands ---------------------------------------------------------------------------

const MENU_LETTERS = "fesvgrth";
function isAppKey(e: KeyboardEvent): boolean {
  if (e.type !== "keydown") return false;
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (e.key === "F1" || e.key === "F8" || e.key === "F11") return true;
  if (e.key === "Alt" || (e.altKey && !ctrl && key.length === 1 && MENU_LETTERS.includes(key))) return true;
  if (e.altKey && !ctrl && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return true;
  if (ctrl && e.altKey && key === "b") return true;
  if (!ctrl || e.altKey) return false;
  if (e.code === "Backquote") return true;
  if (e.shiftKey) return ["p", "g", "u", "m", "i", "e", "n"].includes(key);
  if (["j", "b", "f", "=", "+", "-", "0"].includes(key) || e.key === "PageUp" || e.key === "PageDown") return true;
  // Ctrl+W and Ctrl+O belong to the shell while you're typing in it.
  return (key === "w" || key === "o") && !terminal.hasFocus();
}
const terminal = createTerminal($("#terminal"), isAppKey);

/** How to run CLI Village in this terminal (`node …/cli.js` when it isn't installed globally). */
const cliName = () => info?.cli ?? "cli-village";
/** The short name, for labels. */
const CLI = "cli-village";
const envFlag = (env: string) => (env ? ` --env ${env}` : "");
function shellRun(command: string): void {
  showPanel("terminal");
  terminal.run(command);
}
const runCli = (args: string) => shellRun(`${cliName()} ${args}`);
/** Text as one argument the terminal's shell takes literally ($, ` and ! stay as they are). */
function shellQuote(text: string): string {
  const windows = (info?.platform ?? (navigator.userAgent.includes("Windows") ? "win32" : "")) === "win32";
  // PowerShell: '…' is literal, and ' is written ''. But Windows PowerShell 5.1 splits an argument
  // that has a double quote in it when it starts a program, so a double quote becomes '.
  if (windows) return `'${text.replace(/"/g, "'").replace(/'/g, "''")}'`;
  // bash and zsh: '…' is literal, and ' is written '\''.
  return `'${text.replace(/'/g, "'\\''")}'`;
}
function commit(message: string, thenPush: boolean): void {
  const note = message.replace(/[\r\n]+/g, " ").trim();
  runCli(`commit${note ? ` -m ${shellQuote(note)}` : ""}${thenPush ? " --push" : ""}`);
}
function newTerminal(): void {
  showPanel("terminal");
  terminal.restart();
}
function nextProblem(): void {
  if (!state) return;
  const problems = openProblems(state);
  if (!problems.length) return;
  const at = problems.findIndex((b) => b.id === activeTab);
  openTab(problems[(at + 1) % problems.length]!.id);
}

const commands = (): Command[] => [
  { id: "doctor", title: "Doctor: check that my tools are ready", detail: `${CLI} doctor`, keywords: "infisical git node install", run: () => runCli("doctor") },
  { id: "secrets", title: "Secrets: list the key names", detail: `${CLI} secrets fetch --env <env>`, keywords: "vault infisical fetch", input: { label: "Environment", placeholder: "dev", initial: "dev" }, run: (v) => runCli(`secrets fetch${envFlag(v)}`) },
  { id: "diff", title: "Secrets: compare two environments", detail: `${CLI} secrets diff <a> <b>`, keywords: "vault infisical", input: { label: "Two environments", placeholder: "dev prod", initial: "dev prod" }, run: (v) => runCli(`secrets diff ${v || "dev prod"}`) },
  { id: "run", title: "Run a command with my secrets", detail: `${CLI} run -- <command>`, keywords: "infisical inject env", input: { label: "Command to run", placeholder: "npm start" }, run: (v) => v && runCli(`run -- ${v}`) },
  { id: "login", title: "Infisical: log in", detail: "infisical login", keywords: "vault secrets", run: () => shellRun("infisical login") },
  { id: "init", title: "Infisical: link this folder to a project", detail: "infisical init", keywords: "vault secrets", run: () => shellRun("infisical init") },
  { id: "status", title: "Git: what changed since my last snapshot?", detail: `${CLI} status`, run: () => runCli("status") },
  { id: "commit", title: "Git: save a snapshot (commit), after a secret scan", detail: `${CLI} commit -m "<message>"`, keywords: "harbor crate", input: { label: "A short note about what changed", placeholder: "Fix login" }, run: (v) => commit(v, false) },
  { id: "commit-push", title: "Git: save a snapshot and send it to GitHub", detail: `${CLI} commit -m "<message>" --push`, keywords: "harbor boat", input: { label: "A short note about what changed", placeholder: "Fix login" }, run: (v) => commit(v, true) },
  { id: "push", title: "Git: send my snapshots to GitHub (push)", detail: `${CLI} push`, keywords: "harbor boat", run: () => runCli("push") },
  { id: "test", title: "Tests: run my project's tests", detail: `${CLI} test`, keywords: "lab", run: () => runCli("test") },
  { id: "demo", title: "Village: play the demo (one round)", detail: "pretend robots act out a workday, nothing real runs", run: () => void bridge.playDemo() },
  ...LIGHTINGS.map((mode): Command => ({ id: `light-${mode}`, title: `View: lighting · ${LIGHTING_LABELS[mode]}${lighting === mode ? " ✓" : ""}`, keywords: "night day dusk cycle theme colours", run: () => setLighting(mode) })),
  ...GRAPHICS.map((mode): Command => ({ id: `graphics-${mode}`, title: `View: graphics quality · ${GRAPHICS_LABELS[mode]}${graphics === mode ? " ✓" : ""}`, keywords: "performance slow fast shadows quality", run: () => setGraphics(mode) })),
  { id: "home", title: "View: the whole village", detail: "the camera goes back out", keywords: "camera home", run: () => { showTab("village"); tellVillage({ action: "home" }); } },
  ...BUILDING_ORDER.map((id): Command => ({ id: `focus-${id}`, title: `View: look at the ${BUILDING_NAMES[id]}`, detail: BUILDING_HELP[id], keywords: "camera building focus", run: () => focusBuilding(id) })),
  ...BUILDING_ORDER.map((id): Command => ({ id: `log-${id}`, title: `Log: open the ${BUILDING_NAMES[id]}'s log`, detail: "as a tab", keywords: "building log tab", run: () => openTab(id) })),
  ...(Object.keys(VIEW_TITLES) as View[]).map((v): Command => ({ id: `view-${v}`, title: `Side bar: ${VIEW_TITLES[v]}`, detail: VIEW_SUBS[v], keywords: "sidebar tool panel", run: () => showView(v) })),
  { id: "welcome", title: "Help: Welcome", detail: "start here", run: () => openTab("welcome") },
  { id: "guide", title: "View: show or hide the Guide", detail: "Ctrl+Alt+B", keywords: "secondary side bar help", run: () => togglePart("guide") },
  { id: "panel", title: "View: show or hide the bottom panel", detail: "Ctrl+J", keywords: "terminal output problems", run: togglePanel },
  { id: "panel-max", title: "View: maximize or restore the panel", keywords: "terminal bigger", run: togglePanelMax },
  { id: "sidebar", title: "View: show or hide the side bar", detail: "Ctrl+B", run: () => togglePart("sidebar") },
  { id: "statusbar", title: "View: show or hide the status bar", run: () => togglePart("statusbar") },
  { id: "layout", title: "View: customize the layout", run: openLayoutMenu },
  { id: "fullscreen", title: "View: full screen", detail: "F11", run: () => bridge.window("fullscreen") },
  { id: "zoom-in", title: "View: zoom in", detail: "Ctrl+=", run: () => bridge.window("zoom-in") },
  { id: "zoom-out", title: "View: zoom out", detail: "Ctrl+-", run: () => bridge.window("zoom-out") },
  { id: "zoom-reset", title: "View: reset zoom", detail: "Ctrl+0", run: () => bridge.window("zoom-reset") },
  { id: "details", title: details ? "Log: summary only" : "Log: all details", detail: "like `d` in the terminal view", run: () => { details = !details; if (state) refresh(state); } },
  { id: "find", title: "Find in the log", detail: "Ctrl+F", run: openFind },
  { id: "back", title: "Go: back", detail: "Alt+Left", run: goBack },
  { id: "forward", title: "Go: forward", detail: "Alt+Right", run: goForward },
  { id: "problem", title: "Go: next problem", detail: "F8", run: nextProblem },
  { id: "close-tab", title: "Close the tab", detail: "Ctrl+W", run: () => closableTab() && closeTab(closableTab()!) },
  { id: "terminal", title: "Terminal: focus", detail: "Ctrl+`", run: () => showPanel("terminal") },
  { id: "terminal-new", title: "Terminal: new shell", detail: "Ctrl+Shift+`", run: newTerminal },
  { id: "clear", title: "Terminal: clear", run: () => { showPanel("terminal"); terminal.clear(); } },
  { id: "open-folder", title: "File: open a folder in a new window", detail: "Ctrl+O", run: () => void openFolder() },
  { id: "help", title: "Help: what am I looking at?", keywords: "buildings words keys", run: () => showView("help") },
  { id: "about", title: "Help: about CLI Village", run: openAbout },
];
const palette = new Palette($("#palette"), commands);
$("#palette-button").addEventListener("click", () => palette.open());
$("#tb-search").addEventListener("click", () => palette.open());
const ask = (id: string) => {
  const command = commands().find((c) => c.id === id);
  if (command) palette.prompt(command);
};

async function openFolder(): Promise<void> {
  const folder = await bridge.openFolder();
  if (folder) flash(`Opening a new window in ${folder}…`);
}

// --- Title bar: menus, Back and Forward, the window's buttons -----------------------------------------

const partOn = (part: Part) => () => layout[part];
const menus: Menu[] = [
  {
    label: "File",
    items: () => [
      { label: "New Terminal", keys: "Ctrl+Shift+`", run: newTerminal },
      { label: "Open Folder…", keys: "Ctrl+O", run: () => void openFolder() },
      "-",
      { label: "Close Editor", keys: "Ctrl+W", enabled: () => closableTab() !== null, run: () => closeTab(closableTab()!) },
      { label: "Close All Editors", enabled: () => openTabs.length > 0, run: () => { openTabs = []; showTab("village"); } },
      "-",
      { label: "Close Window", keys: "Alt+F4", run: () => bridge.window("close") },
      { label: "Exit", run: () => bridge.window("close") },
    ],
  },
  {
    label: "Edit",
    items: () => [
      { label: "Undo", keys: "Ctrl+Z", run: () => bridge.edit("undo") },
      { label: "Redo", keys: "Ctrl+Y", run: () => bridge.edit("redo") },
      "-",
      { label: "Cut", keys: "Ctrl+X", run: () => bridge.edit("cut") },
      { label: "Copy", keys: "Ctrl+C", run: () => bridge.edit("copy") },
      { label: "Paste", keys: "Ctrl+V", run: () => bridge.edit("paste") },
      "-",
      { label: "Find in the Log", keys: "Ctrl+F", run: openFind },
      "-",
      { label: "Select All", keys: "Ctrl+A", run: () => bridge.edit("selectAll") },
    ],
  },
  {
    label: "Selection",
    items: () => [
      { label: "Select All", keys: "Ctrl+A", run: () => bridge.edit("selectAll") },
      "-",
      ...BUILDING_ORDER.map((id): MenuEntry => ({ label: `Select the ${BUILDING_NAMES[id]}`, run: () => focusBuilding(id) })),
      "-",
      { label: "Clear Selection (the whole village)", keys: "Esc", run: () => { showTab("village"); tellVillage({ action: "home" }); } },
    ],
  },
  {
    label: "View",
    items: () => [
      { label: "Command Palette…", keys: "Ctrl+Shift+P", run: () => palette.open() },
      "-",
      {
        label: "Appearance",
        items: () => [
          { label: "Full Screen", keys: "F11", checked: () => document.body.classList.contains("fullscreen"), run: () => bridge.window("fullscreen") },
          "-",
          { label: "Primary Side Bar", keys: "Ctrl+B", checked: partOn("sidebar"), run: () => togglePart("sidebar") },
          { label: "Secondary Side Bar (the Guide)", keys: "Ctrl+Alt+B", checked: partOn("guide"), run: () => togglePart("guide") },
          { label: "Panel", keys: "Ctrl+J", checked: partOn("panel"), run: togglePanel },
          { label: "Maximized Panel", checked: () => document.body.classList.contains("panel-max"), run: togglePanelMax },
          { label: "Status Bar", checked: partOn("statusbar"), run: () => togglePart("statusbar") },
          { label: "Customize Layout…", run: openLayoutMenu },
          "-",
          { label: "Zoom In", keys: "Ctrl+=", run: () => bridge.window("zoom-in") },
          { label: "Zoom Out", keys: "Ctrl+-", run: () => bridge.window("zoom-out") },
          { label: "Reset Zoom", keys: "Ctrl+0", run: () => bridge.window("zoom-reset") },
        ],
      },
      {
        label: "Lighting",
        items: () => LIGHTINGS.map((mode): MenuEntry => ({ label: LIGHTING_LABELS[mode], checked: () => lighting === mode, run: () => setLighting(mode) })),
      },
      {
        label: "Graphics Quality",
        items: () => GRAPHICS.map((mode): MenuEntry => ({ label: GRAPHICS_LABELS[mode], checked: () => graphics === mode, run: () => setGraphics(mode) })),
      },
      "-",
      { label: "Welcome", run: () => openTab("welcome") },
      { label: "Village", keys: "Ctrl+Shift+E", checked: () => view === "village" && layout.sidebar, run: () => showView("village") },
      { label: "Secrets", checked: () => view === "secrets" && layout.sidebar, run: () => showView("secrets") },
      { label: "Git", keys: "Ctrl+Shift+G", checked: () => view === "git" && layout.sidebar, run: () => showView("git") },
      { label: "Tests", checked: () => view === "tests" && layout.sidebar, run: () => showView("tests") },
      { label: "Research", checked: () => view === "research" && layout.sidebar, run: () => showView("research") },
      { label: "Agents", checked: () => view === "agents" && layout.sidebar, run: () => showView("agents") },
      "-",
      { label: "Terminal", keys: "Ctrl+`", checked: () => layout.panel && panelTab === "terminal", run: () => showPanel("terminal") },
      { label: "Output", keys: "Ctrl+Shift+U", checked: () => layout.panel && panelTab === "output", run: () => showPanel("output") },
      { label: "Problems", keys: "Ctrl+Shift+M", checked: () => layout.panel && panelTab === "problems", run: () => showPanel("problems") },
      "-",
      { label: "Log: All Details", checked: () => details, run: () => { details = !details; if (state) refresh(state); } },
    ],
  },
  {
    label: "Go",
    items: () => [
      { label: "Back", keys: "Alt+Left", enabled: () => visitedAt > 0, run: goBack },
      { label: "Forward", keys: "Alt+Right", enabled: () => visitedAt < visited.length - 1, run: goForward },
      "-",
      { label: "Next Editor", keys: "Ctrl+PageDown", run: () => nextTab(1) },
      { label: "Previous Editor", keys: "Ctrl+PageUp", run: () => nextTab(-1) },
      "-",
      { label: "Go to the Village", run: () => showTab("village") },
      { label: "Go to Welcome", run: () => openTab("welcome") },
      { label: "Go to a Building's Log", items: () => BUILDING_ORDER.map((id): MenuEntry => ({ label: BUILDING_NAMES[id], run: () => openTab(id) })) },
      { label: "Look at a Building", items: () => BUILDING_ORDER.map((id): MenuEntry => ({ label: BUILDING_NAMES[id], run: () => focusBuilding(id) })) },
      "-",
      { label: "Next Problem", keys: "F8", enabled: () => Boolean(state && openProblems(state).length), run: nextProblem },
      { label: "Go to the Terminal", keys: "Ctrl+`", run: () => showPanel("terminal") },
    ],
  },
  {
    label: "Run",
    items: () => [
      { label: "Doctor: Check My Tools", run: () => runCli("doctor") },
      "-",
      { label: "Secrets: List the Key Names…", run: () => ask("secrets") },
      { label: "Secrets: Compare Two Environments…", run: () => ask("diff") },
      { label: "Run a Command With My Secrets…", run: () => ask("run") },
      "-",
      { label: "Infisical: Log In", run: () => shellRun("infisical login") },
      { label: "Infisical: Link This Folder", run: () => shellRun("infisical init") },
      "-",
      { label: "Git: What Changed?", run: () => runCli("status") },
      { label: "Git: Commit…", run: () => ask("commit") },
      { label: "Git: Commit and Push…", run: () => ask("commit-push") },
      { label: "Git: Push", run: () => runCli("push") },
      "-",
      { label: "Tests: Run the Tests", run: () => runCli("test") },
      "-",
      { label: "Play the Demo (One Round)", run: () => void bridge.playDemo() },
    ],
  },
  {
    label: "Terminal",
    items: () => [
      { label: "New Terminal", keys: "Ctrl+Shift+`", run: newTerminal },
      { label: "Focus Terminal", keys: "Ctrl+`", run: () => showPanel("terminal") },
      "-",
      { label: "Run Command…", run: () => palette.prompt({ id: "shell", title: "Run a command", input: { label: "Command for the shell", placeholder: "git log --oneline" }, run: (v) => v && shellRun(v) }) },
      { label: "Run CLI Village Command…", run: () => palette.prompt({ id: "cli", title: "Run cli-village", input: { label: `Arguments for ${CLI}`, placeholder: "status" }, run: (v) => v && runCli(v) }) },
      "-",
      { label: "Clear", run: () => { showPanel("terminal"); terminal.clear(); } },
      { label: "Kill Terminal", run: () => terminal.kill() },
    ],
  },
  {
    label: "Help",
    items: () => [
      { label: "Welcome", run: () => openTab("welcome") },
      { label: "Show All Commands", keys: "Ctrl+Shift+P", run: () => palette.open() },
      { label: "What Am I Looking At?", run: () => showView("help") },
      { label: "Keyboard Shortcuts", run: () => { showView("help"); $$("#sidebar-body .fold").forEach((d, i) => ((d as HTMLDetailsElement).open = i === 2)); } },
      { label: "The Guide", keys: "Ctrl+Alt+B", checked: partOn("guide"), run: () => togglePart("guide") },
      "-",
      { label: "Infisical CLI Docs (in your browser)", run: () => bridge.openLink("infisical") },
      { label: "CLI Village on GitHub (in your browser)", run: () => bridge.openLink("repo") },
      { label: "Report an Issue (in your browser)", run: () => bridge.openLink("issues") },
      "-",
      { label: "Toggle Developer Tools", keys: "Ctrl+Shift+I", run: () => bridge.window("devtools") },
      { label: "Reload Window", run: () => bridge.window("reload") },
      "-",
      { label: "About CLI Village", run: openAbout },
    ],
  },
];
const menubar = new MenuBar($("#menubar"), menus);
$("#nav-back").addEventListener("click", goBack);
$("#nav-forward").addEventListener("click", goForward);
$$(".tb-win[data-win]").forEach((b) => b.addEventListener("click", () => bridge.window(b.dataset.win as "minimize" | "maximize" | "close")));
$("#titlebar").addEventListener("dblclick", (e) => {
  if ((e.target as HTMLElement).closest("button, nav")) return;
  bridge.window("maximize");
});
function windowState(s: { maximized: boolean; fullScreen: boolean }): void {
  document.body.classList.toggle("maximized", s.maximized);
  document.body.classList.toggle("fullscreen", s.fullScreen);
  $("#win-maximize").title = s.maximized ? "Restore" : "Maximize";
}
bridge.onWindowState(windowState);

// --- About --------------------------------------------------------------------------------------------

function openAbout(): void {
  const about = $("#about");
  const box = el("div", "dialog");
  box.append(el("h2", "doc-title", "CLI Village"), el("p", "sb-note", "Watch your agents work in a tiny village. A friendly wrapper around the Infisical CLI. MIT licensed."));
  box.append(
    rows([
      ["Version", info?.version ?? "…"],
      ["Mode", info?.mode ?? "…"],
      ["Folder", info?.cwd ?? "…"],
      ["Village socket", info ? (info.hub.role === "none" ? info.hub.error : `${info.hub.role} · ${info.hub.path}`) : "…"],
      ["Infisical", info?.infisical ?? "…"],
    ]),
  );
  box.append(row(button("CLI Village on GitHub", () => bridge.openLink("repo"), "ghost"), button("OK", closeAbout, "primary")));
  about.replaceChildren(box);
  about.hidden = false;
  box.querySelector<HTMLButtonElement>(".primary")?.focus();
}
const closeAbout = () => ($("#about").hidden = true);
$("#about").addEventListener("mousedown", (e) => e.target === e.currentTarget && closeAbout());

// --- Keys ----------------------------------------------------------------------------------------------

let altAlone = false;
function onKeyDown(e: KeyboardEvent): void {
  if (e.key === "Alt") {
    altAlone = true;
    return;
  }
  altAlone = false;
  if (e.key === "Escape") {
    if (palette.isOpen) palette.close();
    else if (!layoutMenu.hidden) closeLayoutMenu();
    else if (!$("#about").hidden) closeAbout();
    else if (findOpen && document.activeElement === findInput) closeFind();
    return;
  }
  if (!isAppKey(e)) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (e.altKey && !ctrl && key.length === 1) {
    if (menubar.openByLetter(key)) e.preventDefault();
    return;
  }
  e.preventDefault();
  if (e.key === "F1" || (ctrl && e.shiftKey && key === "p")) palette.isOpen ? palette.close() : palette.open();
  else if (e.key === "F8") nextProblem();
  else if (e.key === "F11") bridge.window("fullscreen");
  else if (e.altKey && e.key === "ArrowLeft") goBack();
  else if (e.altKey && e.key === "ArrowRight") goForward();
  else if (ctrl && e.altKey && key === "b") togglePart("guide");
  else if (ctrl && e.code === "Backquote") e.shiftKey ? newTerminal() : layout.panel && panelTab === "terminal" && terminal.hasFocus() ? setPart("panel", false) : showPanel("terminal");
  else if (ctrl && e.shiftKey && key === "g") showView("git");
  else if (ctrl && e.shiftKey && key === "e") showView("village");
  else if (ctrl && e.shiftKey && key === "u") showPanel("output");
  else if (ctrl && e.shiftKey && key === "m") showPanel("problems");
  else if (ctrl && e.shiftKey && key === "i") bridge.window("devtools");
  else if (ctrl && e.shiftKey && key === "n") openTab("welcome");
  else if (ctrl && key === "j") togglePanel();
  else if (ctrl && key === "b") togglePart("sidebar");
  else if (ctrl && key === "f") openFind();
  else if (ctrl && key === "w") closableTab() && closeTab(closableTab()!);
  else if (ctrl && key === "o") void openFolder();
  else if (ctrl && (key === "=" || key === "+")) bridge.window("zoom-in");
  else if (ctrl && key === "-") bridge.window("zoom-out");
  else if (ctrl && key === "0") bridge.window("zoom-reset");
  else if (ctrl && e.key === "PageDown") nextTab(1);
  else if (ctrl && e.key === "PageUp") nextTab(-1);
}
// Alt on its own opens the menus, like VS Code; Alt again, or Esc, closes them.
function onKeyUp(e: KeyboardEvent): void {
  if (e.key === "Alt" && altAlone) menubar.isOpen ? menubar.close() : menubar.open(0);
  altAlone = false;
}
addEventListener("keydown", onKeyDown);
addEventListener("keyup", onKeyUp);
// After a click in the village, the keys go to the village's own page. The app's keys
// (Ctrl+Shift+P, Ctrl+J, F8, Alt…) should still work there, as they do in VS Code.
// The village's own keys (?, n, h, Esc…) never use Ctrl or Alt, so nothing runs twice.
frame.addEventListener("load", () => {
  const inside = frame.contentWindow;
  if (!inside) return;
  inside.addEventListener("keydown", (e) => e.key !== "Escape" && onKeyDown(e));
  inside.addEventListener("keyup", onKeyUp);
});

// --- Status bar ---------------------------------------------------------------------------------------

let flashTimer = 0;
/** A short message in the status bar, in place of the socket line. */
function flash(message: string): void {
  const hub = $("#status-hub");
  hub.textContent = message;
  hub.className = "status-item warn";
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => info && showInfo(info), 6000);
}

function updateStatus(s: VillageState): void {
  const agents = Object.values(s.agents);
  const working = agents.filter((a) => a.status === "working").length;
  const problems = openProblems(s).length;
  $("#status-mode").textContent = `${info?.mode ?? "…"}${s.stopped ? " · stopped" : ""}`;
  $("#status-robots").textContent = `${plural(agents.length, "robot")} · ${working} working`;
  const p = $("#status-problems");
  p.textContent = problems ? `✖ ${plural(problems, "problem")}` : "no problems";
  p.className = problems ? "status-item bad" : "status-item";
  const filled = Math.round(s.health * 5);
  const grade = s.health >= 0.8 ? "good" : s.health >= 0.5 ? "fair" : "poor";
  const meter = $("#status-health-bar");
  meter.className = `meter ${grade}`;
  meter.querySelectorAll("i").forEach((seg, i) => seg.classList.toggle("on", i < filled));
  $("#status-health-text").textContent = `${Math.round(s.health * 100)}% ${grade}`;
}

function showInfo(i: AppInfo): void {
  document.body.dataset.mode = i.mode;
  const hub = $("#status-hub");
  if (i.hub.role === "none") {
    hub.textContent = i.mode === "demo" ? "demo: nothing real runs" : `✖ ${i.hub.error}`;
    hub.className = i.mode === "demo" ? "status-item" : "status-item bad";
  } else {
    hub.textContent = i.hub.role === "host" ? "village open: your commands show up here" : "following the village that's already open";
    hub.className = "status-item";
  }
  $("#status-branch").textContent = i.branch ? `⑂ ${i.branch}` : "not a git project";
  $("#status-infisical").textContent =
    i.infisical === "linked" ? "Infisical: linked" : i.infisical === "not linked" ? "Infisical: not linked (infisical init)" : "Infisical CLI: not installed";
  $("#status-infisical").className = i.infisical === "linked" ? "status-item" : "status-item warn";
}
$("#status-mode").addEventListener("click", openAbout);
$("#status-hub").addEventListener("click", () => showView("agents"));
$("#status-branch").addEventListener("click", () => showView("git"));
$("#status-infisical").addEventListener("click", () => showView("secrets"));
$("#status-robots").addEventListener("click", () => showView("village"));
$("#status-problems").addEventListener("click", () => showPanel("problems"));
$("#status-health").addEventListener("click", () => showView("help"));
$("#status-light").addEventListener("click", () => setLighting(LIGHTINGS[(LIGHTINGS.indexOf(lighting) + 1) % LIGHTINGS.length]!));

// --- Events -----------------------------------------------------------------------------------------------

function refresh(s: VillageState): void {
  state = s;
  updateStatus(s);
  updateSidebar(s);
  updatePanel(s);
  renderTabs();
  renderDoc();
  renderGuide();
}

const source = connect(token, {
  onHello: () => {},
  onStatus: (message) => {
    const hub = $("#status-hub");
    if (message) {
      hub.textContent = message;
      hub.className = "status-item warn";
    } else if (info) showInfo(info);
  },
});
source.subscribe(() => refresh(source.getState()));

void bridge.info().then((i) => {
  if (!i) return;
  info = i;
  document.title = `CLI Village · ${i.cwd}`;
  $("#tb-search-text").textContent = i.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? "CLI Village";
  document.body.classList.toggle("mac", i.platform === "darwin");
  windowState({ maximized: i.maximized, fullScreen: false });
  showInfo(i);
  buildSidebar();
  refresh(source.getState());
});

for (const part of Object.keys(layout) as Part[]) setPart(part, layout[part]);
applyLight(lighting === "cycle" ? DUSK : LIGHT_LEVEL[lighting]);
renderWelcome();
if (store.get("welcome") !== "0") openTab("welcome");
buildSidebar();
showPanel("terminal");
refresh(source.getState());
// "walking" wears off by the clock, not by an event, so the robots list ticks on its own.
setInterval(() => state && updateSidebar(state), 1000);
