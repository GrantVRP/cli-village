// Weather and seasons, as plain numbers: what the sky is doing and what time of year it is.
//
// Three things decide the weather, in this order:
//   1. a pin (?weather= in the address, or the switch being off), which wins outright;
//   2. the work: problems bring clouds and rain, a leaked secret stopped at the gate a storm;
//   3. a gentle drift: clouds come and go over minutes, now and then a light shower.
// The work and the drift are combined by taking the stormier of the two, so the village never
// looks fairer than the work is.
//
// The season comes from this computer's calendar (no network, no location): the time zone
// only says which half of the world it's in, so July is summer in Ohio and winter in Sydney.
// Seasons blend over about two weeks around each change, so nothing flips overnight.
//
// Summer with no clouds is the village exactly as it was before weather: every effect is zero.
//
// This file has no imports, so the tests can load it directly.

export type Season = "spring" | "summer" | "autumn" | "winter";
export const SEASONS: readonly Season[] = ["spring", "summer", "autumn", "winter"];

/** The kinds of weather that can be pinned with ?weather=. */
export type WeatherPin = "clear" | "cloudy" | "rain" | "storm" | "snow";
export const WEATHER_PINS: readonly WeatherPin[] = ["clear", "cloudy", "rain", "storm", "snow"];

/** The time of year, as how much of each look shows (each 0–1). */
export interface SeasonLook {
  /** Fresh light greens and blossom in some trees. */
  spring: number;
  /** Orange, red and gold leaves; golden grass; leaves falling. */
  autumn: number;
  /** Snow lying on roofs and fields, dull straw grass. */
  winter: number;
}

/** What the sky is doing (each 0–1). */
export interface Sky {
  /** Cloud between the sun and the village: 0 = clear, 1 = overcast. */
  overcast: number;
  /** Rain falling: 1 is a downpour. */
  rain: number;
  /** Snow falling. */
  snowfall: number;
}

export const FAIR: Sky = { overcast: 0, rain: 0, snowfall: 0 };
export const SUMMER: SeasonLook = { spring: 0, autumn: 0, winter: 0 };

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const smooth = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/**
 * Time zones in the southern half of the world, where the seasons are the other way round.
 * Only the parts of the world with seasons worth showing; the tropics read as either.
 */
const SOUTHERN = [/^Australia\//, /^Antarctica\//, /^Pacific\/(Auckland|Chatham)$/, /^America\/(Argentina\/|Santiago|Montevideo|Asuncion|Sao_Paulo|Punta_Arenas)/, /^Africa\/(Johannesburg|Maseru|Mbabane|Windhoek|Maputo|Harare)$/, /^Atlantic\/(Stanley|South_Georgia)$/, /^Indian\/(Kerguelen)$/];

/** True when this time zone (an IANA name like "Australia/Sydney") is south of the equator. */
export function isSouthern(timeZone: string | undefined): boolean {
  return Boolean(timeZone && SOUTHERN.some((re) => re.test(timeZone)));
}

/**
 * The season's look on a date. Meteorological seasons (spring from 1 March in the north), each
 * blending into the next over about two weeks centred on the change.
 */
export function seasonOn(date: Date, southern = false): SeasonLook {
  // Months since 1 December (winter's start in the north), with the day as a fraction.
  const month = date.getMonth() + (date.getDate() - 1) / 30;
  let m = (month + 1) % 12;
  if (southern) m = (m + 6) % 12;
  // m: 0–3 winter, 3–6 spring, 6–9 summer, 9–12 autumn. Blend ±0.25 month at each change.
  const blend = 0.25;
  const weight = (start: number, end: number) => {
    // Distance into the season, wrapping round the year.
    const into = (((m - start) % 12) + 12) % 12;
    const length = end - start;
    if (into > length + blend && into < 12 - blend) return 0;
    const rise = into >= 12 - blend ? smooth((into - (12 - blend)) / (2 * blend)) : smooth((into + blend) / (2 * blend));
    const fall = into <= length + blend ? 1 - smooth((into - (length - blend)) / (2 * blend)) : 0;
    return Math.min(rise, fall);
  };
  return { winter: weight(0, 3), spring: weight(3, 6), autumn: weight(9, 12) };
}

/** A season by name, fully. */
export function seasonLook(season: Season): SeasonLook {
  return { spring: season === "spring" ? 1 : 0, autumn: season === "autumn" ? 1 : 0, winter: season === "winter" ? 1 : 0 };
}

/** The season with the most weight (for labels). */
export function seasonName(look: SeasonLook): Season {
  const summer = 1 - Math.max(look.spring, look.autumn, look.winter);
  const ranked: [Season, number][] = [["spring", look.spring], ["summer", summer], ["autumn", look.autumn], ["winter", look.winter]];
  return ranked.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
}

/** Rain, or snow when it's cold enough. */
function falling(amount: number, look: SeasonLook): Pick<Sky, "rain" | "snowfall"> {
  const cold = smooth((look.winter - 0.4) / 0.3);
  return { rain: amount * (1 - cold), snowfall: amount * cold };
}

/**
 * The work's weather, from the village's health (1 = all good, 0 = lots of unfixed problems;
 * one problem takes 0.4, a stopped crate at the harbor 0.6). All good is fair weather.
 */
export function workSky(health: number, look: SeasonLook = SUMMER): Sky {
  const trouble = 1 - clamp01(health);
  if (trouble <= 0) return FAIR;
  // One problem (0.4): grey and raining steadily. A secret at the gate (0.6+): a storm.
  const overcast = clamp01(0.55 + trouble * 1.1);
  const amount = clamp01(0.15 + trouble * 1.3);
  return { overcast, ...falling(amount, look) };
}

/** Smooth random values over time: the same seconds always give the same value (0–1). */
function drift(seconds: number, period: number, seed: number): number {
  const x = seconds / period + seed * 17.13;
  const i = Math.floor(x);
  const f = x - i;
  const hash = (n: number) => {
    const s = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  return hash(i) + (hash(i + 1) - hash(i)) * smooth(f);
}

/**
 * The gentle drift, from the clock (seconds since 1970), so the browser and the desktop app
 * agree and a reload doesn't change the sky. Clouds come and go over several minutes; when
 * they're thickest there's a light shower (or light snow in winter). Never more than that.
 */
export function ambientSky(seconds: number, look: SeasonLook = SUMMER): Sky {
  const slow = drift(seconds, 540, 1);
  const quick = drift(seconds, 130, 2);
  const cloud = clamp01(slow * 0.75 + quick * 0.25);
  const overcast = 0.08 + cloud * 0.6;
  const shower = smooth((cloud - 0.78) / 0.16) * 0.3;
  return { overcast, ...falling(shower, look) };
}

/** A pinned sky (?weather=). */
export function pinnedSky(pin: WeatherPin): Sky {
  switch (pin) {
    case "clear":
      return FAIR;
    case "cloudy":
      return { overcast: 0.5, rain: 0, snowfall: 0 };
    case "rain":
      return { overcast: 0.85, rain: 0.6, snowfall: 0 };
    case "storm":
      return { overcast: 1, rain: 1, snowfall: 0 };
    case "snow":
      return { overcast: 0.8, rain: 0, snowfall: 0.7 };
  }
}

/** The stormier of two skies, part by part. */
export function stormier(a: Sky, b: Sky): Sky {
  return { overcast: Math.max(a.overcast, b.overcast), rain: Math.max(a.rain, b.rain), snowfall: Math.max(a.snowfall, b.snowfall) };
}

/** Read ?weather= and ?season= (anything else is ignored). */
export function weatherFromQuery(weather: string | null, season: string | null): { pin: WeatherPin | "off" | null; season: Season | null } {
  const w = (weather ?? "").toLowerCase();
  const s = (season ?? "").toLowerCase();
  return {
    pin: w === "off" ? "off" : (WEATHER_PINS as readonly string[]).includes(w) ? (w as WeatherPin) : null,
    season: (SEASONS as readonly string[]).includes(s) ? (s as Season) : null,
  };
}

/**
 * Move a sky towards a target at a pace that feels like weather: clouds gather over about
 * ten seconds, rain starts and stops in a few. `dt` in seconds; 0 or less jumps there.
 */
export function approachSky(from: Sky, to: Sky, dt: number): Sky {
  if (dt <= 0) return { ...to };
  const step = (a: number, b: number, seconds: number) => a + (b - a) * Math.min(1, dt / seconds);
  return { overcast: step(from.overcast, to.overcast, 6), rain: step(from.rain, to.rain, 3), snowfall: step(from.snowfall, to.snowfall, 5) };
}

/**
 * How wet the ground is: it soaks up rain in about half a minute and dries over a few. Snow
 * on the ground comes from the season, and builds up a little more while it snows.
 */
export function groundAfter(wet: number, snow: number, sky: Sky, look: SeasonLook, dt: number): { wet: number; snow: number } {
  const lying = clamp01(look.winter * 0.85 + sky.snowfall * 0.3);
  if (dt <= 0) return { wet: clamp01(sky.rain * 1.6), snow: lying };
  const wetTarget = clamp01(sky.rain * 1.6);
  const wetRate = wetTarget > wet ? 1 / 25 : 1 / 150;
  const snowRate = lying > snow ? 1 / 40 : 1 / 120;
  return { wet: wet + (wetTarget - wet) * Math.min(1, dt * wetRate), snow: snow + (lying - snow) * Math.min(1, dt * snowRate) };
}
