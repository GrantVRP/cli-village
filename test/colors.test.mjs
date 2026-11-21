// The window colours (src/views/colors.ts): readable at every light, calm, and the same in
// every place that uses them. Contrast is measured as WCAG 2.2 defines it, at day, at dusk
// (the desktop app's default, a mix of the two) and at night.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dist } from "./helpers.mjs";

const { DAY, NIGHT, STATUS, TERMINAL, DUSK, shadeAt, mixHex, CSS_NAMES } = await import(dist("views/colors.js"));

const channel = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const luminance = (hex) => {
  const [r, g, b] = rgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** OKLCH chroma: how colourful (0 = grey; neon greens and limes are about 0.2). */
const chroma = (hex) => {
  const [r, g, b] = rgb(hex).map(channel);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return Math.hypot(1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s);
};

const LIGHTS = { day: 0, dusk: DUSK, night: 1 };

describe("window colours", () => {
  for (const [name, k] of Object.entries(LIGHTS)) {
    const s = shadeAt(k);
    const surfaces = [s.bg, s.bg2, s.bg3, s.bg4, s.bar];

    it(`text is readable on every surface at ${name}`, () => {
      for (const surface of surfaces) {
        assert.ok(contrast(s.text, surface) >= 7, `text on ${surface}: ${contrast(s.text, surface).toFixed(2)}`);
        assert.ok(contrast(s.muted, surface) >= 4.5, `muted on ${surface}: ${contrast(s.muted, surface).toFixed(2)}`);
        assert.ok(contrast(s.dim, surface) >= 4.5, `dim on ${surface}: ${contrast(s.dim, surface).toFixed(2)}`);
      }
      assert.ok(contrast(s.barText, s.bar) >= 7);
      assert.ok(contrast(s.text, s.accentMuted) >= 7, "text on a selected row");
    });

    it(`the accent, borders and status colours stand out enough at ${name}`, () => {
      // WCAG 1.4.11: focus rings and control borders need 3:1 against what's next to them.
      assert.ok(contrast(s.accent, s.bg3) >= 3 && contrast(s.accent, s.bg2) >= 3, "the focus ring");
      assert.ok(contrast(s.line2, s.bg3) >= 3, "control borders on the work area");
      assert.ok(contrast(s.bg, s.accent) >= 7, "text on the main button");
      for (const [status, color] of Object.entries(STATUS)) {
        for (const surface of [s.bg2, s.bg3, s.bg4]) assert.ok(contrast(color, surface) >= 4.5, `${status} on ${surface}`);
      }
    });

    it(`surfaces step lighter as they come forward at ${name}`, () => {
      assert.ok(luminance(s.bg) < luminance(s.bg2) && luminance(s.bg2) < luminance(s.bg3) && luminance(s.bg3) < luminance(s.bg4));
      // The work area must stand apart from the frame (JetBrains' rule for its "islands" is 1.2:1).
      assert.ok(contrast(s.bg3, s.bg) >= 1.2, `work area on frame: ${contrast(s.bg3, s.bg).toFixed(2)}`);
    });
  }

  it("is calm: near-grey surfaces, one gentle accent, nothing neon", () => {
    for (const shade of [DAY, NIGHT]) {
      for (const key of ["bg", "bg2", "bg3", "bg4", "line", "line2", "bar"]) assert.ok(chroma(shade[key]) <= 0.022, `${key} ${shade[key]}: ${chroma(shade[key]).toFixed(3)}`);
      assert.ok(chroma(shade.accent) <= 0.11);
    }
    for (const color of [...Object.values(STATUS), ...Object.values(TERMINAL)]) assert.ok(chroma(color) <= 0.125, `${color}: ${chroma(color).toFixed(3)}`);
  });

  it("gives every terminal colour 4.5:1 on the terminal's background, except black", () => {
    for (const k of Object.values(LIGHTS)) {
      for (const [name, color] of Object.entries(TERMINAL)) {
        if (name === "black") continue;
        assert.ok(contrast(color, shadeAt(k).bg3) >= 4.5, `${name} at ${k}: ${contrast(color, shadeAt(k).bg3).toFixed(2)}`);
      }
    }
  });

  it("mixes like a CSS transition and treats nonsense as day", () => {
    assert.equal(mixHex("#000000", "#ffffff", 0.5), "#808080");
    assert.deepEqual(shadeAt(0), DAY);
    assert.deepEqual(shadeAt(1), NIGHT);
    assert.deepEqual(shadeAt(-2), DAY);
    assert.deepEqual(shadeAt(Number.NaN), DAY);
  });

  // The stylesheets paint once before any code runs: they must start on the same colours.
  for (const file of ["app/src/style.css", "web/src/style.css"]) {
    it(`${file} starts on the dusk colours`, () => {
      const css = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
      const dusk = shadeAt(DUSK);
      for (const [key, name] of Object.entries(CSS_NAMES)) {
        const value = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})\\s*;`, "i").exec(root)?.[1];
        assert.equal(value?.toLowerCase(), dusk[key], `--${name}`);
      }
    });
  }
});
