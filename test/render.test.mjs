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
