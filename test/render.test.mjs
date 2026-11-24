// The 3D village's renderer: the parts that are plain logic, tested without a graphics card.
// (The shaders themselves are compiled and run by the desktop app test, test/app/.)
// These modules are TypeScript, loaded as they are: Node 22.18+ and 24 can run TypeScript
// files directly. On older Node versions these tests are skipped.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";

const canRunTypeScript = Boolean(process.features.typescript);
const load = (name) => import(new URL(`../web/src/render/${name}.ts`, import.meta.url).href);
const options = { skip: canRunTypeScript ? false : "this Node version can't run TypeScript files directly" };

describe("graphics quality", options, async () => {
  const q = canRunTypeScript ? await load("quality") : null;

  it("starts computers without a graphics card on the lowest tier", () => {
    for (const name of [
      "Google SwiftShader",
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
      "llvmpipe (LLVM 15.0.7, 256 bits)",
      "ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)",
    ]) assert.equal(q.tierForRenderer(name), "low", name);
  });

  it("gives built-in graphics the middle tier and graphics cards the top one", () => {
    assert.equal(q.tierForRenderer("ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)"), "medium");
    assert.equal(q.tierForRenderer("ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)"), "medium");
    assert.equal(q.tierForRenderer("ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)"), "high");
    assert.equal(q.tierForRenderer("ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)"), "high");
    assert.equal(q.tierForRenderer("Apple M2"), "high");
    assert.equal(q.tierForRenderer(""), "medium");
    assert.equal(q.tierForRenderer(null), "medium");
  });

  it("reads ?quality= from the page address, ignoring anything else", () => {
    assert.equal(q.tierFromQuery("high"), "high");
    assert.equal(q.tierFromQuery(" Low "), "low");
    assert.equal(q.tierFromQuery("ultra"), null);
    assert.equal(q.tierFromQuery(null), null);
  });

  it("only ever steps down", () => {
    assert.equal(q.lower("high"), "medium");
    assert.equal(q.lower("medium"), "low");
    assert.equal(q.lower("low"), "low");
  });

  it("asks for less detail only after a run of slow frames, not one slow frame", () => {
    const budget = new q.FrameBudget(22, 10, 5);
    // The first frames (shaders compiling) don't count, however slow.
    for (let i = 0; i < 5; i++) assert.equal(budget.add(500), false);
    // Smooth frames with a few hitches: fine.
    let slow = false;
    for (let i = 0; i < 10; i++) slow ||= budget.add(i % 4 === 0 ? 60 : 16);
    assert.equal(slow, false);
    // Consistently slow: step down.
    for (let i = 0; i < 9; i++) assert.equal(budget.add(40), false);
    assert.equal(budget.add(40), true);
  });

  it("doesn't count the page being hidden or the computer sleeping as a slow frame", () => {
    const budget = new q.FrameBudget(22, 4, 0);
    budget.add(40);
    budget.add(40);
    budget.add(5000); // a long gap: start over
    assert.equal(budget.skip, 0);
    for (let i = 0; i < 3; i++) assert.equal(budget.add(16), false);
    assert.equal(budget.add(16), false);
  });

  it("keeps each tier's settings sensible", () => {
    const { low, medium, high } = q.SETTINGS;
    assert.ok(low.maxPixelRatio <= medium.maxPixelRatio && medium.maxPixelRatio <= high.maxPixelRatio);
    assert.ok(low.shadowSamples <= medium.shadowSamples && medium.shadowSamples <= high.shadowSamples);
    assert.equal(low.msaa, 0);
    assert.equal(low.ambientOcclusion, false);
    // The extra grass is for computers that can afford it; a step down to Low drops it.
    assert.equal(low.denseGrass, false);
    assert.ok(medium.denseGrass && high.denseGrass);
  });
});

describe("light over the day", options, async () => {
  const tl = canRunTypeScript ? await load("timeline") : null;

  it("goes from a high midday sun to a low sunset and a moonlit night", () => {
    const noon = tl.lightingAt(0);
    const dusk = tl.lightingAt(0.85);
    const night = tl.lightingAt(1);
    assert.ok(noon.sunElevation > dusk.sunElevation, "the sun is lower at sunset");
    assert.equal(noon.lamps, 0);
    assert.ok(dusk.lamps > 0.5 && night.lamps === 1, "the lamps are on by sunset");
    assert.ok(night.stars === 1 && noon.stars === 0);
    assert.ok(night.saturation < noon.saturation, "less colour in the dark");
  });

  it("never jumps: a small step in time is a small change in light", () => {
    let before = tl.lightingAt(0);
    for (let i = 1; i <= 1000; i++) {
      const now = tl.lightingAt(i / 1000);
      for (const key of ["sunElevation", "sunIntensity", "fillIntensity", "exposure", "lamps", "fogDensity", "saturation"]) {
        assert.ok(Math.abs(now[key] - before[key]) < 0.2, `${key} jumps at ${i / 1000}: ${before[key]} → ${now[key]}`);
      }
      const turn = Math.abs(((now.sunAzimuth - before.sunAzimuth + 540) % 360) - 180);
      assert.ok(turn < 3, `the sun swings ${turn}° at ${i / 1000}`);
      for (const key of ["sunColor", "fog", "horizon", "zenith"]) {
        for (const shift of [16, 8, 0]) {
          const d = Math.abs(((now[key] >> shift) & 255) - ((before[key] >> shift) & 255));
          assert.ok(d <= 6, `${key} jumps at ${i / 1000}`);
        }
      }
      before = now;
    }
  });

  it("keeps the night's own look out of the day and the default dusk", () => {
    // The night sky, night vision and the moon's softer glints all follow `moon`.
    for (const k of [0, 0.5, 0.85]) assert.equal(tl.lightingAt(k).moon, 0, `no moon at ${k}`);
    assert.equal(tl.lightingAt(1).moon, 1);
    const mid = tl.lightingAt(0.93).moon;
    assert.ok(mid > 0 && mid < 1, "it fades in after sunset");
  });

  it("dims the sun while it sets and the moon rises, so shadows don't swing across the village", () => {
    const swap = tl.lightingAt(0.925);
    assert.ok(swap.sunIntensity < tl.lightingAt(0.85).sunIntensity * 0.5);
    assert.ok(swap.sunIntensity < tl.lightingAt(1).sunIntensity);
  });

  it("treats anything outside 0–1 as the nearest end", () => {
    assert.deepEqual(tl.lightingAt(-3), tl.lightingAt(0));
    assert.deepEqual(tl.lightingAt(7), tl.lightingAt(1));
    assert.deepEqual(tl.lightingAt(Number.NaN), tl.lightingAt(0));
  });

  it("blends colours in linear light, so a blend of two colours isn't darker than both", () => {
    assert.equal(tl.mixColor(0xff0000, 0x00ff00, 0), 0xff0000);
    assert.equal(tl.mixColor(0xff0000, 0x00ff00, 1), 0x00ff00);
    // Half red, half green in linear light is about 188 in sRGB, not 128.
    const mid = tl.mixColor(0xff0000, 0x00ff00, 0.5);
    assert.ok(((mid >> 16) & 255) > 180 && ((mid >> 8) & 255) > 180);
  });

  it("points the sun the right way", () => {
    const up = tl.sunDirection({ sunElevation: 90, sunAzimuth: 0 });
    assert.ok(Math.abs(up[1] - 1) < 1e-9);
    for (const k of [0, 0.3, 0.85, 1]) {
      const [x, y, z] = tl.sunDirection(tl.lightingAt(k));
      assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-9);
      assert.ok(y > 0, "the light always comes from above the ground");
    }
  });
});

describe("soft shadows", options, async () => {
  const sh = canRunTypeScript ? await load("shadows") : null;
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  const lookups = (text) => text.split("float getShadow(").length - 1;

  it("fits the shadow shader of the three.js version in use", () => {
    const soft = sh.withSoftShadows(chunk, 16);
    assert.ok(soft.includes(sh.MARKER));
    assert.ok(soft.includes("cvVogel"));
    // The PCF and VSM lookups are untouched; only the basic one is replaced.
    assert.equal(lookups(soft), lookups(chunk));
    assert.ok(soft.includes("sampler2DShadow shadowMap"));
    assert.equal(soft.split("{").length, soft.split("}").length, "balanced braces");
    assert.ok(!soft.includes("shadow = step( shadowCoord.z, depth )"), "the one-tap lookup is gone");
    // The sample counts are baked into the loops.
    assert.ok(soft.includes("i < 16;") && soft.includes("i < 10;"));
  });

  it("refuses a shader it doesn't recognise, rather than drawing wrong shadows", () => {
    assert.throws(() => sh.withSoftShadows("void main() {}", 12), /three\.js's shadow shader changed/);
    const oneLookup = chunk.slice(0, chunk.lastIndexOf("float getShadow( sampler2D"));
    assert.throws(() => sh.withSoftShadows(oneLookup, 12), /changed/);
  });

  it("turns the sun's size into a penumbra that grows with distance", () => {
    const camera = new THREE.OrthographicCamera(-38, 38, 38, -38, 1, 170);
    const radius = sh.sunSizeToRadius(2.6, camera);
    // A blocker 4 units above the ground: penumbra ≈ 4 · tan(2.6°) ≈ 0.18 units.
    const penumbra = (4 / (camera.far - camera.near)) * radius * (camera.right - camera.left);
    assert.ok(Math.abs(penumbra - 4 * Math.tan((2.6 * Math.PI) / 180)) < 1e-9);
  });
});

describe("weather and seasons", options, async () => {
  const w = canRunTypeScript ? await load("weather") : null;
  const tl = canRunTypeScript ? await load("timeline") : null;
  const on = (y, m, d) => new Date(y, m - 1, d, 12);

  it("reads the season from the calendar, the other way round in the south", () => {
    assert.deepEqual(w.seasonOn(on(2027, 1, 15)), { winter: 1, spring: 0, autumn: 0 });
    assert.deepEqual(w.seasonOn(on(2027, 4, 15)), { winter: 0, spring: 1, autumn: 0 });
    assert.deepEqual(w.seasonOn(on(2027, 7, 15)), { winter: 0, spring: 0, autumn: 0 }); // summer: no effects
    assert.deepEqual(w.seasonOn(on(2027, 10, 15)), { winter: 0, spring: 0, autumn: 1 });
    // The south: July is winter, January summer.
    assert.equal(w.seasonOn(on(2027, 7, 15), true).winter, 1);
    assert.deepEqual(w.seasonOn(on(2027, 1, 15), true), { winter: 0, spring: 0, autumn: 0 });
  });

  it("blends the seasons over about two weeks around each change", () => {
    const late = w.seasonOn(on(2026, 11, 24));
    assert.ok(late.autumn > 0.95 && late.winter < 0.05, "still autumn on 24 November");
    const change = w.seasonOn(on(2026, 12, 1));
    assert.ok(Math.abs(change.winter - 0.5) < 0.05 && Math.abs(change.autumn - 0.5) < 0.05, "half and half on 1 December");
    assert.ok(w.seasonOn(on(2026, 12, 10)).winter > 0.99, "winter by 10 December");
    // Every day of the year: each look 0–1, and never two seasons fully at once.
    for (let day = 0; day < 366; day++) {
      const look = w.seasonOn(new Date(2027, 0, 1 + day, 12));
      for (const v of Object.values(look)) assert.ok(v >= 0 && v <= 1);
      assert.ok(look.winter + look.spring + look.autumn <= 1.0001);
    }
  });

  it("knows the southern time zones", () => {
    for (const zone of ["Australia/Sydney", "Pacific/Auckland", "America/Argentina/Buenos_Aires", "America/Santiago", "Africa/Johannesburg"]) assert.equal(w.isSouthern(zone), true, zone);
    for (const zone of ["America/New_York", "Europe/London", "Asia/Tokyo", "America/Los_Angeles", "UTC", "", undefined]) assert.equal(w.isSouthern(zone), false, String(zone));
  });

  it("brings rain when work has problems, a storm for a stopped crate, snow when it's cold", () => {
    assert.deepEqual(w.workSky(1), w.FAIR);
    const problem = w.workSky(0.6);
    assert.ok(problem.overcast > 0.9 && problem.rain > 0.5 && problem.snowfall === 0);
    const storm = w.workSky(0.4);
    assert.ok(storm.overcast === 1 && storm.rain > 0.9);
    const winter = w.workSky(0.6, w.seasonLook("winter"));
    assert.ok(winter.rain === 0 && winter.snowfall > 0.5);
  });

  it("drifts gently: never more than a light shower, the same at the same moment", () => {
    let showers = 0;
    for (let s = 0; s < 86400; s += 30) {
      const sky = w.ambientSky(1.8e9 + s);
      assert.ok(sky.overcast >= 0.08 && sky.overcast <= 0.68 + 1e-9);
      assert.ok(sky.rain <= 0.3 + 1e-9 && sky.snowfall === 0);
      if (sky.rain > 0) showers++;
    }
    assert.ok(showers > 0 && showers < 86400 / 30 / 4, "showers now and then, not most of the time");
    assert.deepEqual(w.ambientSky(1.8e9 + 1234), w.ambientSky(1.8e9 + 1234));
    // The work's weather wins when it's stormier.
    assert.equal(w.stormier(w.workSky(0.6), w.ambientSky(1.8e9)).rain, w.workSky(0.6).rain);
  });

  it("reads ?weather= and ?season=, ignoring anything else", () => {
    assert.deepEqual(w.weatherFromQuery("Rain", "WINTER"), { pin: "rain", season: "winter" });
    assert.deepEqual(w.weatherFromQuery("off", null), { pin: "off", season: null });
    assert.deepEqual(w.weatherFromQuery("<script>", "monsoon"), { pin: null, season: null });
    for (const pin of w.WEATHER_PINS) {
      const sky = w.pinnedSky(pin);
      for (const v of Object.values(sky)) assert.ok(v >= 0 && v <= 1);
    }
  });

  it("changes like weather: the ground soaks up rain faster than it dries", () => {
    const rain = { overcast: 0.85, rain: 0.6, snowfall: 0 };
    assert.deepEqual(w.approachSky(w.FAIR, rain, 0), rain);
    const halfway = w.approachSky(w.FAIR, rain, 1);
    assert.ok(halfway.rain > 0 && halfway.rain < rain.rain);
    const soaking = w.groundAfter(0, 0, rain, w.SUMMER, 5).wet;
    const drying = 1 - w.groundAfter(1, 0, w.FAIR, w.SUMMER, 5).wet;
    assert.ok(soaking > drying * 3);
  });

  it("leaves the light exactly as it was under a clear sky, and greys it under cloud", () => {
    for (const k of [0, 0.5, 0.85, 0.93, 1]) {
      const light = tl.lightingAt(k);
      assert.equal(tl.withWeather(light, w.FAIR, 0), light, `k=${k}`);
    }
    const day = tl.lightingAt(0);
    const grey = tl.withWeather(day, { overcast: 1, rain: 0.6, snowfall: 0 });
    assert.ok(grey.sunIntensity < day.sunIntensity * 0.6);
    assert.ok(grey.fillIntensity > day.fillIntensity);
    assert.ok(grey.fogDensity > day.fogDensity && grey.cloudCover === 1);
    assert.ok(grey.saturation < day.saturation);
    // At night, cloud hides the stars.
    assert.equal(tl.withWeather(tl.lightingAt(1), { overcast: 1, rain: 0, snowfall: 0 }).stars, 0);
    // A storm is darker than rain.
    const rain = tl.withWeather(day, { overcast: 0.85, rain: 0.6, snowfall: 0 });
    const storm = tl.withWeather(day, { overcast: 1, rain: 1, snowfall: 0 });
    assert.ok(storm.exposure < rain.exposure && storm.sunIntensity < rain.sunIntensity);
  });
});

describe("robot reactions", options, async () => {
  const r = canRunTypeScript ? await load("reactions") : null;
  const none = new Set();

  it("waves for a job done, cheers for a fix, and acts out nothing from before", () => {
    const log = [
      { seq: 1, type: "done", agent: "Bolt", building: "vault" },
      { seq: 2, type: "fail", agent: "Sprocket", building: "lab" },
      { seq: 3, type: "done", agent: "Rivet", building: "lab" },
      { seq: 4, type: "start", agent: "Pip", building: "library" },
    ];
    // Rivet's done cleared the lab's problem; Bolt's done was already seen.
    assert.deepEqual(r.reactionsTo(log, 1, new Set(["lab"]), none), [{ agent: "Rivet", gesture: "cheer", delay: 0 }]);
    // The same done with the problem still there is a plain wave; a failure is no gesture (the slump is a pose).
    assert.deepEqual(r.reactionsTo(log, 0, new Set(["lab"]), new Set(["lab"])), [
      { agent: "Bolt", gesture: "wave", delay: 0 },
      { agent: "Rivet", gesture: "wave", delay: 0 },
    ]);
    assert.deepEqual(r.reactionsTo(log, 4, none, none), []);
  });

  it("cheers a push: the robot that pushed, then the ones resting at home, one after another", () => {
    const log = [
      { seq: 7, type: "done", agent: "Rivet", building: "harbor" },
      { seq: 8, type: "push", agent: "Rivet", building: "harbor" },
    ];
    const out = r.reactionsTo(log, 6, none, none, ["Bolt", "Pip", "Rivet"]);
    // The cheer wins over the wave for Rivet; nobody reacts twice.
    assert.deepEqual(out.map((x) => [x.agent, x.gesture]), [["Rivet", "cheer"], ["Bolt", "cheer"], ["Pip", "cheer"]]);
    assert.equal(out[0].delay, 0);
    assert.ok(out[1].delay > 0 && out[2].delay > out[1].delay);
  });

  it("pairs resting robots and lets each pair talk in turns, not all at once", () => {
    assert.deepEqual(r.chatPairs(["Bolt", "Mayor", "Pip"]), [["Bolt", "Mayor"]]);
    assert.deepEqual(r.chatPairs(["A", "B", "C", "D"]), [["A", "B"], ["C", "D"]]);
    const seconds = Array.from({ length: 220 }, (_, i) => i * 0.05);
    const talking = seconds.filter((t) => r.chatAt(t, 0).chatting).length / seconds.length;
    assert.ok(talking > 0.3 && talking < 0.45, `talks ${Math.round(talking * 100)}% of the time`);
    const speakers = new Set(seconds.filter((t) => r.chatAt(t, 0).chatting).map((t) => r.chatAt(t, 0).speaker));
    assert.deepEqual([...speakers].sort(), [0, 1]);
    // Two pairs don't start together.
    assert.notDeepEqual(seconds.map((t) => r.chatAt(t, 0).chatting), seconds.map((t) => r.chatAt(t, 1).chatting));
  });
});

describe("village life", options, async () => {
  const l = canRunTypeScript ? await load("life-rules") : null;
  const at = (night, more = {}) => ({ night, rain: 0, snowfall: 0, spring: 0, autumn: 0, winter: 0, still: false, ...more });
  const DUSK = 0.85; // the app opens at dusk

  it("fills the default dusk: birds still flying, fireflies out, villagers out with lit lanterns", () => {
    assert.ok(l.birdsWanted(at(DUSK)) > 0.9);
    assert.ok(l.firefliesWanted(at(DUSK)) > 0.9);
    assert.equal(l.villagersOut(at(DUSK)), true);
    assert.ok(l.lanternLight(DUSK) > 0.9);
    assert.equal(l.catAwake(at(DUSK)), true);
    // Butterflies are a daytime thing.
    assert.equal(l.butterfliesWanted(at(DUSK)), 0);
  });

  it("by day: birds and butterflies, no fireflies, no lanterns", () => {
    assert.equal(l.birdsWanted(at(0)), 1);
    assert.equal(l.butterfliesWanted(at(0)), 1);
    assert.equal(l.firefliesWanted(at(0)), 0);
    assert.equal(l.lanternLight(0), 0);
  });

  it("at night everyone is home: no birds or villagers, the cat asleep, fireflies out", () => {
    assert.equal(l.birdsWanted(at(1)), 0);
    assert.equal(l.villagersOut(at(1)), false);
    assert.equal(l.catAwake(at(1)), false);
    assert.equal(l.firefliesWanted(at(1)), 1);
  });

  it("shelters from the weather and follows the seasons", () => {
    for (const wet of [{ rain: 1 }, { snowfall: 1 }]) {
      assert.equal(l.birdsWanted(at(0, wet)), 0);
      assert.equal(l.butterfliesWanted(at(0, wet)), 0);
      assert.equal(l.firefliesWanted(at(1, wet)), 0);
      assert.equal(l.villagersOut(at(0, wet)), false);
      assert.equal(l.catAwake(at(0, wet)), false);
    }
    // No butterflies or fireflies in winter; fewer butterflies in autumn.
    assert.equal(l.butterfliesWanted(at(0, { winter: 1 })), 0);
    assert.equal(l.firefliesWanted(at(1, { winter: 1 })), 0);
    const autumn = l.butterfliesWanted(at(0, { autumn: 1 }));
    assert.ok(autumn > 0 && autumn < 0.5);
  });
});
