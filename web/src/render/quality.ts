// How much the village's renderer may do on this computer.
//
// Three tiers. The renderer starts at the best tier the graphics hardware suggests, then
// watches its own frame times and steps down (never up) if the frames run slow, so a laptop
// on battery or a computer with no graphics card at all (software rendering, as on CI
// machines) still gets a smooth village. `?quality=low|medium|high` in the page address
// overrides the guess.
//
// This file has no imports, so the tests can load it directly.

export type Tier = "low" | "medium" | "high";

export const TIERS: readonly Tier[] = ["low", "medium", "high"];

export interface TierSettings {
  /** Upper limit for the device pixel ratio. */
  maxPixelRatio: number;
  /** Multisampling for the scene's render target (0 = none). */
  msaa: number;
  /** Shadow map size in texels (square). */
  shadowMap: number;
  /** Samples per pixel for the soft, contact-hardening shadows (0 = the built-in PCF filter). */
  shadowSamples: number;
  /** Screen-space ambient occlusion (GTAO). */
  ambientOcclusion: boolean;
  /** Bloom around lights, at this fraction of the screen's resolution (0 = off). */
  bloom: number;
  /** Samples per pixel for the depth-of-field blur (0 = a cheap screen-band blur). */
  bokehSamples: number;
  /** Sky reflections on water and brass (a prefiltered environment map). */
  environment: boolean;
  /** Real point lights in the lamps at night (the cheaper tiers fake the light pools). */
  lampLights: boolean;
}

export const SETTINGS: Readonly<Record<Tier, TierSettings>> = {
  low: { maxPixelRatio: 1, msaa: 0, shadowMap: 2048, shadowSamples: 0, ambientOcclusion: false, bloom: 0, bokehSamples: 0, environment: false, lampLights: false },
  medium: { maxPixelRatio: 1.5, msaa: 4, shadowMap: 2048, shadowSamples: 12, ambientOcclusion: false, bloom: 0.5, bokehSamples: 24, environment: true, lampLights: false },
  high: { maxPixelRatio: 2, msaa: 4, shadowMap: 4096, shadowSamples: 20, ambientOcclusion: true, bloom: 0.5, bokehSamples: 48, environment: true, lampLights: true },
};

/** Software renderers: no graphics card, every pixel is drawn by the processor. */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|microsoft basic render|\bwarp\b|software/i;
/** Graphics built into the processor: fine, but not for everything at full resolution. */
const INTEGRATED = /intel|uhd|iris|mali|adreno|powervr|apple gpu|vivante|videocore|radeon\(tm\) graphics|radeon graphics|vega \d+ graphics/i;

/** The starting tier for a WebGL renderer name (from WEBGL_debug_renderer_info), or for none. */
export function tierForRenderer(name: string | null | undefined): Tier {
  if (!name) return "medium";
  if (SOFTWARE.test(name)) return "low";
  // Apple's own chips (M1 and later) are fast; older Intel Macs report "Intel".
  if (/apple m\d/i.test(name)) return "high";
  if (INTEGRATED.test(name)) return "medium";
  return "high";
}

/** The tier asked for in the page address (`?quality=`), if it's a real one. */
export function tierFromQuery(value: string | null | undefined): Tier | null {
  const v = value?.trim().toLowerCase();
  return v === "low" || v === "medium" || v === "high" ? v : null;
}

/** One tier lower, or the same when already at the bottom. */
export function lower(tier: Tier): Tier {
  return TIERS[Math.max(0, TIERS.indexOf(tier) - 1)]!;
}

/**
 * Watches frame times and says when to step down a tier.
 *
 * It ignores the first frames after a start or a change (shaders compile, textures upload),
 * looks at the median of a window of frames (one slow frame shouldn't matter), and only
 * ever steps down, so the picture never flickers between two tiers.
 */
export class FrameBudget {
  private readonly samples: number[] = [];
  /** A frame slower than this (milliseconds) counts as slow. 22 ms is about 45 frames a second. */
  private readonly budgetMs: number;
  /** How many frames to judge at once. */
  private readonly window: number;
  /** Frames to ignore after starting or changing tier. */
  private readonly warmup: number;
  private skip: number;

  // (Plain fields, not TypeScript's constructor shorthand, so Node can run this file as-is.)
  constructor(budgetMs = 22, window = 90, warmup = 60) {
    this.budgetMs = budgetMs;
    this.window = window;
    this.warmup = warmup;
    this.skip = warmup;
  }

  /** Forget everything (after a tier change, or after the page was hidden). */
  reset(): void {
    this.samples.length = 0;
    this.skip = this.warmup;
  }

  /** Add one frame's time. Returns true when the recent frames were too slow. */
  add(frameMs: number): boolean {
    if (!Number.isFinite(frameMs) || frameMs <= 0) return false;
    // A very long gap is the page being hidden or the computer sleeping, not a slow frame.
    if (frameMs > 1000) {
      this.reset();
      return false;
    }
    if (this.skip > 0) {
      this.skip--;
      return false;
    }
    this.samples.push(frameMs);
    if (this.samples.length < this.window) return false;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    this.samples.length = 0;
    return median > this.budgetMs;
  }
}
