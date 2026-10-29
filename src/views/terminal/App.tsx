// The terminal view, drawn with Ink (React for the terminal).
//
// Layout, top to bottom (most important first):
//   status bar · the ONE key message · robots | what's happening · key hints

import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  isWalking,
  openProblems,
  type AgentState,
  type Headline,
  type LogEntry,
  type VillageState,
} from "../../events/state.js";
import { EXPERT_FLAGS, GLOSSARY } from "../../events/explain.js";
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
}

export interface WaitingHint {
  subtitle: string;
  command: string;
  explain: string;
}

/** Rows the key message takes: title, subtitle, command, explanation, plus a blank line above and below. */
const keyMessageRows = (compact: boolean) => (compact ? 2 : 6);

const HELP_ORDER: Building[] = ["vault", "library", "workshop", "lab", "townhall", "home", "harbor"];
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

function Robots({ state, now, width }: { state: VillageState; now: number; width: number }) {
  const agents = Object.values(state.agents);
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
    </Box>
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
  finished,
  stopping,
  compact,
}: {
  help: boolean;
  details: boolean;
  finished: boolean;
  stopping: boolean;
  compact: boolean;
}) {
  if (stopping) return <Text dimColor>Stopping… everyone walks home. (press q again to quit now)</Text>;
  return (
    <Text>
      {finished ? <Text color={theme.good}>Finished. </Text> : null}
      <Text bold>q</Text>
      <Text dimColor> quit · </Text>
      <Text bold>?</Text>
      <Text dimColor>{help ? " close help · " : compact ? " help · " : " what do the buildings mean? · "}</Text>
      <Text bold>d</Text>
      <Text dimColor>{compact ? " details" : details ? " less detail" : " more detail"}</Text>
    </Text>
  );
}

export function App({ store, mode, url, onStop, compact = false, size, waiting }: AppProps) {
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
    else if (key.escape) setHelp(false);
    else if (input === "d") setDetails((more) => !more);
  });

  // After you press q: give the robots a moment to head home, then close.
  useEffect(() => {
    if (!stopping || !state.stopped) return;
    const timer = setTimeout(() => exitRef.current(), 900);
    return () => clearTimeout(timer);
  }, [stopping, state.stopped]);

  const width = Math.max(40, columns);
  const wide = width >= 100;
  const agentCount = Object.keys(state.agents).length;
  // Rows used by everything except the main area: status bar, rules, key message, key hints, +1 spare so the screen never scrolls.
  const chrome = 1 + (url ? 1 : 0) + 1 + 1 + 1 + 1;
  const fixed = chrome + keyMessageRows(compact) + 1;
  const bodyRows = Math.max(4, rows - fixed);
  const activityLines = wide ? bodyRows - 1 : Math.max(3, bodyRows - (agentCount + 2) - 1);
  const leftWidth = wide ? Math.floor(width * 0.45) : width;

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
              <Robots state={state} now={now} width={leftWidth} />
              <Box
                borderStyle={icons.vrule === "│" ? "single" : "classic"}
                borderTop={false}
                borderRight={false}
                borderBottom={false}
                borderDimColor
                paddingLeft={1}
                width={width - leftWidth}
              >
                <Activity state={state} lines={activityLines} details={details} width={width - leftWidth - 2} />
              </Box>
            </Box>
          ) : (
            <Box flexDirection="column" width={width} height={bodyRows}>
              <Robots state={state} now={now} width={width} />
              <Text> </Text>
              <Activity state={state} lines={activityLines} details={details} width={width} />
            </Box>
          )}
        </>
      )}
      <Rule width={width} />
      <KeyHints help={help} details={details} finished={state.stopped && !stopping} stopping={stopping} compact={compact} />
    </Box>
  );
}
