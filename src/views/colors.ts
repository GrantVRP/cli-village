// The colours of CLI Village's windows and panels: the desktop app, the browser page and the
// terminal view. (The 3D village's own colours, from the art direction, are in web/src/palette.ts.)
//
// The rules, so the look stays calm and readable rather than "neon on black":
//   - Surfaces are near-neutral (chroma ≤ 0.02 in OKLCH) and get lighter as they come forward:
//     the frame (bg) < side bar and Guide (bg2) < the work area (bg3) < menus and inputs (bg4).
//   - Text has three tiers, all the village's own colours: cream, warm grey, stone. Even the
//     quietest one (dim) passes WCAG AA (4.5:1) on every surface.
//   - One accent, a lantern gold, used only for focus, selection and the main action.
//   - Status colours (moss, clay, brick, slate) always come with an icon and a word.
//
// Day is stone and wood (warm, hue ~70); night is a slate blue (hue ~262) that matches the
// village's dusk and night sky. The window mixes the two by how dark the village is: dusk, the
// default, is 85% night. test/colors.test.mjs checks the contrast at day, dusk and night.

export interface Shade {
  /** The frame: title bar, activity bar, tab strip, status bar. */
  bg: string;
  /** Side bar and Guide: they recede. */
  bg2: string;
  /** The work area: the village, the logs, Welcome, the terminal. */
  bg3: string;
  /** Things on top: menus, the command palette, dialogs, inputs. */
  bg4: string;
  /** Dividers, "felt, not seen". */
  line: string;
  /** Borders of controls (3:1 or more against the work area). */
  line2: string;
  text: string;
  muted: string;
  dim: string;
  accent: string;
  /** A quiet fill for selected things. */
  accentMuted: string;
  bar: string;
  barLine: string;
  barText: string;
}

export const DAY: Shade = {
  bg: "#120f0b",
  bg2: "#1d1914",
  bg3: "#27221d",
  bg4: "#322d27",
  line: "#39342f",
  line2: "#746e67",
  text: "#ede6d6",
  muted: "#c9c3b5",
  dim: "#a49e90",
  accent: "#ddb872",
  accentMuted: "#40331d",
  bar: "#1a1612",
  barLine: "#322d27",
  barText: "#d0cabe",
};

export const NIGHT: Shade = {
  bg: "#0a0f17",
  bg2: "#141821",
  bg3: "#1c222b",
  bg4: "#272d36",
  line: "#2f353e",
  line2: "#676d79",
  text: "#ede6d6",
  muted: "#c9c3b5",
  dim: "#a49e90",
  accent: "#e2ba76",
  accentMuted: "#40331d",
  bar: "#12161f",
  barLine: "#272d36",
  barText: "#d0cabe",
};

/** For icons and short labels, not paragraphs. */
export const STATUS = {
  success: "#9abe87", // moss
  warning: "#e3a06c", // clay: not the accent's gold, so a warning never looks like a selection
  danger: "#e78b7c", // brick
  info: "#97b5cf", // dusk slate
};

/** The terminal's 16 colours: muted, none above chroma 0.12, all 4.5:1 or more on the work area. */
export const TERMINAL = {
  black: "#39342f",
  red: "#e78b7c",
  green: "#9abe87",
  yellow: "#ddb872",
  blue: "#88accf",
  magenta: "#c896b7",
  cyan: "#8cc0bc",
  white: "#d3cdc3",
  brightBlack: "#928b82",
  brightRed: "#f59d8b",
  brightGreen: "#b1d89d",
  brightYellow: "#f0d592",
  brightBlue: "#a3c5e6",
  brightMagenta: "#e1b0cf",
  brightCyan: "#a5dad6",
  brightWhite: "#f5f1ea",
};

/** How dark the village is at dusk, the desktop app's default light. */
export const DUSK = 0.85;

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (values: number[]) => `#${values.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** One colour between a and b (0 = a, 1 = b), mixed in sRGB like CSS transitions do. */
export function mixHex(a: string, b: string, k: number): string {
  const t = Math.min(1, Math.max(0, Number.isFinite(k) ? k : 0));
  const x = channels(a);
  const y = channels(b);
  return toHex(x.map((v, i) => v + (y[i]! - v) * t));
}

/** The window's colours when the village is this dark (0 = day, 1 = night). */
export function shadeAt(k: number): Shade {
  const out = {} as Shade;
  for (const key of Object.keys(DAY) as (keyof Shade)[]) out[key] = mixHex(DAY[key], NIGHT[key], k);
  return out;
}

/** CSS variable names for each colour (`--bg-2`, `--accent-muted`…). */
export const CSS_NAMES: Record<keyof Shade, string> = {
  bg: "bg",
  bg2: "bg-2",
  bg3: "bg-3",
  bg4: "bg-4",
  line: "line",
  line2: "line-2",
  text: "text",
  muted: "muted",
  dim: "dim",
  accent: "accent",
  accentMuted: "accent-muted",
  bar: "bar",
  barLine: "bar-line",
  barText: "bar-text",
};
