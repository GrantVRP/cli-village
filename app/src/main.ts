// The desktop app's window: a VS Code-like shell around the 3D village.
//
//   activity bar · side bar (robots, secrets, git, tests, research, agents, help)
//   editor: the village, with building logs as tabs · bottom panel: terminal, output, problems
//   status bar · command palette (Ctrl+Shift+P)
//
// It follows the same events as every other view, over the village server's
// WebSocket. Commands run in the real terminal at the bottom; the village reacts.
// Text from events is always set as plain text (never HTML).

import { EXPERT_FLAGS, GLOSSARY } from "../../src/events/explain.js";
import { describeHarbor, openProblems, type VillageState } from "../../src/events/state.js";
import { BUILDING_HELP, BUILDING_NAMES, BUILDINGS, type Building } from "../../src/events/types.js";
import { connect } from "../../web/src/connection.js";
import { el, followBottom, HARBOR_ICONS, harborLine, plural, renderLog, robotRow, sortedRobots } from "../../web/src/lists.js";
import type { AppInfo } from "./bridge.js";
import { Palette, type Command } from "./palette.js";
import { createTerminal } from "./terminal.js";
import "./style.css";

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const token = new URLSearchParams(location.search).get("token") ?? "";

type View = "village" | "secrets" | "git" | "tests" | "research" | "agents" | "help";
const VIEW_TITLES: Record<View, string> = {
  village: "Village",
  secrets: "Secrets · the Vault",
  git: "Git · the Harbor",
  tests: "Tests · the Lab",
  research: "Research · the Library",
  agents: "Agents · the Town Hall",
  help: "Help",
};
const BUILDING_ORDER: Building[] = ["townhall", "vault", "library", "workshop", "lab", "harbor", "home"];

let info: AppInfo | null = null;
let state: VillageState | null = null;
let view: View = "village";
let details = false;
let night = true;

// --- The village, in a frame ---------------------------------------------------------------

const frame = $<HTMLIFrameElement>("#village");
frame.src = `/?token=${encodeURIComponent(token)}&embed=1&night=1`;
const tellVillage = (action: string, building?: Building) =>
  frame.contentWindow?.postMessage({ type: "cli-village", action, building }, location.origin);
addEventListener("message", (e: MessageEvent<{ type?: string; action?: string; building?: string }>) => {
  if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
  const m = e.data;
  if (m?.type === "cli-village" && m.action === "selected" && (BUILDINGS as readonly string[]).includes(m.building ?? "")) {
    openTab(m.building as Building);
  }
});

// --- Editor tabs: the village, plus any building's log ---------------------------------------

let openTabs: Building[] = [];
let activeTab: "village" | Building = "village";
const docLog = el("ol", "log");
followBottom(docLog);

function openTab(id: Building): void {
  if (!openTabs.includes(id)) openTabs = [...openTabs, id];
  activeTab = id;
  renderTabs();
  renderDoc();
}

function closeTab(id: Building): void {
  openTabs = openTabs.filter((b) => b !== id);
  if (activeTab === id) activeTab = openTabs.at(-1) ?? "village";
  renderTabs();
  renderDoc();
}

function showTab(id: "village" | Building): void {
  activeTab = id;
  renderTabs();
  renderDoc();
}

function renderTabs(): void {
  const tabs = $("#tabs");
  const make = (id: "village" | Building, label: string, closable: boolean) => {
    const tab = el("div", `tab${activeTab === id ? " on" : ""}`);
    tab.setAttribute("role", "tab");
    const name = el("button", "tab-name", label);
    name.addEventListener("click", () => showTab(id));
    tab.append(name);
    if (closable) {
      const close = el("button", "tab-close", "×");
      close.title = "Close";
      close.addEventListener("click", () => closeTab(id as Building));
      tab.append(close);
    }
    const b = id !== "village" && state ? state.buildings[id] : null;
    if (b?.problem) tab.classList.add("problem");
    else if (b?.working.length) tab.classList.add("active");
    return tab;
  };
  tabs.replaceChildren(make("village", "Village", false), ...openTabs.map((id) => make(id, BUILDING_NAMES[id], true)));
}

function renderDoc(): void {
  const doc = $("#doc");
  const showingVillage = activeTab === "village";
  frame.classList.toggle("hidden", !showingVillage);
  doc.hidden = showingVillage;
  if (showingVillage || !state) return;
  const id = activeTab as Building;
  const b = state.buildings[id];
  const head = el("div", "doc-head");
  const title = el("h2", "doc-title", BUILDING_NAMES[id]);
  const focus = el("button", "button", "Show in the village");
  focus.addEventListener("click", () => {
    showTab("village");
    tellVillage("focus", id);
  });
  head.append(title, focus);
  const status = el("p", b.problem ? "doc-status bad" : "doc-status");
  status.textContent = b.problem
    ? `✖ Needs attention: ${b.problem.message}`
    : b.working.length
      ? `▶ Working here: ${b.working.join(", ")}`
      : "○ Quiet right now";
  const parts: HTMLElement[] = [head, el("p", "doc-help", BUILDING_HELP[id]), status];
  const harbor = id === "harbor" ? describeHarbor(state) : null;
  if (harbor) parts.push(el("p", `doc-note ${harbor.level}`, `${HARBOR_ICONS[harbor.icon]} ${harbor.text}`));
  renderLog(docLog, b.log, details, "Nothing has happened here yet.", 120);
  parts.push(docLog);
  doc.replaceChildren(...parts);
}

// --- Side bar -------------------------------------------------------------------------------------

/** Built once per view (so typed values survive), then filled from the state. */
function buildSidebar(): void {
  $("#sidebar-title").textContent = VIEW_TITLES[view];
  $$(".activity-item").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
  const body = $("#sidebar-body");
  const parts: HTMLElement[] = [];
  const section = (title: string, ...children: HTMLElement[]) => {
    const s = el("section", "sb-section");
    s.append(el("h3", "eyebrow", title), ...children);
    return s;
  };
  const log = (building: Building) => {
    const list = el("ol", "log");
    list.id = "sb-log";
    list.dataset.building = building;
    followBottom(list);
    return section(`${BUILDING_NAMES[building]} log`, list);
  };
  const button = (label: string, onClick: () => void, primary = false) => {
    const b = el("button", primary ? "button primary" : "button", label);
    b.addEventListener("click", onClick);
    return b;
  };
  const input = (id: string, placeholder: string, value = "") => {
    const i = el("input", "input") as HTMLInputElement;
    i.id = id;
    i.placeholder = placeholder;
    i.value = value;
    i.spellcheck = false;
    return i;
  };
  const value = (id: string) => ($(`#${id}`) as HTMLInputElement).value.trim();
  const note = (text: string) => el("p", "sb-note", text);
  const row = (...children: HTMLElement[]) => {
    const r = el("div", "sb-row");
    r.append(...children);
    return r;
  };

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
        tellVillage("focus", id);
      });
      buildings.append(b);
    }
    parts.push(section("Robots", robots, harbor), section("Buildings", buildings));
  } else if (view === "secrets") {
    parts.push(
      section(
        "Infisical",
        note("Your secrets live in Infisical. CLI Village shows key names and counts only. Values never appear here, in the terminal or in the village."),
        row(input("sb-env", "environment, like dev", "dev"), button("Fetch key names", () => runCli(`secrets fetch${envFlag(value("sb-env"))}`), true)),
        row(input("sb-env2", "compare with, like prod", "prod"), button("Compare", () => runCli(`secrets diff ${value("sb-env") || "dev"} ${value("sb-env2") || "prod"}`))),
        row(input("sb-run", "a command to run with secrets, like npm start"), button("Run", () => value("sb-run") && runCli(`run${envFlag(value("sb-env"))} -- ${value("sb-run")}`))),
        note("Not linked yet? Run `infisical init` in the terminal and pick a project. Not installed? Run `cli-village doctor` for the fix."),
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
        note("A commit is a saved snapshot of your work. Before anything is saved or sent, the gate at the harbor scans it for passwords and keys."),
        row(button("What changed?", () => runCli("status"))),
        row(input("sb-message", "a short note about what changed"), button("Commit", () => commit(value("sb-message"), check.checked), true)),
        row(push, button("Push to GitHub", () => runCli("push"))),
      ),
      section("Harbor", (() => {
        const h = el("div", "harbor-line");
        h.id = "sb-harbor";
        return h;
      })()),
      log("harbor"),
    );
  } else if (view === "tests") {
    parts.push(
      section(
        "Tests",
        note("Runs your project's tests (npm test, cargo test, go test or pytest). Sprocket carries the result to the Lab."),
        row(button("Run the tests", () => runCli("test"), true)),
        row(input("sb-test", "or your own command, like npm run test:unit"), button("Run this", () => value("sb-test") && runCli(`test -- ${value("sb-test")}`))),
      ),
      log("lab"),
    );
  } else if (view === "research") {
    parts.push(
      section(
        "Research",
        note("Research gathered from the internet shows up at the Library. AI agents report it with `cli-village emit`; nothing secret is ever sent anywhere."),
        el("pre", "sb-code", `${CLI} emit '{"type":"start","agent":"my-agent","task":"r1","kind":"research","title":"Reading the docs"}'`),
      ),
      log("library"),
    );
  } else if (view === "agents") {
    parts.push(
      section(
        "External agents",
        note("Any program can be a robot here. It sends events (start, progress, done, fail) with `cli-village emit`, or writes the same JSON lines to the local socket."),
        el("pre", "sb-code", `${CLI} emit '{"type":"start","agent":"my-agent","task":"c1","kind":"code","title":"Editing src/app.ts"}'\n${CLI} emit '{"type":"done","agent":"my-agent","task":"c1"}'`),
        row(button("See every event type", () => runCli("emit --help"))),
        row(button("Play the demo (one round)", () => void window.cliVillage.playDemo())),
      ),
      log("townhall"),
    );
  } else {
    const buildings = el("div", "help-rows");
    for (const id of BUILDING_ORDER) {
      const r = el("div", "help-row");
      r.append(el("b", "mono", BUILDING_NAMES[id]), el("span", undefined, BUILDING_HELP[id]));
      buildings.append(r);
    }
    const words = el("div", "help-rows");
    for (const { word, meaning } of GLOSSARY) {
      const r = el("div", "help-row");
      r.append(el("b", undefined, word), el("span", undefined, meaning));
      words.append(r);
    }
    const keys = el("div", "help-rows");
    for (const [k, what] of [
      ["Ctrl+Shift+P", "every command"],
      ["Ctrl+J", "show or hide the bottom panel"],
      ["Ctrl+B", "show or hide the side bar"],
      ["click", "a building: its log opens as a tab"],
      ["drag · scroll", "look around the village, zoom"],
      ["n · h", "in the village: night or day, back to the whole village"],
    ]) {
      const r = el("div", "help-row");
      r.append(el("b", "mono", k!), el("span", undefined, what!));
      keys.append(r);
    }
    parts.push(
      section("What am I looking at?", note("Each robot is an agent (a helper program). When it starts a task, it walks to the building for that kind of work. The glowing column in the plaza shows how healthy the village is.")),
      section("Buildings", buildings),
      section("Words you'll see", words),
      section("Keys", keys),
      section("Safe by design", note("Secret values never appear here: only key names and counts. The village only listens on this computer, behind a one-time link.")),
      section("For experts", note(`In the terminal, add ${EXPERT_FLAGS}.`)),
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
  document.querySelectorAll<HTMLElement>(".building-row").forEach((b) => {
    const id = b.dataset.building as Building;
    const st = s.buildings[id];
    b.className = `building-row ${st.problem ? "problem" : st.working.length ? "active" : "idle"}`;
    b.querySelector(".icon")!.textContent = st.problem ? "✖" : st.working.length ? "▶" : "○";
  });
  const log = document.querySelector<HTMLElement>("#sb-log");
  if (log) renderLog(log, s.buildings[log.dataset.building as Building].log, details, "Nothing has happened here yet.");
}

function $$(selector: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(selector)];
}

function showView(next: View): void {
  view = next;
  document.body.classList.remove("no-sidebar");
  buildSidebar();
}
$$(".activity-item[data-view]").forEach((b) =>
  b.addEventListener("click", () => {
    const next = b.dataset.view as View;
    if (next === view && !document.body.classList.contains("no-sidebar")) document.body.classList.add("no-sidebar");
    else showView(next);
  }),
);

// --- Bottom panel ------------------------------------------------------------------------------------

type PanelTab = "terminal" | "output" | "problems";
let panelTab: PanelTab = "terminal";
const output = $("#output");
followBottom(output);

function showPanel(tab?: PanelTab): void {
  document.body.classList.remove("no-panel");
  if (tab) panelTab = tab;
  $$(".panel-tab[data-panel]").forEach((b) => b.classList.toggle("on", b.dataset.panel === panelTab));
  $("#terminal").hidden = panelTab !== "terminal";
  output.hidden = panelTab !== "output";
  $("#problems").hidden = panelTab !== "problems";
  terminal.fit();
  if (panelTab === "terminal") terminal.focus();
}
function togglePanel(): void {
  if (document.body.classList.toggle("no-panel")) return;
  showPanel();
}
$$(".panel-tab[data-panel]").forEach((b) => b.addEventListener("click", () => showPanel(b.dataset.panel as PanelTab)));
$("#panel-hide").addEventListener("click", () => document.body.classList.add("no-panel"));

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

function updatePanel(s: VillageState): void {
  renderLog(output, s.log, details, "Nothing yet. Run a command in the terminal, or play the demo.", 200);
  const problems = openProblems(s);
  $("#problems-count").textContent = problems.length ? String(problems.length) : "";
  $("#problems").replaceChildren(
    ...(problems.length
      ? problems.map((b) => {
          const row = el("div", "problem-row");
          const open = el("button", "button", "Open");
          open.addEventListener("click", () => openTab(b.id));
          row.append(el("span", "icon", "✖"), el("b", "mono", BUILDING_NAMES[b.id]), el("span", "text", `${b.problem!.agent}: ${b.problem!.message}`), open);
          return row;
        })
      : [el("p", "empty", "No problems. Nice.")]),
  );
}

// --- Terminal and commands ---------------------------------------------------------------------------

function isAppKey(e: KeyboardEvent): boolean {
  if (e.type !== "keydown") return false;
  const ctrl = e.ctrlKey || e.metaKey;
  if ((ctrl && e.shiftKey && e.key.toLowerCase() === "p") || e.key === "F1") return true;
  if (ctrl && !e.shiftKey && (e.key.toLowerCase() === "j" || e.key === "`")) return true;
  if (ctrl && !e.shiftKey && e.key.toLowerCase() === "b") return true;
  return false;
}
const terminal = createTerminal($("#terminal"), isAppKey);

/** How to run CLI Village in this terminal (`node …/cli.js` when it isn't installed globally). */
const cliName = () => info?.cli ?? "cli-village";
/** The short name, for labels. */
const CLI = "cli-village";
const envFlag = (env: string) => (env ? ` --env ${env}` : "");
function runCli(args: string): void {
  showPanel("terminal");
  terminal.run(`${cliName()} ${args}`);
}
function commit(message: string, thenPush: boolean): void {
  // Quotes would break the shell's quoting; the message doesn't need them.
  const clean = message.replace(/["`$]/g, "'");
  runCli(`commit${clean ? ` -m "${clean}"` : ""}${thenPush ? " --push" : ""}`);
}

const commands = (): Command[] => [
  { id: "doctor", title: "Doctor: check that my tools are ready", detail: `${CLI} doctor`, keywords: "infisical git node install", run: () => runCli("doctor") },
  { id: "secrets", title: "Secrets: list the key names", detail: `${CLI} secrets fetch --env <env>`, keywords: "vault infisical fetch", input: { label: "Environment", placeholder: "dev", initial: "dev" }, run: (v) => runCli(`secrets fetch${envFlag(v)}`) },
  { id: "diff", title: "Secrets: compare two environments", detail: `${CLI} secrets diff <a> <b>`, keywords: "vault infisical", input: { label: "Two environments", placeholder: "dev prod", initial: "dev prod" }, run: (v) => runCli(`secrets diff ${v || "dev prod"}`) },
  { id: "run", title: "Run a command with my secrets", detail: `${CLI} run -- <command>`, keywords: "infisical inject env", input: { label: "Command to run", placeholder: "npm start" }, run: (v) => v && runCli(`run -- ${v}`) },
  { id: "status", title: "Git: what changed since my last snapshot?", detail: `${CLI} status`, run: () => runCli("status") },
  { id: "commit", title: "Git: save a snapshot (commit), after a secret scan", detail: `${CLI} commit -m "<message>"`, keywords: "harbor crate", input: { label: "A short note about what changed", placeholder: "Fix login" }, run: (v) => commit(v, false) },
  { id: "commit-push", title: "Git: save a snapshot and send it to GitHub", detail: `${CLI} commit -m "<message>" --push`, keywords: "harbor boat", input: { label: "A short note about what changed", placeholder: "Fix login" }, run: (v) => commit(v, true) },
  { id: "push", title: "Git: send my snapshots to GitHub (push)", detail: `${CLI} push`, keywords: "harbor boat", run: () => runCli("push") },
  { id: "test", title: "Tests: run my project's tests", detail: `${CLI} test`, keywords: "lab", run: () => runCli("test") },
  { id: "demo", title: "Village: play the demo (one round)", detail: "pretend robots act out a workday, nothing real runs", run: () => void window.cliVillage.playDemo() },
  { id: "night", title: night ? "View: day" : "View: night", detail: "the village's lighting", keywords: "night day dusk", run: () => setNight(!night) },
  { id: "home", title: "View: the whole village", detail: "the camera goes back out", keywords: "camera home", run: () => { showTab("village"); tellVillage("home"); } },
  ...BUILDING_ORDER.map((id): Command => ({ id: `focus-${id}`, title: `View: look at the ${BUILDING_NAMES[id]}`, detail: BUILDING_HELP[id], keywords: "camera building focus", run: () => { showTab("village"); tellVillage("focus", id); } })),
  ...BUILDING_ORDER.map((id): Command => ({ id: `log-${id}`, title: `Log: open the ${BUILDING_NAMES[id]}'s log`, detail: "as a tab", keywords: "building log tab", run: () => openTab(id) })),
  ...(Object.keys(VIEW_TITLES) as View[]).map((v): Command => ({ id: `view-${v}`, title: `Side bar: ${VIEW_TITLES[v]}`, keywords: "sidebar tool panel", run: () => showView(v) })),
  { id: "panel", title: "View: show or hide the bottom panel", detail: "Ctrl+J", keywords: "terminal output problems", run: togglePanel },
  { id: "sidebar", title: "View: show or hide the side bar", detail: "Ctrl+B", run: () => document.body.classList.toggle("no-sidebar") },
  { id: "details", title: details ? "Log: summary only" : "Log: all details", detail: "like `d` in the terminal view", run: () => { details = !details; if (state) refresh(state); } },
  { id: "terminal", title: "Terminal: focus", detail: "Ctrl+J shows it", run: () => showPanel("terminal") },
  { id: "clear", title: "Terminal: clear", run: () => { showPanel("terminal"); terminal.run("clear"); } },
  { id: "help", title: "Help: what am I looking at?", keywords: "buildings words keys", run: () => showView("help") },
];
const palette = new Palette($("#palette"), commands);
$("#palette-button").addEventListener("click", () => palette.open());

function setNight(on: boolean): void {
  night = on;
  tellVillage(on ? "night" : "day");
}

addEventListener("keydown", (e) => {
  if (!isAppKey(e)) {
    if (e.key === "Escape" && palette.isOpen) palette.close();
    return;
  }
  e.preventDefault();
  const key = e.key.toLowerCase();
  if (key === "p" || e.key === "F1") palette.isOpen ? palette.close() : palette.open();
  else if (key === "j" || e.key === "`") togglePanel();
  else if (key === "b") document.body.classList.toggle("no-sidebar");
});

// --- Status bar ---------------------------------------------------------------------------------------

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

// --- Events -----------------------------------------------------------------------------------------------

function refresh(s: VillageState): void {
  state = s;
  updateStatus(s);
  updateSidebar(s);
  updatePanel(s);
  renderTabs();
  renderDoc();
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

window.cliVillage.info().then((i) => {
  if (!i) return;
  info = i;
  document.title = `CLI Village · ${i.cwd}`;
  showInfo(i);
  buildSidebar();
  refresh(source.getState());
});

buildSidebar();
showPanel("terminal");
refresh(source.getState());
// "walking" wears off by the clock, not by an event, so the robots list ticks on its own.
setInterval(() => state && updateSidebar(state), 1000);
