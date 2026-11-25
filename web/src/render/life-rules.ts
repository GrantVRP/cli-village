// Who is out and about in the village, by the light, the season and the weather (life.ts
// shows them). Kept apart, with no imports, so the tests can check the rules directly.

/** What the creatures react to. */
export interface LifeConditions {
  /** 0 day, 1 night (the app opens at dusk, 0.85). */
  night: number;
  rain: number;
  snowfall: number;
  spring: number;
  autumn: number;
  winter: number;
  still: boolean;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 0 below `a`, 1 above `b`, smooth in between. */
export function smooth(a: number, b: number, v: number): number {
  const k = clamp01((v - a) / (b - a));
  return k * k * (3 - 2 * k);
}

/** Birds: out until it's nearly dark (still flying at dusk); they shelter from rain and snow. */
export function birdsWanted(c: LifeConditions): number {
  return (1 - smooth(0.86, 0.96, c.night)) * (1 - smooth(0.15, 0.4, c.rain)) * (1 - smooth(0.2, 0.5, c.snowfall));
}

/** Butterflies: sunny days in spring and summer, fewer in autumn; none in winter, rain, snow or after sunset. */
export function butterfliesWanted(c: LifeConditions): number {
  const season = (1 - c.winter) * (1 - c.autumn * 0.6);
  return season * (1 - smooth(0.55, 0.72, c.night)) * (1 - smooth(0.05, 0.25, c.rain)) * (1 - smooth(0.05, 0.25, c.snowfall));
}

/** Fireflies: evenings and nights (already out at dusk), not in winter, rain or snow. */
export function firefliesWanted(c: LifeConditions): number {
  return smooth(0.6, 0.8, c.night) * (1 - c.winter) * (1 - smooth(0.05, 0.3, c.rain)) * (1 - smooth(0.05, 0.3, c.snowfall));
}

/** The villagers: out by day and at dusk; indoors when it's dark or wet. */
export function villagersOut(c: LifeConditions): boolean {
  return c.night < 0.94 && c.rain < 0.3 && c.snowfall < 0.35;
}

/** How bright the villagers' lanterns are (lit as the light goes). */
export function lanternLight(night: number): number {
  return smooth(0.45, 0.75, night);
}

/** The cat: about by day and dusk; at night, or in rain or snow, it curls up asleep on its bench. */
export function catAwake(c: LifeConditions): boolean {
  return c.night < 0.92 && c.rain < 0.3 && c.snowfall < 0.3;
}

/** How windy it is: 1 on a fair day (the usual sway), more under cloud, most in a storm. */
export function breeze(overcast: number, rain: number, snowfall: number): number {
  return Math.min(1.7, 1 + 0.25 * overcast + 0.45 * rain + 0.15 * snowfall);
}

/** How many hearth fires are lit (more chimney smoke): a few by day, more in the evening and in the cold. */
export function hearthFires(night: number, autumn: number, winter: number): number {
  return Math.max(smooth(0.45, 0.85, night), winter, autumn * 0.5);
}
