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
  },
  {
    at: 0.5, // late afternoon: the light turns golden and the shadows grow
    sunElevation: 32, sunAzimuth: 70, sunColor: 0xffdcaa, sunIntensity: 2.9,
    skyFill: 0xcdd5df, groundFill: 0x6c6446, fillIntensity: 0.8,
    zenith: 0x6b8fbd, horizon: 0xf0d6b2, sunGlow: 0xffe0b0,
    fog: 0xe2d6c4, fogDensity: 0.85, exposure: 1.02, lamps: 0.12, stars: 0, cloudCover: 0.5, cloudColor: 0xfff1de, saturation: 1.05,
  },
  {
    at: 0.85, // dusk (the app's default): a low warm sun under a cool blue sky, long shadows,
    // the lamps and rails coming on. Kept cool overall, so the grass stays green and the
    // cyan rails read, as in the village's original look.
    sunElevation: 18, sunAzimuth: 86, sunColor: 0xffc796, sunIntensity: 1.35,
    skyFill: 0x8c9cc4, groundFill: 0x3d4a32, fillIntensity: 0.75,
    zenith: 0x2c3f66, horizon: 0xe2a47e, sunGlow: 0xffbe8a,
    fog: 0x7f8ba4, fogDensity: 1.0, exposure: 1.2, lamps: 0.85, stars: 0.12, cloudCover: 0.55, cloudColor: 0xe8ab92, saturation: 1.05,
  },
  {
    at: 1, // night: a pale moon from the other side, the village lit by its lamps
    sunElevation: 38, sunAzimuth: -135, sunColor: 0xa9b8d6, sunIntensity: 1.0,
    skyFill: 0x3b3f66, groundFill: 0x1e2027, fillIntensity: 0.95,
    zenith: 0x0b1222, horizon: 0x27304b, sunGlow: 0x8e9cc0,
    fog: 0x1d2436, fogDensity: 0.9, exposure: 1.4, lamps: 1, stars: 1, cloudCover: 0.35, cloudColor: 0x4a5370, saturation: 0.8,
  },
];

const COLOR_KEYS = ["sunColor", "skyFill", "groundFill", "zenith", "horizon", "sunGlow", "fog", "cloudColor"] as const;
const NUMBER_KEYS = ["sunElevation", "sunIntensity", "fillIntensity", "fogDensity", "exposure", "lamps", "stars", "cloudCover", "saturation"] as const;

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
