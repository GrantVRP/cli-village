// The village's light over a day, as one table.
//
// `k` runs from 0 (midday) to 1 (night); 0.85 is the desktop app's default, a low sunset.
// Every value that depends on the time of day (sun, sky, fog, lamps, exposure) comes from
// these keyframes, so the sky, the light on the buildings and the haze in the distance
// always agree. Colours are blended in linear light, like the renderer works, so a sunset
// passes through warm oranges instead of muddy greys.
//
// This file has no imports, so the tests can load it directly.

export interface Lighting {
  /** The sun (or moon) direction's height above the horizon, in degrees. */
  sunElevation: number;
  /** Its compass direction, in degrees (0 = behind the camera's home view, to the right). */
  sunAzimuth: number;
  sunColor: number;
  sunIntensity: number;
  /** Fill light from the sky above and the ground below. */
  skyFill: number;
  groundFill: number;
  fillIntensity: number;
  /** The sky dome: straight up, at the horizon, and the glow around the sun. */
  zenith: number;
  horizon: number;
  sunGlow: number;
  /** Haze in the distance and mist low over the ground (the fog's colour and amount). */
  fog: number;
  fogDensity: number;
  /** How bright the picture is exposed (the eye adapting to the dark). */
  exposure: number;
  /** Windows, lanterns and the rails' glow: 0 = off (daylight), 1 = full night. */
  lamps: number;
  /** Stars, 0–1. */
  stars: number;
  /** Clouds: how much of the sky, and their colour. */
  cloudCover: number;
  cloudColor: number;
  /** Colour saturation of the final picture: in the dark, eyes see less colour. */
  saturation: number;
  /**
   * How much of the light is the moon's: 0 until sunset, 1 at night. It drives what only the
   * night has: the night sky's shape and its stars, the eye's night colour shift (finish pass),
   * the sky's softer blur, and the moon's gentler glints on the river.
   */
  moon: number;
  /** The night sky's middle, just above the glow along the horizon (only used with `moon`). */
  skyMid: number;
}

interface Key extends Lighting {
  at: number;
}

const KEYS: readonly Key[] = [
  {
    at: 0, // midday: high warm-white sun, soft blue sky, light haze
    sunElevation: 44, sunAzimuth: 55, sunColor: 0xfff0da, sunIntensity: 3.0,
    skyFill: 0xd6e4ef, groundFill: 0x6f7a4c, fillIntensity: 0.85,
    zenith: 0x5f93c6, horizon: 0xdbe6e6, sunGlow: 0xfff4dc,
    fog: 0xd3dfe0, fogDensity: 0.7, exposure: 1.0, lamps: 0, stars: 0, cloudCover: 0.45, cloudColor: 0xfbfaf6, saturation: 1.05,
    moon: 0, skyMid: 0x5f93c6,
  },
  {
    at: 0.5, // late afternoon: the light turns golden and the shadows grow
    sunElevation: 32, sunAzimuth: 70, sunColor: 0xffdcaa, sunIntensity: 2.9,
    skyFill: 0xcdd5df, groundFill: 0x6c6446, fillIntensity: 0.8,
    zenith: 0x6b8fbd, horizon: 0xf0d6b2, sunGlow: 0xffe0b0,
    fog: 0xe2d6c4, fogDensity: 0.85, exposure: 1.02, lamps: 0.12, stars: 0, cloudCover: 0.5, cloudColor: 0xfff1de, saturation: 1.05,
    moon: 0, skyMid: 0x6b8fbd,
  },
  {
    at: 0.85, // dusk (the app's default): a low warm sun under a cool blue sky, long shadows,
    // the lamps and rails coming on. Kept cool overall, so the grass stays green and the
    // cyan rails read, as in the village's original look.
    sunElevation: 18, sunAzimuth: 86, sunColor: 0xffc796, sunIntensity: 1.35,
    skyFill: 0x8c9cc4, groundFill: 0x3d4a32, fillIntensity: 0.75,
    zenith: 0x2c3f66, horizon: 0xe2a47e, sunGlow: 0xffbe8a,
    fog: 0x7f8ba4, fogDensity: 1.0, exposure: 1.2, lamps: 0.85, stars: 0.12, cloudCover: 0.55, cloudColor: 0xe8ab92, saturation: 1.05,
    moon: 0, skyMid: 0x3a4b74,
  },
  {
    at: 1, // night: a slate-blue moonlit night, the village lit by its lamps.
    // The moon hangs behind the river, so its light glitters on the water from the usual view.
    // Moonlight is a low-colour blue-grey, and the fill is strong enough that shadows keep
    // their shapes (about 4:1, not black). The ground bounces a little warm plum light back
    // up. The haze lightens with distance, and a thin glow sits along the horizon under a
    // deep slate-violet sky, darkest straight up.
    sunElevation: 32, sunAzimuth: 165, sunColor: 0xc5d2e9, sunIntensity: 0.85,
    skyFill: 0x4b5377, groundFill: 0x271c1d, fillIntensity: 1.4,
    zenith: 0x0c1028, horizon: 0x3d4466, sunGlow: 0x72809f,
    fog: 0x2b3250, fogDensity: 0.9, exposure: 1.35, lamps: 1, stars: 1, cloudCover: 0.35, cloudColor: 0x35364a, saturation: 0.95,
    moon: 1, skyMid: 0x1c2547,
  },
];

const COLOR_KEYS = ["sunColor", "skyFill", "groundFill", "zenith", "horizon", "sunGlow", "fog", "cloudColor", "skyMid"] as const;
const NUMBER_KEYS = ["sunElevation", "sunIntensity", "fillIntensity", "fogDensity", "exposure", "lamps", "stars", "cloudCover", "saturation", "moon"] as const;

/** sRGB (0–1) to linear light, and back. */
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** Blend two 0xRRGGBB colours in linear light. */
export function mixColor(a: number, b: number, t: number): number {
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const x = toLinear(((a >> shift) & 255) / 255);
    const y = toLinear(((b >> shift) & 255) / 255);
    const v = Math.round(toSrgb(x + (y - x) * t) * 255);
    out |= Math.min(255, Math.max(0, v)) << shift;
  }
  return out;
}

/** Ease in and out, so the light never changes speed suddenly at a keyframe. */
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Blend two angles in degrees the short way round. */
function mixAngle(a: number, b: number, t: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return a + d * t;
}

/** The light at a time of day `k` (0 = midday, 1 = night). */
export function lightingAt(k: number): Lighting {
  const x = Number.isFinite(k) ? Math.min(1, Math.max(0, k)) : 0;
  let i = 1;
  while (i < KEYS.length - 1 && x > KEYS[i]!.at) i++;
  const a = KEYS[i - 1]!;
  const b = KEYS[i]!;
  const t = smooth((x - a.at) / (b.at - a.at));
  const out = { sunAzimuth: mixAngle(a.sunAzimuth, b.sunAzimuth, t) } as Lighting;
  for (const key of COLOR_KEYS) out[key] = mixColor(a[key], b[key], t);
  for (const key of NUMBER_KEYS) out[key] = a[key] + (b[key] - a[key]) * t;
  // Between sunset and night the sun sets and the moon rises: let the direct light dip
  // through the swap, so the shadows don't visibly swing across the village.
  if (a.at === 0.85 && b.at === 1) out.sunIntensity *= 1 - Math.sin(t * Math.PI) * 0.8;
  return out;
}

/** The sun's direction (a unit vector pointing from the village towards it). */
export function sunDirection(light: Pick<Lighting, "sunElevation" | "sunAzimuth">): [number, number, number] {
  const el = (light.sunElevation * Math.PI) / 180;
  const az = (light.sunAzimuth * Math.PI) / 180;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
}

/** A colour towards grey (keeping its brightness, a little cool, like light through cloud), and darker. */
function dull(c: number, amount: number, darken = 0): number {
  const lin = [16, 8, 0].map((shift) => toLinear(((c >> shift) & 255) / 255));
  const y = 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
  const grey = [y * 0.96, y, y * 1.06];
  let out = 0;
  [16, 8, 0].forEach((shift, i) => {
    const v = (lin[i]! + (grey[i]! - lin[i]!) * amount) * (1 - darken);
    out |= Math.min(255, Math.max(0, Math.round(toSrgb(Math.max(0, v)) * 255))) << shift;
  });
  return out;
}

/** What the sky is doing, for the light (see weather.ts). */
export interface SkyCover {
  overcast: number;
  rain: number;
  snowfall: number;
}

/**
 * The light under the weather. Cloud takes the sun's direct light and spreads it through the
 * whole sky: weaker sun, stronger fill, softer and greyer colours, thicker haze, fewer stars.
 * (Moving cloud shadows on the ground come from weathering.ts.) Snow lying on the ground
 * throws light back up. A clear sky with no snow is the light exactly as it was.
 */
export function withWeather(light: Lighting, sky: SkyCover, snow = 0): Lighting {
  const o = Math.min(1, Math.max(0, sky.overcast || 0));
  const falling = Math.min(1, Math.max(0, Math.max(sky.rain || 0, sky.snowfall || 0)));
  const s = Math.min(1, Math.max(0, snow || 0));
  if (o === 0 && falling === 0 && s === 0) return light;
  const storm = smooth(Math.min(1, Math.max(0, (o - 0.85) / 0.15))) * Math.min(1, Math.max(0, sky.rain || 0));
  const out = { ...light };
  out.sunIntensity = light.sunIntensity * (1 - 0.5 * o - 0.25 * storm);
  out.sunColor = dull(light.sunColor, 0.5 * o);
  out.fillIntensity = light.fillIntensity * (1 + 0.4 * o - 0.35 * storm);
  out.skyFill = dull(light.skyFill, 0.55 * o);
  out.zenith = dull(light.zenith, 0.75 * o, 0.22 * o + 0.2 * storm);
  out.skyMid = dull(light.skyMid, 0.7 * o, 0.18 * o);
  out.horizon = dull(light.horizon, 0.7 * o, 0.1 * o + 0.15 * storm);
  out.sunGlow = dull(light.sunGlow, 0.8 * o, 0.5 * o);
  out.fog = dull(light.fog, 0.55 * o + 0.2 * falling, 0.08 * o + 0.15 * storm);
  out.fogDensity = light.fogDensity * (1 + 0.5 * o + 0.9 * falling);
  out.cloudCover = Math.max(light.cloudCover, 0.3 + 0.7 * o);
  out.cloudColor = dull(light.cloudColor, 0.7 * o, 0.3 * o + 0.3 * storm);
  out.stars = light.stars * (1 - smooth(o));
  out.saturation = light.saturation * (1 - 0.14 * o);
  out.exposure = light.exposure * (1 + 0.1 * o - 0.12 * storm);
  // Snow on the ground lights things from below, a little.
  if (s > 0) out.groundFill = mixColor(light.groundFill, dull(light.skyFill, 0.4), s * 0.55);
  return out;
}
