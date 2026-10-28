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
  /** Fixed size, for tests. Normally the terminal's own size is used. */
  size?: { columns: number; rows: number };
}

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

/** The one key message: what's happening now, or what needs attention. */
function KeyMessage({ state, width }: { state: VillageState; width: number }) {
  const { headline } = state;
  const style = headlineStyle(headline);
  // If something still needs attention but the headline moved on, keep a quiet reminder.
  const stillOpen = openProblems(state).find((b) => b.problem && b.problem.seq !== headline.seq);
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} height={5} width={width}>
      <Text bold color={style.color} wrap="truncate-end">
        {style.icon} {headline.title}
      </Text>
      <Text wrap="truncate-end">
        {"  "}
        {headline.subtitle ?? ""}
      </Text>
      {headline.command ? (
        <Text wrap="truncate-end">
          {"  "}
          <Text dimColor>{icons.arrow} </Text>
          <Text color={theme.accent}>{headline.command}</Text>
          <Text dimColor> (the real command)</Text>
        </Text>
      ) : stillOpen?.problem ? (
        <Text color={theme.bad} wrap="truncate-end">
          {"  "}
          {icons.warn} Still needs attention at the {BUILDING_NAMES[stillOpen.id]}: {stillOpen.problem.message}
        </Text>
      ) : (
        <Text> </Text>
      )}
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

function HelpOverlay({ width }: { width: number }) {
  return (
    <Box flexDirection="column" paddingX={2} width={width}>
      <Text bold>What the buildings mean</Text>
      <Text> </Text>
      {HELP_ORDER.map((id) => (
        <Text key={id} wrap="truncate-end">
          <Text bold color={theme.gold}>
            {BUILDING_NAMES[id].padEnd(15)}
          </Text>
          {BUILDING_HELP[id]}
        </Text>
      ))}
      <Text> </Text>
      <Text bold>Symbols</Text>
      <Text>
        <Text color={theme.accent}>{icons.start}</Text> working <Text color={theme.bad}>{icons.fail}</Text> problem{" "}
        <Text color={theme.good}>{icons.ok}</Text> done {icons.move} walking {icons.idle} resting{" "}
        <Text color={theme.warn}>{icons.commit}</Text> commit (a crate) <Text color={theme.good}>{icons.push}</Text> push (the
        boat sails)
      </Text>
      <Text> </Text>
      <Text dimColor>Secret values are never shown anywhere. Only key names and counts.</Text>
    </Box>
  );
}

function KeyHints({ help, details, finished, stopping }: { help: boolean; details: boolean; finished: boolean; stopping: boolean }) {
  if (stopping) return <Text dimColor>Stopping… everyone walks home. (press q again to quit now)</Text>;
  return (
    <Text>
      {finished ? <Text color={theme.good}>Finished. </Text> : null}
      <Text bold>q</Text>
      <Text dimColor> quit · </Text>
      <Text bold>?</Text>
      <Text dimColor>{help ? " close help · " : " what do the buildings mean? · "}</Text>
      <Text bold>d</Text>
      <Text dimColor>{details ? " less detail" : " more detail"}</Text>
    </Text>
  );
}

export function App({ store, mode, url, onStop, size }: AppProps) {
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
  // Rows used by everything except the activity list.
  const fixed = 1 + (url ? 1 : 0) + 1 + 5 + 1 + 1 + 1 + 1; // +1 spare so the screen never scrolls
  const bodyRows = Math.max(4, rows - fixed);
  const activityLines = wide ? bodyRows - 1 : Math.max(3, bodyRows - (agentCount + 2) - 1);
  const leftWidth = wide ? Math.floor(width * 0.45) : width;

  return (
    <Box flexDirection="column" width={width}>
      <StatusBar state={state} mode={mode} url={url} width={width} />
      <Rule width={width} />
      {help ? (
        <HelpOverlay width={width} />
      ) : (
        <>
          <KeyMessage state={state} width={width} />
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
      <KeyHints help={help} details={details} finished={state.stopped && !stopping} stopping={stopping} />
    </Box>
  );
}
