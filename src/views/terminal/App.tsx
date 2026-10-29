// The terminal view, drawn with Ink (React for the terminal).
//
// Layout, top to bottom (most important first):
//   status bar · the ONE key message · robots | what's happening · key hints

import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  describeHarbor,
  isWalking,
  openProblems,
  type AgentState,
  type AgentStatus,
  type HarborSummary,
  type Headline,
  type LogEntry,
  type VillageState,
} from "../../events/state.js";
import { EXPERT_FLAGS, GLOSSARY, type WaitingHint } from "../../events/explain.js";
import type { VillageStore } from "../../events/store.js";
import { BUILDING_HELP, BUILDING_NAMES, type Building, type EventType } from "../../events/types.js";
import { icons, theme } from "./theme.js";

export interface AppProps {
  store: VillageStore;
  /** Shown in the status bar, e.g. "demo". */
  mode: string;
  /** Address of the 3D village, when it's open. */
  url?: string;
  /** Called when you press q: stop the work so everyone walks home. */
  onStop: () => void;
  /** --compact: the same facts in fewer lines, without the beginner explanations. */
  compact?: boolean;
  /** Fixed size, for tests. Normally the terminal's own size is used. */
  size?: { columns: number; rows: number };
  /** What to suggest before anything has happened (live mode). */
  waiting?: WaitingHint;
  /** Start looking at one building (as if you'd pressed Tab), for tests. */
  focus?: Building;
}

export type { WaitingHint };

/** Rows the key message takes: title, subtitle, command, explanation, plus a blank line above and below. */
const keyMessageRows = (compact: boolean) => (compact ? 2 : 6);
/** The stacked log always keeps this many lines, even with lots of robots. */
const MIN_LOG_LINES = 3;

const HELP_ORDER: Building[] = ["vault", "library", "workshop", "lab", "townhall", "home", "harbor"];

/** Tab and Shift+Tab: the next (or previous) building to look at. */
function nextBuilding(current: Building | null, by: 1 | -1): Building {
  const i = current ? HELP_ORDER.indexOf(current) : by === 1 ? -1 : 0;
  return HELP_ORDER[(i + by + HELP_ORDER.length) % HELP_ORDER.length]!;
}

const HARBOR_ICONS: Record<HarborSummary["icon"], string> = {
  scan: icons.progress,
  stop: icons.fail,
  crate: icons.commit,
  boat: icons.push,
};
const TYPE_ICONS: Record<EventType, string> = {
  start: icons.start,
  move: icons.move,
  progress: icons.progress,
  done: icons.ok,
  fail: icons.fail,
  commit: icons.commit,
  push: icons.push,
};

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

const clock = (ts: number) => new Date(ts).toTimeString().slice(0, 8);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Rule({ width }: { width: number }) {
  return <Text dimColor>{icons.rule.repeat(Math.max(0, width))}</Text>;
}

function StatusBar({ state, mode, url, width }: { state: VillageState; mode: string; url?: string; width: number }) {
  const agents = Object.values(state.agents);
  const working = agents.filter((a) => a.status === "working").length;
  const problems = openProblems(state).length;
  const filled = Math.round(state.health * 5);
  const healthColor = state.health >= 0.8 ? theme.good : state.health >= 0.5 ? theme.warn : theme.bad;
  const healthWord = state.health >= 0.8 ? "good" : state.health >= 0.5 ? "fair" : "poor";
  return (
    <Box flexDirection="column" width={width}>
      <Box justifyContent="space-between" width={width}>
        <Text>
          <Text bold>CLI VILLAGE</Text>
          <Text dimColor>
            {" "}
            · {mode}
            {state.stopped ? " · stopped" : ""}
          </Text>
        </Text>
        <Text>
          <Text dimColor>
            {plural(agents.length, "robot")} · {working} working ·{" "}
          </Text>
          {problems > 0 ? (
            <Text color={theme.bad} bold>
              {icons.fail} {plural(problems, "problem")}
            </Text>
          ) : (
            <Text dimColor>no problems</Text>
          )}
          <Text dimColor> · health </Text>
          <Text color={healthColor}>
            {icons.full.repeat(filled)}
            {icons.empty.repeat(5 - filled)}
          </Text>
          <Text dimColor>
            {" "}
            {Math.round(state.health * 100)}% {healthWord}
          </Text>
        </Text>
      </Box>
      {url ? (
        <Text dimColor wrap="truncate-end">
          3D village: <Text color={theme.accent}>{url}</Text>
        </Text>
      ) : null}
    </Box>
  );
}

function headlineStyle(headline: Headline) {
  if (headline.level === "attention") return { icon: icons.fail, color: theme.bad };
  if (headline.level === "active") return { icon: icons.start, color: theme.accent };
  if (headline.seq === 0) return { icon: icons.idle, color: undefined };
  return { icon: icons.ok, color: theme.good };
}

/**
 * The one key message: what's happening now, or what needs attention.
 * Beginners also see the real command and a line explaining what it does.
 */
function KeyMessage({ state, width, compact, waiting }: { state: VillageState; width: number; compact: boolean; waiting?: WaitingHint }) {
  // Nothing has happened yet: suggest something to try instead.
  const idle = waiting && state.headline.seq === 0 ? waiting : undefined;
  const headline = idle ? { ...state.headline, ...idle } : state.headline;
  const style = headlineStyle(headline);
  // If something still needs attention but the headline moved on, keep a quiet reminder.
  const stillOpen = openProblems(state).find((b) => b.problem && b.problem.seq !== headline.seq);
  const reminder = stillOpen?.problem ? (
    <Text key="reminder" color={theme.bad} wrap="truncate-end">
      {"  "}
      {icons.warn} Still needs attention at the {BUILDING_NAMES[stillOpen.id]}: {stillOpen.problem.message}
    </Text>
  ) : null;
  const command = headline.command ? (
    <Text key="command" wrap="truncate-end">
      {"  "}
      <Text dimColor>{icons.arrow} </Text>
      <Text color={theme.accent}>{headline.command}</Text>
      {compact || idle ? null : <Text dimColor> (the real command)</Text>}
    </Text>
  ) : null;

  if (compact) {
    return (
      <Box flexDirection="column" paddingX={1} height={keyMessageRows(true)} width={width}>
        <Text wrap="truncate-end">
          <Text bold color={style.color}>
            {style.icon} {headline.title}
          </Text>
          {headline.subtitle ? <Text dimColor> · {headline.subtitle}</Text> : null}
        </Text>
        {command ?? reminder ?? <Text> </Text>}
      </Box>
    );
  }

  // Up to four lines. A problem reminder matters more than the explanation, so it takes its place if needed.
  const lines = [
    <Text key="title" bold color={style.color} wrap="truncate-end">
      {style.icon} {headline.title}
    </Text>,
    <Text key="subtitle" wrap="truncate-end">
      {"  "}
      {headline.subtitle ?? ""}
    </Text>,
  ];
  if (command) lines.push(command);
  if (headline.explain) {
    lines.push(
      <Text key="explain" dimColor wrap="truncate-end">
        {command ? "    " : "  "}
        {headline.explain}
      </Text>,
    );
  }
  if (reminder) {
    if (lines.length === 4) lines[3] = reminder;
    else lines.push(reminder);
  }
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} height={keyMessageRows(false)} width={width}>
      {lines}
    </Box>
  );
}

function agentRow(agent: AgentState, now: number) {
  const walking = isWalking(agent, now);
  const place = walking ? `${icons.arrow} ${BUILDING_NAMES[agent.location]}` : BUILDING_NAMES[agent.location];
  if (agent.status === "failed") {
    return { icon: icons.fail, color: theme.bad, dim: false, place, activity: `problem: ${agent.say ?? "something went wrong"}` };
  }
  if (agent.status === "working" && agent.task) {
    const pct = agent.task.percent !== undefined ? ` ${agent.task.percent}%` : "";
    return { icon: icons.start, color: theme.accent, dim: false, place, activity: `${agent.task.title}${pct}` };
  }
  if (walking) return { icon: icons.move, color: undefined, dim: true, place, activity: "walking" };
  const activity = agent.location === "home" ? "resting" : (agent.say ?? "idle");
  return { icon: icons.idle, color: undefined, dim: true, place, activity };
}

/** What the robots column shows, so the screen never scrolls: some or all robots, the harbor line, and a blank line. */
interface RobotsFit {
  /** How many robots are listed. Any more get one "+N more" row. */
  shown: number;
  harbor: boolean;
  /** A blank line: above the harbor line when side by side, under the robots when stacked. */
  gap: boolean;
}

/** Rows the robots column takes: its title, the robots (or "No robots yet."), "+N more", the harbor line and the gap. */
const robotRows = (fit: RobotsFit, agents: number) =>
  1 + Math.max(1, fit.shown) + (fit.shown < agents ? 1 : 0) + (fit.harbor ? 1 : 0) + (fit.gap ? 1 : 0);

/** Fit the robots column into `room` rows. The gap goes first, then robots, then the harbor line. */
function fitRobots(state: VillageState, room: number, wide: boolean): RobotsFit {
  const agents = Object.keys(state.agents).length;
  const harbor = describeHarbor(state) !== null;
  const tries: RobotsFit[] = [
    // Side by side, the gap only sits above the harbor line.
    { shown: agents, harbor, gap: wide ? harbor : true },
    { shown: agents, harbor, gap: false },
    // Title, the robots, "+N more" and the harbor line.
    { shown: room - 2 - (harbor ? 1 : 0), harbor, gap: false },
    { shown: room - 2, harbor: false, gap: false },
  ];
  const fits = tries.find((fit) => (fit.shown >= 1 || agents === 0) && robotRows(fit, agents) <= room) ?? tries[3]!;
  return { ...fits, shown: Math.min(agents, Math.max(1, fits.shown)) };
}

/** When not every robot fits: the ones with a problem first, then the busy ones. */
const ROBOT_ORDER: Record<AgentStatus, number> = { failed: 0, working: 1, walking: 2, idle: 3 };

function Robots({ state, now, width, fit, wide }: { state: VillageState; now: number; width: number; fit: RobotsFit; wide: boolean }) {
  const all = Object.values(state.agents);
  const agents = fit.shown < all.length ? all.toSorted((a, b) => ROBOT_ORDER[a.status] - ROBOT_ORDER[b.status]).slice(0, fit.shown) : all;
  const nameWidth = Math.min(12, Math.max(5, ...agents.map((a) => a.name.length)));
  return (
    <Box flexDirection="column" width={width}>
      <Text bold>Robots</Text>
      {agents.length === 0 ? <Text dimColor>No robots yet.</Text> : null}
      {agents.map((agent) => {
        const row = agentRow(agent, now);
        return (
          <Text key={agent.name} wrap="truncate-end" dimColor={row.dim}>
            <Text color={row.color}>{row.icon} </Text>
            <Text bold={!row.dim}>{agent.name.padEnd(nameWidth)}</Text> {row.place.padEnd(15)} {row.activity}
          </Text>
        );
      })}
      {agents.length < all.length ? <Text dimColor>+{all.length - agents.length} more</Text> : null}
      {fit.harbor ? <HarborLine state={state} spaced={wide && fit.gap} /> : null}
    </Box>
  );
}

/** The crates on their way to GitHub: at the gate, waiting at the dock, or the last boat. */
function HarborLine({ state, spaced }: { state: VillageState; spaced: boolean }) {
  const harbor = describeHarbor(state);
  if (!harbor) return null;
  const color = harbor.level === "attention" ? theme.bad : harbor.level === "active" ? theme.accent : undefined;
  // The same colors as in the ? help: a crate is yellow, the boat green.
  const iconColor = color ?? (harbor.icon === "boat" ? theme.good : theme.warn);
  return (
    <>
      {spaced ? <Text> </Text> : null}
      <Text wrap="truncate-end" dimColor={harbor.icon === "boat"}>
        <Text color={iconColor}>{HARBOR_ICONS[harbor.icon]} </Text>
        <Text bold>{"Harbor".padEnd(6)}</Text>{" "}
        <Text color={color} bold={harbor.level === "attention"}>
          {harbor.text}
        </Text>
      </Text>
    </>
  );
}

function ActivityLine({ entry }: { entry: LogEntry }) {
  const icon = TYPE_ICONS[entry.type];
  if (entry.emphasis === "primary") {
    return (
      <Text wrap="truncate-end" color={theme.bad} bold>
        {clock(entry.ts)} {icon} {entry.text}
      </Text>
    );
  }
  return (
    <Text wrap="truncate-end" dimColor={entry.emphasis === "tertiary"}>
      <Text dimColor>{clock(entry.ts)}</Text> {icon} {entry.text}
    </Text>
  );
}

function Activity({ state, lines, details, width }: { state: VillageState; lines: number; details: boolean; width: number }) {
  const entries = (details ? state.log : state.log.filter((e) => e.emphasis !== "tertiary")).slice(-Math.max(1, lines));
  return (
    <Box flexDirection="column" width={width}>
      <Text>
        <Text bold>What's happening</Text>
        <Text dimColor>{details ? " (all details)" : " (summary)"}</Text>
      </Text>
      {entries.length === 0 ? <Text dimColor>Nothing yet.</Text> : null}
      {entries.map((entry) => (
        <ActivityLine key={entry.seq} entry={entry} />
      ))}
    </Box>
  );
}

/** One building up close (Tab): what it's for, how it's doing, and its own log. Like clicking it in the 3D village. */
function BuildingLog({ state, id, lines, details, width }: { state: VillageState; id: Building; lines: number; details: boolean; width: number }) {
  const b = state.buildings[id];
  const harbor = id === "harbor" ? describeHarbor(state) : null;
  const status = b.problem
    ? { icon: icons.fail, color: theme.bad, text: `Needs attention: ${b.problem.message}` }
    : b.working.length
      ? { icon: icons.start, color: theme.accent, text: `Working here: ${b.working.join(", ")}` }
      : { icon: icons.idle, color: undefined, text: "Quiet right now" };
  const room = Math.max(1, lines - 1 - (harbor ? 1 : 0));
  const entries = (details ? b.log : b.log.filter((e) => e.emphasis !== "tertiary")).slice(-room);
  return (
    <Box flexDirection="column" width={width}>
      <Text wrap="truncate-end">
        <Text bold color={theme.gold}>
          {BUILDING_NAMES[id]}
        </Text>
        <Text dimColor> · {BUILDING_HELP[id]}</Text>
      </Text>
      <Text wrap="truncate-end" color={status.color} bold={Boolean(b.problem)} dimColor={!b.problem && !b.working.length}>
        {status.icon} {status.text}
      </Text>
      {harbor ? (
        <Text wrap="truncate-end" color={harbor.level === "attention" ? theme.bad : undefined}>
          {HARBOR_ICONS[harbor.icon]} {harbor.text}
        </Text>
      ) : null}
      {entries.length === 0 ? <Text dimColor>Nothing has happened here yet.</Text> : null}
      {entries.map((entry) => (
        <ActivityLine key={entry.seq} entry={entry} />
      ))}
    </Box>
  );
}

const SYMBOLS_TEXT_LENGTH = 98; // how long the Symbols line is on one row
const WORD_WIDTH = Math.max(...GLOSSARY.map((g) => g.word.length)) + 2;
const MEANING_WIDTH = Math.max(...GLOSSARY.map((g) => g.meaning.length)) + 2;

const robotSymbols = (
  <>
    <Text color={theme.accent}>{icons.start}</Text> working <Text color={theme.bad}>{icons.fail}</Text> problem{" "}
    <Text color={theme.good}>{icons.ok}</Text> done {icons.move} walking {icons.idle} resting
  </>
);
const crateSymbols = (
  <>
    <Text color={theme.warn}>{icons.commit}</Text> commit (a crate) <Text color={theme.good}>{icons.push}</Text> push (the boat
    sails)
  </>
);

/** The ? help: what the buildings, words and symbols mean. `rows` is how much room it has. */
function HelpOverlay({ width, rows }: { width: number; rows: number }) {
  const inner = width - 4;
  // The symbols fit on one row in wide terminals; otherwise they split neatly into two.
  const symbolRows = inner >= SYMBOLS_TEXT_LENGTH ? 1 : 2;
  // Words sit two to a row when there's room.
  const perRow = inner >= (WORD_WIDTH + MEANING_WIDTH) * 2 ? 2 : 1;
  const wordRows = Math.ceil(GLOSSARY.length / perRow);
  const baseRows = 1 + HELP_ORDER.length + 1 + symbolRows + 1 + 2;
  const showWords = baseRows + 1 + wordRows + 1 <= rows;
  const wordLines: (typeof GLOSSARY)[number][][] = [];
  for (let i = 0; i < GLOSSARY.length; i += perRow) wordLines.push(GLOSSARY.slice(i, i + perRow));

  return (
    <Box flexDirection="column" paddingX={2} width={width}>
      <Text bold>What the buildings mean</Text>
      {HELP_ORDER.map((id) => (
        <Text key={id} wrap="truncate-end">
          <Text bold color={theme.gold}>
            {BUILDING_NAMES[id].padEnd(15)}
          </Text>
          {BUILDING_HELP[id]}
        </Text>
      ))}
      <Text> </Text>
      {showWords ? (
        <>
          <Text bold>Words you'll see</Text>
          {wordLines.map((line) => (
            <Text key={line[0]!.word} wrap="truncate-end">
              {line.map((g) => (
                <Text key={g.word}>
                  <Text bold>{g.word.padEnd(WORD_WIDTH)}</Text>
                  {g.meaning.padEnd(MEANING_WIDTH)}
                </Text>
              ))}
            </Text>
          ))}
          <Text> </Text>
        </>
      ) : null}
      {symbolRows === 1 ? (
        <Text>
          <Text bold>Symbols </Text> {robotSymbols} {crateSymbols}
        </Text>
      ) : (
        <>
          <Text wrap="truncate-end">
            <Text bold>Symbols </Text> {robotSymbols}
          </Text>
          <Text wrap="truncate-end">
            {"         "}
            {crateSymbols}
          </Text>
        </>
      )}
      <Text> </Text>
      <Text dimColor wrap="truncate-end">
        Secret values are never shown anywhere. Only key names and counts.
      </Text>
      <Text dimColor wrap="truncate-end">
        Experts: {EXPERT_FLAGS} (see --help)
      </Text>
    </Box>
  );
}

function KeyHints({
  help,
  details,
  focus,
  finished,
  stopping,
  compact,
}: {
  help: boolean;
  details: boolean;
  focus: Building | null;
  finished: boolean;
  stopping: boolean;
  compact: boolean;
}) {
  if (stopping) return <Text dimColor>Stopping… everyone walks home. (press q again to quit now)</Text>;
  return (
    <Text wrap="truncate-end">
      {finished ? <Text color={theme.good}>Finished. </Text> : null}
      <Text bold>q</Text>
      <Text dimColor> quit · </Text>
      <Text bold>?</Text>
      <Text dimColor>{help ? " close help · " : compact || focus ? " help · " : " what the buildings mean · "}</Text>
      <Text bold>d</Text>
      <Text dimColor>{compact ? " details · " : details ? " less detail · " : " more detail · "}</Text>
      <Text bold>tab</Text>
      <Text dimColor>{focus ? " next building" : compact ? " building" : " one building"}</Text>
      {focus && !help ? (
        <>
          <Text dimColor> · </Text>
          <Text bold>esc</Text>
          <Text dimColor> everything</Text>
        </>
      ) : null}
    </Text>
  );
}

export function App({ store, mode, url, onStop, compact = false, size, waiting, focus: initialFocus }: AppProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const windowSize = useWindowSize();
  const columns = size?.columns ?? (windowSize.columns || 80);
  const rows = size?.rows ?? (windowSize.rows || 24);
  const now = useNow(500);
  const { exit } = useApp();
  // Keep the latest exit function without restarting timers on every redraw.
  const exitRef = useRef(exit);
  exitRef.current = exit;
  const [help, setHelp] = useState(false);
  const [details, setDetails] = useState(false);
  const [stopping, setStopping] = useState(false);
  /** The building you're looking at up close (Tab), or null for everything. */
  const [focus, setFocus] = useState<Building | null>(initialFocus ?? null);

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      if (stopping || state.stopped) exit();
      else {
        setStopping(true);
        onStop();
      }
      return;
    }
    if (input === "?") setHelp((open) => !open);
    else if (key.escape) {
      // Esc closes the help first, then goes back from one building to everything.
      if (help) setHelp(false);
      else setFocus(null);
    } else if (input === "d") setDetails((more) => !more);
    else if (key.tab) {
      setHelp(false);
      setFocus((current) => nextBuilding(current, key.shift ? -1 : 1));
    }
  });

  // After you press q: give the robots a moment to head home, then close.
  useEffect(() => {
    if (!stopping || !state.stopped) return;
    const timer = setTimeout(() => exitRef.current(), 900);
    return () => clearTimeout(timer);
  }, [stopping, state.stopped]);

  const width = Math.max(40, columns);
  const wide = width >= 100;
  // Rows used by everything except the main area: status bar, rules, key message, key hints, +1 spare so the screen never scrolls.
  const chrome = 1 + (url ? 1 : 0) + 1 + 1 + 1 + 1;
  const fixed = chrome + keyMessageRows(compact) + 1;
  const bodyRows = Math.max(4, rows - fixed);
  // Side by side, each column gets the full height. Stacked, the robots share it with the
  // log, which keeps its title and at least MIN_LOG_LINES lines.
  const agents = Object.keys(state.agents).length;
  const fit = fitRobots(state, wide ? bodyRows : bodyRows - 1 - MIN_LOG_LINES, wide);
  const activityLines = wide ? bodyRows - 1 : Math.max(1, bodyRows - robotRows(fit, agents) - 1);
  const leftWidth = wide ? Math.floor(width * 0.45) : width;
  const log = focus ? (
    <BuildingLog state={state} id={focus} lines={activityLines} details={details} width={wide ? width - leftWidth - 2 : width} />
  ) : (
    <Activity state={state} lines={activityLines} details={details} width={wide ? width - leftWidth - 2 : width} />
  );

  return (
    <Box flexDirection="column" width={width}>
      <StatusBar state={state} mode={mode} url={url} width={width} />
      <Rule width={width} />
      {help ? (
        <HelpOverlay width={width} rows={rows - chrome} />
      ) : (
        <>
          <KeyMessage state={state} width={width} compact={compact} waiting={waiting} />
          <Rule width={width} />
          {wide ? (
            <Box flexDirection="row" width={width} height={bodyRows}>
              <Robots state={state} now={now} width={leftWidth} fit={fit} wide />
              <Box
                borderStyle={icons.vrule === "│" ? "single" : "classic"}
                borderTop={false}
                borderRight={false}
                borderBottom={false}
                borderDimColor
                paddingLeft={1}
                width={width - leftWidth}
              >
                {log}
              </Box>
            </Box>
          ) : (
            <Box flexDirection="column" width={width} height={bodyRows}>
              <Robots state={state} now={now} width={width} fit={fit} wide={false} />
              {fit.gap ? <Text> </Text> : null}
              {log}
            </Box>
          )}
        </>
      )}
      <Rule width={width} />
      <KeyHints help={help} details={details} focus={focus} finished={state.stopped && !stopping} stopping={stopping} compact={compact} />
    </Box>
  );
}
