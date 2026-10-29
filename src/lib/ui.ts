// How much CLI Village says, set by the expert flags. Every command gets one of these.
//
//   (default)       beginner-friendly: each step in plain English, the real
//                   command, and a line explaining what that command does
//   --compact       the same facts in fewer lines, no explanations
//   --quiet         only results and problems (problems go to stderr)
//   --json          machine-readable output on stdout, for scripts
//   --no-animation  nothing moves: plain lines instead of the live screen,
//                   and a still 3D village
//
// If you combine them, --json beats --quiet, which beats --compact.

export type Detail = "full" | "compact" | "quiet";

export interface Ui {
  json: boolean;
  detail: Detail;
  animation: boolean;
}

export interface UiFlags {
  json?: boolean;
  quiet?: boolean;
  compact?: boolean;
  animation?: boolean;
}

export function makeUi(flags: UiFlags = {}): Ui {
  return {
    json: flags.json === true,
    detail: flags.quiet ? "quiet" : flags.compact ? "compact" : "full",
    animation: flags.animation !== false,
  };
}

/** The default: friendly and full of explanations. */
export const DEFAULT_UI: Ui = makeUi();

/** Shows each explanation only the first time, so a long log teaches without nagging. */
export function teachOnce(): (explanation: string | undefined) => string | undefined {
  const taught = new Set<string>();
  return (explanation) => {
    if (!explanation || taught.has(explanation)) return undefined;
    taught.add(explanation);
    return explanation;
  };
}
