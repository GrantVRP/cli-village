// Colors and symbols for the terminal view.
// Colors switch off with NO_COLOR; symbols fall back to plain ones on old consoles.
// Meaning never depends on color alone: every state also has an icon and words.

import { symbols } from "../../lib/style.js";
import { DAY, STATUS } from "../colors.js";

const noColor = Boolean(process.env.NO_COLOR);

/** Returns the color, or undefined when colors are off. */
export const color = (name: string): string | undefined => (noColor ? undefined : name);

// Named colours use the person's own terminal theme; the hex ones (the same as the desktop
// app's, src/views/colors.ts) are turned into the nearest colour on terminals with fewer colours.
export const theme = {
  /** Working, like the cyan rings over a busy building in the 3D village. */
  active: color("cyan"),
  good: color("green"),
  /** Clay, so a warning doesn't look like the gold of a building's name. (On terminals with
   *  only 16 colours both become yellow; the icon and the words still tell them apart.) */
  warn: color(STATUS.warning),
  bad: color("red"),
  /** Building names: the lantern gold of the desktop app. */
  gold: color(DAY.accent),
};

export const icons = {
  ...symbols,
  idle: symbols.skip === "–" ? "○" : "o",
  rule: symbols.skip === "–" ? "─" : "-",
  vrule: symbols.skip === "–" ? "│" : "|",
  full: symbols.skip === "–" ? "■" : "#",
  empty: symbols.skip === "–" ? "□" : ".",
};
