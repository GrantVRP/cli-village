// Colors and symbols for the terminal view.
// Colors switch off with NO_COLOR; symbols fall back to plain ones on old consoles.
// Meaning never depends on color alone: every state also has an icon and words.

import { symbols } from "../../lib/style.js";

const noColor = Boolean(process.env.NO_COLOR);

/** Returns the color, or undefined when colors are off. */
export const color = (name: string): string | undefined => (noColor ? undefined : name);

export const theme = {
  accent: color("cyan"),
  good: color("green"),
  warn: color("yellow"),
  bad: color("red"),
  gold: color("#C9A25A"),
};

export const icons = {
  ...symbols,
  idle: symbols.skip === "–" ? "○" : "o",
  rule: symbols.skip === "–" ? "─" : "-",
  vrule: symbols.skip === "–" ? "│" : "|",
  full: symbols.skip === "–" ? "■" : "#",
  empty: symbols.skip === "–" ? "□" : ".",
};
