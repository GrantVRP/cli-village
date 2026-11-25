// Life around the village: birds over the rooftops, butterflies in the gardens in spring
// and summer, fireflies on warm evenings, ducks on the river, a cat on a bench, two
// villagers going about their day and a fisherman in a rowboat. None of it is about the work; it makes the village
// feel lived in. Everything follows the light, the season and the weather (birds shelter
// from rain, the villagers go indoors at night). It is seeded, so it looks the same each
// time, and in still mode (reduced motion) it holds one fixed pose.

import * as THREE from "three";
import { bedReach, type FlowerBed } from "./flora.js";
import { isLater, RIVER_HALF, RIVER_Z, SPOTS } from "./layout.js";
import { makeRandom, ModelBuilder } from "./lowpoly.js";
import { P } from "./palette.js";
import { birdsWanted, butterfliesWanted, catAwake, firefliesWanted, lanternLight, type LifeConditions, smooth, villagersOut } from "./render/life-rules.js";
import type { Tier } from "./render/quality.js";
import { keepDry } from "./render/weathering.js";

const COUNTS: Record<Tier, { birds: number; butterflies: number; fireflies: number }> = {
  low: { birds: 6, butterflies: 6, fireflies: 24 },
  medium: { birds: 9, butterflies: 10, fireflies: 40 },
  high: { birds: 12, butterflies: 14, fireflies: 64 },
};
const MAX = COUNTS.high;
/** The moment still mode shows. */
const STILL_T = 37;
const WATER_Y = -0.32;

/** Ease `value` toward `target` with a time constant of `seconds`. */
const approach = (value: number, target: number, dt: number, seconds: number) => (dt <= 0 ? target : value + (target - value) * (1 - Math.exp(-dt / seconds)));

const tmpM = new THREE.Matrix4();
const tmpM2 = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpV = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);
const ZERO_SCALE = new THREE.Matrix4().makeScale(0, 0, 0);
/** Birds are drawn a little larger than life, so they read from the home view. */
const BIRD_SIZE = new THREE.Vector3(1.5, 1.5, 1.5);

function geometryOf(b: ModelBuilder): THREE.BufferGeometry {
  const group = b.build();
  return (group.children[0] as THREE.Mesh).geometry;
}

// --- Birds: a loose flock circling high over the village ---------------------------------

class Birds {
  readonly body: THREE.InstancedMesh;
  readonly wings: THREE.InstancedMesh[];
  private presence = 0;
  private count = 0;
  private readonly seeds: number[][];

  constructor(material: THREE.Material) {
    const rng = makeRandom(301);
    const b = new ModelBuilder();
    b.add(new THREE.OctahedronGeometry(0.13, 0), 0x3f4247, { scale: [0.75, 0.6, 1.7] });
    b.add(new THREE.ConeGeometry(0.07, 0.18, 3), 0x34373b, { at: [0, 0, -0.24], rot: [-Math.PI / 2, 0, 0] });
    this.body = new THREE.InstancedMesh(geometryOf(b), material, MAX.birds);
    this.wings = [-1, 1].map((side) => {
      const w = new ModelBuilder();
      w.add(new THREE.OctahedronGeometry(0.22, 0), 0x4a4d52, { at: [side * 0.22, 0, -0.02], scale: [1, 0.12, 0.38] });
      return new THREE.InstancedMesh(geometryOf(w), material, MAX.birds);
    });
    // No shadows: from this high up they'd only be soft smudges on the plaza.
    for (const m of [this.body, ...this.wings]) {
      m.castShadow = false;
      m.frustumCulled = false;
    }
    this.seeds = Array.from({ length: MAX.birds }, () => [rng(), rng(), rng(), rng()]);
  }

  setCount(n: number): void {
    this.count = n;
    for (let i = n; i < MAX.birds; i++) for (const m of [this.body, ...this.wings]) m.setMatrixAt(i, ZERO_SCALE);
  }

  update(dt: number, t: number, c: LifeConditions): void {
    const wanted = birdsWanted(c);
    this.presence = c.still ? wanted : approach(this.presence, wanted, dt, 6);
    const away = 1 - this.presence;
    for (let i = 0; i < this.count; i++) {
      const [a, b2, c2, d] = this.seeds[i]!;
      if (this.presence < 0.02) {
        for (const m of [this.body, ...this.wings]) m.setMatrixAt(i, ZERO_SCALE);
        continue;
      }
      // One loose flock: everyone on the same slow circle, spread out along it and up and down.
      // The circle is flattened and set back over the town hall and the river, so the whole flock
      // stays near the home view's focus distance (nearer, the depth of field blurs birds into smudges).
      const speed = 0.16 + b2! * 0.03;
      const angle = t * speed + i * 0.42 + Math.sin(t * 0.21 + a! * 6) * 0.25;
      const radius = 14 + Math.sin(t * 0.13 + i) * 2 + c2! * 2 + away * 55;
      const height = 10 + d! * 3 + Math.sin(t * 0.37 + a! * 9) * 0.8 + away * 10;
      const x = Math.cos(angle) * radius;
      const z = -13 + Math.sin(angle) * radius * 0.52;
      // Heading along the circle, banking into the turn.
      const yaw = Math.atan2(-Math.sin(angle), Math.cos(angle) * 0.52);
      tmpQ.setFromEuler(tmpE.set(0, yaw, -0.35, "YXZ"));
      tmpM.compose(tmpV.set(x, height, z), tmpQ, BIRD_SIZE);
      this.body.setMatrixAt(i, tmpM);
      // Flap in bursts, then glide with the wings a little raised.
      const burst = smooth(0.35, 0.65, 0.5 + 0.5 * Math.sin(t * 0.8 + a! * 12));
      const flap = Math.sin(t * 12 + b2! * 20) * (0.15 + 0.6 * burst) + 0.18 * (1 - burst);
      this.wings.forEach((wing, side) => {
        tmpM2.makeRotationZ(side === 0 ? -flap : flap);
        wing.setMatrixAt(i, tmpM2.premultiply(tmpM));
      });
    }
    for (const m of [this.body, ...this.wings]) m.instanceMatrix.needsUpdate = true;
  }
}

// --- Butterflies: fluttering round the wildflowers ---------------------------------------

const WING_COLORS = [0xefe6c8, 0xe8d27a, 0xd9915a, 0xb9a8d6, 0xf2eee4] as const;

class Butterflies {
  readonly wings: THREE.InstancedMesh[];
  private presence = 0;
  private count = 0;
  private readonly seeds: number[][];
  /** The flower patches they visit: the ones nearest the middle, where they can be seen. */
  private readonly gardens: readonly [number, number][];

  constructor(material: THREE.Material, flowers: readonly [number, number][]) {
    const rng = makeRandom(302);
    const near = [...flowers].sort((a, b) => Math.hypot(a[0], a[1] + 2) - Math.hypot(b[0], b[1] + 2)).slice(0, 10);
    this.gardens = near.length ? near : [[0, 13]];
    this.wings = [-1, 1].map((side) => {
      const w = new ModelBuilder();
      // A thin rounded wing that turns at the body.
      w.add(new THREE.CylinderGeometry(0.1, 0.1, 0.006, 7), 0xffffff, { at: [side * 0.1, 0, 0], scale: [1, 1, 0.8] });
      const mesh = new THREE.InstancedMesh(geometryOf(w), material, MAX.butterflies);
      mesh.frustumCulled = false;
      return mesh;
    });
    this.seeds = Array.from({ length: MAX.butterflies }, () => [rng(), rng(), rng(), rng()]);
    const color = new THREE.Color();
    for (let i = 0; i < MAX.butterflies; i++) {
      color.set(WING_COLORS[Math.floor(this.seeds[i]![3]! * WING_COLORS.length)]!);
      for (const w of this.wings) w.setColorAt(i, color);
    }
  }

  setCount(n: number): void {
    this.count = n;
    for (let i = n; i < MAX.butterflies; i++) for (const w of this.wings) w.setMatrixAt(i, ZERO_SCALE);
  }

  update(dt: number, t: number, c: LifeConditions): void {
    const wanted = butterfliesWanted(c);
    this.presence = c.still ? wanted : approach(this.presence, wanted, dt, 4);
    const shown = Math.round(this.count * this.presence);
    for (let i = 0; i < this.count; i++) {
      if (i >= shown) {
        for (const w of this.wings) w.setMatrixAt(i, ZERO_SCALE);
        continue;
      }
      const [a, b, c2] = this.seeds[i]!;
      const [gx, gz] = this.gardens[i % this.gardens.length]!;
      // Wandering loops round the garden, dipping toward the flowers.
      const u = t * (0.45 + a! * 0.25) + a! * 40;
      const r = 1.1 + b! * 0.9;
      const x = gx + Math.sin(u) * r + Math.sin(u * 2.3 + 1.7) * 0.35;
      const z = gz + Math.cos(u * 0.8 + c2! * 5) * r;
      const y = 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(u * 1.7 + b! * 7)) + 0.08 * Math.sin(t * 9 + a! * 30);
      const dx = Math.cos(u) * r;
      const dz = -0.8 * Math.sin(u * 0.8 + c2! * 5) * r;
      const yaw = Math.atan2(dx, dz);
      tmpQ.setFromEuler(tmpE.set(0, yaw, 0));
      tmpM.compose(tmpV.set(x, y, z), tmpQ, ONE);
      const flap = 0.25 + 1.05 * Math.abs(Math.sin(t * 19 + a! * 50));
      this.wings.forEach((wing, side) => {
        tmpM2.makeRotationZ(side === 0 ? -flap : flap);
        wing.setMatrixAt(i, tmpM2.premultiply(tmpM));
      });
    }
    for (const w of this.wings) w.instanceMatrix.needsUpdate = true;
  }
}

// --- Fireflies: soft blinking lights over the meadows on warm evenings ----------------------

const fireflyVertex = /* glsl */ `
  attribute vec4 seed;
  uniform float time;
  uniform float amount;
  uniform float pixelsPerUnit;
  varying float vGlow;
  void main() {
    vec3 p = position + vec3(sin(time * 0.5 + seed.x * 6.3) * 0.6, sin(time * 0.7 + seed.y * 6.3) * 0.25, cos(time * 0.43 + seed.z * 6.3) * 0.6);
    vec4 view = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * view;
    // Each one glows for a moment, then rests; not all at once. Fewer show when amount is low.
    float pulse = smoothstep(-0.2, 1.0, sin(time * (0.8 + seed.w * 0.9) + seed.x * 40.0));
    vGlow = pulse * step(seed.w, amount) * smoothstep(3.0, 6.0, -view.z);
    gl_PointSize = clamp(0.3 * pixelsPerUnit / -view.z, 2.0, 9.0) * (0.55 + 0.45 * pulse);
  }
`;
const fireflyFragment = /* glsl */ `
  uniform vec3 color;
  varying float vGlow;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(color * a * vGlow, 1.0);
  }
`;

class Fireflies {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private presence = 0;
  private share = 1;

  constructor() {
    const rng = makeRandom(303);
    const positions: number[] = [];
    const seeds: number[] = [];
    let tries = 0;
    while (positions.length / 3 < MAX.fireflies && tries++ < 4000) {
      const angle = rng() * Math.PI * 2;
      const r = 9.5 + rng() * 15;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      if (z < RIVER_Z + RIVER_HALF + 0.6) continue;
      if (Object.values(SPOTS).some((s) => !isLater(s.id) && Math.hypot(x - s.pos.x, z - s.pos.z) < s.radius + 1.2)) continue;
      // One that would be inside a later building waits just outside it instead (so the random
      // numbers, and every other firefly, stay the same).
      let fx = x;
      let fz = z;
      for (const s of Object.values(SPOTS)) {
        const d = Math.hypot(fx - s.pos.x, fz - s.pos.z);
        if (!isLater(s.id) || d >= s.radius + 1.2) continue;
        const k = (s.radius + 1.2) / Math.max(d, 0.01);
        fx = s.pos.x + (fx - s.pos.x) * k;
        fz = s.pos.z + (fz - s.pos.z) * k;
      }
      positions.push(fx, 0.3 + rng() * 1.0, fz);
      seeds.push(rng(), rng(), rng(), rng());
    }
    // The bank of the river, where they gather most.
    for (let i = 0; i < 10; i++) {
      positions.splice(i * 3, 3, -28 + i * 3.4, 0.35 + rng() * 0.6, RIVER_Z + RIVER_HALF + 1.2 + rng() * 1.2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("seed", new THREE.Float32BufferAttribute(seeds, 4));
    this.material = new THREE.ShaderMaterial({
      vertexShader: fireflyVertex,
      fragmentShader: fireflyFragment,
      uniforms: {
        time: { value: 0 },
        amount: { value: 0 },
        pixelsPerUnit: { value: 500 },
        color: { value: new THREE.Color(1.0, 0.82, 0.38).multiplyScalar(3.0) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 21;
  }

  setShare(share: number): void {
    this.share = share;
  }

  update(dt: number, t: number, c: LifeConditions, pixelsPerUnit: number): void {
    const wanted = firefliesWanted(c);
    this.presence = c.still ? wanted : approach(this.presence, wanted, dt, 5);
    const u = this.material.uniforms;
    u.time!.value = t;
    u.amount!.value = this.presence * this.share;
    u.pixelsPerUnit!.value = pixelsPerUnit;
  }
}

// --- Ducks: a pair and three ducklings paddling along the near bank -----------------------

/**
 * The ducks' loop by the near bank, upstream of the library (open water the home view sees, with
 * no trees or buildings in front), clear of the dock and of the boat's lane: two straight runs
 * `a` from its middle to its ends, joined by half circles `b` across, so they turn gently. They
 * paddle round it at an even speed, a set distance apart. (Going round a thin ellipse at an even
 * angle, they all but stopped at its sharp ends and swam into each other there.)
 */
const DUCK_LOOP = { x: -23, z: RIVER_Z + 1.8, a: 4.5, b: 0.7, period: 70 };
/** How far apart along the loop the ducks swim, for each step of their `lag` (a duck is 0.8 long). */
const DUCK_SPACING = 1.0;

const LOOP_POINTS = [-1, 1].flatMap((end) =>
  Array.from({ length: 25 }, (_, i) => {
    const w = (end > 0 ? -Math.PI / 2 : Math.PI / 2) + (i / 24) * Math.PI;
    return new THREE.Vector3(DUCK_LOOP.x + end * (DUCK_LOOP.a - DUCK_LOOP.b) + Math.cos(w) * DUCK_LOOP.b, 0, DUCK_LOOP.z + Math.sin(w) * DUCK_LOOP.b);
  }),
);
LOOP_POINTS.push(LOOP_POINTS[0]!.clone());
const LOOP_LENGTH = LOOP_POINTS.slice(1).reduce((sum, p, i) => sum + p.distanceTo(LOOP_POINTS[i]!), 0);

/** The point `d` along the ducks' loop, going round and round. */
function alongLoop(d: number, out: THREE.Vector3): THREE.Vector3 {
  let left = ((d % LOOP_LENGTH) + LOOP_LENGTH) % LOOP_LENGTH;
  for (let i = 1; i < LOOP_POINTS.length; i++) {
    const a = LOOP_POINTS[i - 1]!;
    const b = LOOP_POINTS[i]!;
    const len = a.distanceTo(b);
    if (left <= len || i === LOOP_POINTS.length - 1) return out.lerpVectors(a, b, Math.min(1, left / len));
    left -= len;
  }
  return out.copy(LOOP_POINTS[0]!);
}

type DuckKind = "drake" | "hen" | "duckling";

function duck(kind: DuckKind): THREE.Group {
  const b = new ModelBuilder();
  const young = kind === "duckling";
  const body = young ? 0xe3c86a : kind === "hen" ? 0x9a7f5e : 0x8a7a66;
  const head = young ? 0xe9d27e : kind === "hen" ? 0x86694c : 0x355a4b;
  b.add(new THREE.SphereGeometry(0.22, 7, 5), body, { at: [0, 0.1, 0], scale: [0.95, 0.62, 1.45], jitter: 0.02 });
  b.add(new THREE.ConeGeometry(0.1, 0.18, 4), young ? body : kind === "hen" ? 0x7a6046 : 0x5d5246, { at: [0, 0.16, -0.32], rot: [-Math.PI / 2 - 0.5, 0, 0] });
  b.add(new THREE.CylinderGeometry(0.055, 0.075, 0.18, 6), head, { at: [0, 0.24, 0.17], rot: [0.35, 0, 0] });
  if (kind === "drake") b.add(new THREE.TorusGeometry(0.062, 0.016, 3, 8), 0xf0ebe0, { at: [0, 0.21, 0.155], rot: [Math.PI / 2 - 0.35, 0, 0] });
  b.add(new THREE.SphereGeometry(0.1, 6, 5), head, { at: [0, 0.33, 0.21] });
  b.box([0.07, 0.035, 0.12], 0xd98b3a, { at: [0, 0.31, 0.33] });
  for (const s of [-1, 1]) b.add(new THREE.SphereGeometry(0.018, 5, 4), 0x1c1a17, { at: [s * 0.086, 0.35, 0.25] });
  const g = b.build(kind);
  if (young) g.scale.setScalar(0.5);
  return g;
}

const duckAhead = new THREE.Vector3();
const duckBehind = new THREE.Vector3();
const duckSide = new THREE.Vector3();
const duckWay = new THREE.Vector3();

class Ducks {
  readonly group = new THREE.Group();
  private readonly ducks: { model: THREE.Group; lag: number; side: number }[] = [];

  constructor() {
    const parts: [DuckKind, number, number][] = [
      ["hen", 0, 0],
      ["drake", 1.1, 0.4],
      ["duckling", 2.4, 0],
      ["duckling", 3.4, 0.12],
      ["duckling", 4.4, -0.1],
    ];
    for (const [kind, lag, side] of parts) {
      const model = duck(kind);
      this.group.add(model);
      this.ducks.push({ model, lag, side });
    }
  }

  update(t: number): void {
    const travelled = (t / DUCK_LOOP.period) * LOOP_LENGTH;
    this.ducks.forEach(({ model, lag, side }, i) => {
      const d = travelled - lag * DUCK_SPACING;
      this.at(d, side, model.position);
      model.position.y = WATER_Y + Math.sin(t * 2 + i) * 0.015;
      // Facing along the way it's going.
      this.at(d + 0.15, side, duckAhead).sub(this.at(d - 0.15, side, duckBehind));
      model.rotation.y = Math.atan2(duckAhead.x, duckAhead.z);
      model.rotation.z = Math.sin(t * 1.6 + i) * 0.05;
    });
  }

  /** Where a duck is, `d` along the loop; `side` lets it drift a little to one side now and then. */
  private at(d: number, side: number, out: THREE.Vector3): THREE.Vector3 {
    alongLoop(d, out);
    if (side === 0) return out;
    alongLoop(d + 0.05, duckSide).sub(alongLoop(d - 0.05, duckWay)).normalize();
    const drift = side * Math.sin((d / LOOP_LENGTH) * Math.PI * 2 + 1.1) * 0.6;
    return out.set(out.x - duckSide.z * drift, out.y, out.z + duckSide.x * drift);
  }
}

// --- The cat: naps on the bench by Home, wanders to a sunny spot, curls up at night ----------

/** The bench it likes (the one at -22° round the plaza) and its sunny spot in the meadow. */
const BENCH_ANGLE = (-22 * Math.PI) / 180;
const BENCH = new THREE.Vector3(Math.cos(BENCH_ANGLE) * 9.2, 0, Math.sin(BENCH_ANGLE) * 9.2);
const BENCH_ROT = Math.atan2(-BENCH.x, -BENCH.z);
const SEAT = BENCH.clone().add(new THREE.Vector3(0.42, 0, 0.04).applyAxisAngle(new THREE.Vector3(0, 1, 0), BENCH_ROT)).setY(0.5);
/** A spot near the bench, given across it (x, to its right) and out in front (z). */
const byBench = (x: number, z: number) => BENCH.clone().add(new THREE.Vector3(x, 0, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), BENCH_ROT));
const SUNNY = new THREE.Vector3(11.4, 0, -6.6);
/**
 * Its way from the bench to the sunny spot: down in front of the seat, round the bench's end,
 * through the gap between the two flower beds behind it, then out across the grass. (Straight
 * there, it walked under the seat and through a bed.)
 */
const CAT_ROUTE = [byBench(0.42, 0.62), byBench(1.05, 0.45), byBench(1.0, -0.6), byBench(0.55, -1.6), byBench(0.3, -3.0), SUNNY];
const ROUTE_LENGTH = CAT_ROUTE.slice(1).reduce((sum, p, i) => sum + p.distanceTo(CAT_ROUTE[i]!), 0);

/** The point `d` along the cat's route (clamped to its ends). */
function alongRoute(d: number, out: THREE.Vector3): THREE.Vector3 {
  let left = Math.min(Math.max(d, 0), ROUTE_LENGTH);
  for (let i = 1; i < CAT_ROUTE.length; i++) {
    const a = CAT_ROUTE[i - 1]!;
    const b = CAT_ROUTE[i]!;
    const len = a.distanceTo(b);
    if (left <= len || i === CAT_ROUTE.length - 1) return out.lerpVectors(a, b, Math.min(1, left / len));
    left -= len;
  }
  return out.copy(SUNNY);
}
const aheadV = new THREE.Vector3();
const behindV = new THREE.Vector3();

type CatPose = "sit" | "walk" | "loaf" | "sleep";

const FUR = 0xc98a4b;
const FUR_DARK = 0xb3743c;
const WHITE = 0xefe6d6;
const PINK = 0xd99a94;

/** The head, centred on its origin, looking along +z; asleep, its eyes are shut (thin slits). */
function catHead(asleep = false): THREE.Group {
  const h = new ModelBuilder();
  h.add(new THREE.SphereGeometry(0.085, 8, 6), FUR, { scale: [1.12, 0.95, 1], jitter: 0.03 });
  h.add(new THREE.SphereGeometry(0.045, 6, 4), WHITE, { at: [0, -0.032, 0.058], scale: [1.3, 0.75, 0.85] });
  h.box([0.02, 0.013, 0.012], PINK, { at: [0, -0.012, 0.09] });
  for (const s of [-1, 1]) {
    h.add(new THREE.ConeGeometry(0.036, 0.078, 3), FUR, { at: [s * 0.052, 0.076, -0.008], rot: [0, Math.PI, s * 0.32] });
    h.add(new THREE.ConeGeometry(0.02, 0.05, 3), PINK, { at: [s * 0.05, 0.07, 0.004], rot: [0, Math.PI, s * 0.32] });
    if (asleep) h.box([0.026, 0.005, 0.01], 0x2a2620, { at: [s * 0.036, 0.008, 0.083], rot: [0, 0, s * -0.25] });
    else {
      h.add(new THREE.SphereGeometry(0.014, 6, 4), 0xd8b04a, { at: [s * 0.036, 0.012, 0.08], scale: [1.15, 0.85, 0.5] });
      h.box([0.005, 0.019, 0.006], 0x1f1b17, { at: [s * 0.036, 0.012, 0.0855] });
    }
  }
  return h.build("cat-head");
}

/** A tail lying along an arc round (cx, cz) at height y, from angle a0 to a1, thinning to a white tip. */
function curledTail(b: ModelBuilder, cx: number, cz: number, radius: number, a0: number, a1: number, y: number, r0 = 0.024): void {
  const n = 7;
  for (let i = 0; i < n; i++) {
    const t0 = a0 + ((a1 - a0) * i) / n;
    const t1 = a0 + ((a1 - a0) * (i + 1)) / n;
    const p0 = new THREE.Vector3(cx + Math.cos(t0) * radius, y, cz + Math.sin(t0) * radius);
    const p1 = new THREE.Vector3(cx + Math.cos(t1) * radius, y, cz + Math.sin(t1) * radius);
    const len = p0.distanceTo(p1);
    const r = r0 * (1 - (i / n) * 0.45);
    const g = new THREE.CylinderGeometry(r * 0.9, r, len * 1.15, 5).rotateX(Math.PI / 2).lookAt(p1.clone().sub(p0));
    g.translate((p0.x + p1.x) / 2, y, (p0.z + p1.z) / 2);
    b.add(g, i === n - 1 ? WHITE : i % 2 === 0 ? FUR : FUR_DARK, { jitter: 0.02 });
  }
}

/** Sitting up on its haunches, front paws together, tail round its feet. Origin on the seat. */
function catSitting(): THREE.Group {
  const b = new ModelBuilder();
  b.add(new THREE.SphereGeometry(0.12, 9, 6), FUR, { at: [0, 0.098, -0.04], scale: [1, 0.85, 1], jitter: 0.03 });
  b.add(new THREE.SphereGeometry(0.09, 8, 6), FUR, { at: [0, 0.22, 0.025], rot: [-0.2, 0, 0], scale: [0.86, 1.45, 0.95], jitter: 0.03 });
  b.add(new THREE.SphereGeometry(0.058, 8, 6), WHITE, { at: [0, 0.2, 0.08], scale: [0.95, 1.5, 0.6], jitter: 0.015 });
  for (const s of [-1, 1]) {
    b.add(new THREE.CylinderGeometry(0.02, 0.027, 0.2, 7), FUR, { at: [s * 0.043, 0.1, 0.085], jitter: 0.02 });
    b.add(new THREE.SphereGeometry(0.03, 7, 4), WHITE, { at: [s * 0.043, 0.012, 0.102], scale: [1, 0.55, 1.3], jitter: 0.015 });
    b.add(new THREE.SphereGeometry(0.035, 6, 4), FUR, { at: [s * 0.088, 0.016, 0.045], scale: [0.85, 0.5, 1.6] });
  }
  curledTail(b, 0, -0.03, 0.135, -1.1, 1.45, 0.024);
  return b.build("cat-sitting");
}

/** Lying in the sun like a loaf: legs tucked under, tail along its side. Origin on the ground. */
function catLoaf(): THREE.Group {
  const b = new ModelBuilder();
  b.add(new THREE.SphereGeometry(0.13, 9, 6), FUR, { at: [0, 0.094, -0.02], scale: [0.95, 0.72, 1.5], jitter: 0.03 });
  b.add(new THREE.SphereGeometry(0.07, 7, 5), WHITE, { at: [0, 0.08, 0.13], scale: [1, 0.85, 0.8] });
  // Its front paws tucked under its chest, their backs in its fur.
  for (const s of [-1, 1]) b.add(new THREE.SphereGeometry(0.028, 6, 4), WHITE, { at: [s * 0.045, 0.024, 0.165], scale: [1, 0.75, 1.9] });
  curledTail(b, 0.0, -0.02, 0.15, -1.75, 0.9, 0.024);
  return b.build("cat-loaf");
}

/** Curled up asleep: a ring of cat, nose to tail. Origin on the seat. */
function catAsleep(): THREE.Group {
  const b = new ModelBuilder();
  // One round, low body, with the haunch a rounder bump at the back of the curl.
  b.add(new THREE.SphereGeometry(0.13, 10, 7), FUR, { at: [0, 0.075, -0.01], scale: [1, 0.6, 0.82], jitter: 0.025 });
  b.add(new THREE.SphereGeometry(0.085, 8, 6), FUR, { at: [-0.065, 0.085, -0.03], scale: [1, 0.85, 1], jitter: 0.025 });
  b.add(new THREE.SphereGeometry(0.05, 7, 5), FUR_DARK, { at: [-0.03, 0.13, -0.035], scale: [1.6, 0.5, 1.1], jitter: 0.02 });
  // The tail, from the haunch round the front, its white tip by the nose.
  curledTail(b, 0, -0.01, 0.14, Math.PI + 0.4, 1.5, 0.024, 0.023);
  return b.build("cat-asleep");
}

class Cat {
  readonly group = new THREE.Group();
  private readonly sitting = catSitting();
  private readonly loaf = catLoaf();
  private readonly asleep = catAsleep();
  private readonly walking = new THREE.Group();
  private readonly head = catHead();
  private readonly sleepyHead = catHead(true);
  private readonly walkTail = new THREE.Group();
  private readonly legs: THREE.Group[] = [];
  /** Where it is in its day: seconds since it last sat down on the bench. */
  private clock = -1;

  constructor() {
    // Walking: a long body on four legs, tail up.
    const b = new ModelBuilder();
    b.add(new THREE.SphereGeometry(0.11, 9, 6), FUR, { at: [0, 0.2, -0.01], scale: [0.85, 0.8, 1.7], jitter: 0.03 });
    b.add(new THREE.SphereGeometry(0.058, 6, 4), WHITE, { at: [0, 0.175, 0.13], scale: [0.85, 1, 0.75] });
    this.walking.add(b.build("cat-walking"));
    for (const [x, z] of [[-0.05, 0.12], [0.05, 0.12], [-0.055, -0.12], [0.055, -0.12]] as const) {
      const lb = new ModelBuilder();
      lb.add(new THREE.CylinderGeometry(0.024, 0.019, 0.18, 5), FUR, { at: [0, -0.09, 0] });
      lb.add(new THREE.SphereGeometry(0.026, 6, 4), WHITE, { at: [0, -0.178, 0.012], scale: [1, 0.55, 1.3] });
      const leg = new THREE.Group();
      leg.add(lb.build("cat-leg"));
      leg.position.set(x, 0.19, z);
      this.legs.push(leg);
      this.walking.add(leg);
    }
    const tb = new ModelBuilder();
    tb.add(new THREE.CylinderGeometry(0.019, 0.025, 0.26, 5), FUR, { at: [0, 0.13, 0] });
    tb.add(new THREE.CylinderGeometry(0.016, 0.019, 0.1, 5), FUR_DARK, { at: [0, 0.29, 0.03], rot: [0.5, 0, 0] });
    tb.add(new THREE.SphereGeometry(0.017, 5, 4), WHITE, { at: [0, 0.335, 0.055] });
    this.walkTail.add(tb.build("cat-tail"));
    this.walkTail.position.set(0, 0.22, -0.18);
    this.walking.add(this.walkTail);
    // The sleeping head rests at the front of the curl, chin on the seat, nose to its tail.
    this.sleepyHead.position.set(0.075, 0.088, 0.075);
    this.sleepyHead.rotation.set(0.35, Math.atan2(-0.6, 0.8), 0.45, "YXZ");
    this.asleep.add(this.sleepyHead);
    this.group.add(this.sitting, this.loaf, this.asleep, this.walking, this.head);
  }

  update(dt: number, t: number, c: LifeConditions): void {
    const awake = catAwake(c);
    // A day: on the bench, down to the sunny spot, a long loaf in the sun, back up.
    const SIT = 26;
    const WALK = 8;
    const LOAF = 24;
    const DAY = SIT + WALK + LOAF + WALK;
    if (c.still) this.clock = 5;
    else if (this.clock < 0) this.clock = t % DAY;
    else if (awake || this.clock > SIT) this.clock = (this.clock + dt) % DAY; // finish the trip home first
    else this.clock = Math.min(this.clock + dt, SIT - 0.01);
    const k = this.clock;
    let pose: CatPose;
    const at = tmpV;
    let facing: number;
    if (k < SIT || k >= SIT + WALK + LOAF + WALK) {
      pose = awake ? "sit" : "sleep";
      at.copy(SEAT);
      facing = BENCH_ROT;
    } else if (k < SIT + WALK || k >= SIT + WALK + LOAF) {
      pose = "walk";
      const out = k < SIT + WALK;
      const f = out ? (k - SIT) / WALK : (k - SIT - WALK - LOAF) / WALK;
      // Along the route, out or back; it faces a little way ahead, so it turns smoothly.
      const d = (out ? f : 1 - f) * ROUTE_LENGTH;
      const step = out ? 1 : -1;
      alongRoute(d, at);
      alongRoute(d + step * 0.3, aheadV).sub(alongRoute(d - step * 0.1, behindV));
      // Jump down from the seat at the start, up onto it at the end, in an arc.
      const hop = out ? 1 - smooth(0, 0.1, f) : smooth(0.9, 1, f);
      if (hop > 0) {
        at.lerp(SEAT, hop);
        at.y += Math.sin(Math.PI * hop) * 0.18;
      }
      facing = Math.atan2(aheadV.x, aheadV.z);
    } else {
      pose = "loaf";
      at.copy(SUNNY);
      facing = 2.4;
    }
    this.group.position.copy(at);
    this.group.rotation.y = facing;
    this.sitting.visible = pose === "sit";
    this.loaf.visible = pose === "loaf";
    this.asleep.visible = pose === "sleep";
    this.walking.visible = pose === "walk";
    this.head.visible = pose !== "sleep";
    // The head: on top when sitting, low at the front when loafing or walking; it looks about.
    const look = Math.sin(t * 0.23) * 0.5 + Math.sin(t * 0.07) * 0.25;
    if (pose === "sit") {
      this.head.position.set(0, 0.385, 0.06);
      this.head.rotation.set(0.12 + Math.sin(t * 0.3) * 0.08, look, 0, "YXZ");
      // Breathing.
      this.sitting.scale.set(1, 1 + Math.sin(t * 1.6) * 0.012, 1);
    } else if (pose === "loaf") {
      this.head.position.set(0, 0.2, 0.16);
      this.head.rotation.set(0.05, look * 0.7, 0, "YXZ");
    } else if (pose === "walk") {
      this.head.position.set(0, 0.29, 0.21 + Math.sin(t * 10) * 0.004);
      this.head.rotation.set(0.1, look * 0.3, 0, "YXZ");
      this.legs.forEach((leg, i) => {
        // Diagonal pairs move together (a walk).
        const phase = i === 0 || i === 3 ? 0 : Math.PI;
        leg.rotation.x = Math.sin(t * 9 + phase) * 0.5;
      });
      this.walkTail.rotation.set(-0.35 + Math.sin(t * 2.1) * 0.08, 0, Math.sin(t * 1.7) * 0.25);
    } else {
      this.asleep.scale.set(1, 1 + Math.sin(t * 1.1) * 0.03, 1);
    }
  }
}

// --- Villagers: one draws water at the Archive well, one picks flowers; indoors at night or in rain ---

interface Errand {
  /** Where they sit, and the bench's turn. */
  bench: THREE.Vector3;
  benchRot: number;
  /** Where they go, and which way they face there. */
  spot: THREE.Vector3;
  spotFacing: number;
  /** What they do there. */
  task: "water" | "flowers";
  offset: number;
}

function villager(tunic: number, hat: "straw" | "cap"): { group: THREE.Group; body: THREE.Group; legs: THREE.Group[]; arms: THREE.Group[]; lantern: THREE.Mesh } {
  const group = new THREE.Group();
  const body = new THREE.Group();
  const b = new ModelBuilder();
  b.add(new THREE.CylinderGeometry(0.15, 0.2, 0.42, 7), tunic, { at: [0, 0.68, 0], jitter: 0.02 });
  b.add(new THREE.CylinderGeometry(0.205, 0.205, 0.05, 7), 0x6a5238, { at: [0, 0.55, 0] });
  b.add(new THREE.SphereGeometry(0.12, 7, 5), 0xd9a77e, { at: [0, 1.0, 0] });
  if (hat === "straw") {
    b.add(new THREE.CylinderGeometry(0.22, 0.22, 0.025, 10), 0xd8c27a, { at: [0, 1.09, 0] });
    b.add(new THREE.CylinderGeometry(0.1, 0.12, 0.09, 8), 0xd8c27a, { at: [0, 1.14, 0] });
  } else {
    b.add(new THREE.SphereGeometry(0.125, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0x4f5a6a, { at: [0, 1.04, 0] });
    b.box([0.16, 0.02, 0.1], 0x4f5a6a, { at: [0, 1.05, 0.12] });
  }
  body.add(b.build("villager"));
  const legs = [-1, 1].map((s) => {
    const leg = new THREE.Group();
    leg.position.set(s * 0.07, 0.48, 0);
    const lb = new ModelBuilder();
    lb.box([0.08, 0.44, 0.09], 0x5b4a3a, { at: [0, -0.22, 0] });
    lb.box([0.09, 0.05, 0.14], 0x3a2e24, { at: [0, -0.44, 0.03] });
    leg.add(lb.build("villager-leg"));
    body.add(leg);
    return leg;
  });
  const arms = [-1, 1].map((s) => {
    const arm = new THREE.Group();
    arm.position.set(s * 0.19, 0.84, 0);
    const ab = new ModelBuilder();
    ab.box([0.07, 0.34, 0.07], tunic, { at: [0, -0.16, 0] });
    ab.add(new THREE.SphereGeometry(0.04, 5, 4), 0xd9a77e, { at: [0, -0.35, 0] });
    arm.add(ab.build("villager-arm"));
    body.add(arm);
    return arm;
  });
  // A small lantern in the left hand, lit at dusk.
  const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.07), new THREE.MeshStandardMaterial({ color: 0xffd08a, emissive: 0xffb860, emissiveIntensity: 0, flatShading: true }));
  lantern.position.set(0, -0.42, 0.02);
  arms[0]!.add(lantern);
  group.add(body);
  return { group, body, legs, arms, lantern };
}

class Villagers {
  readonly group = new THREE.Group();
  private readonly people: (ReturnType<typeof villager> & { errand: Errand })[] = [];

  constructor(flowers: readonly [number, number][], beds: readonly FlowerBed[]) {
    const bench = (deg: number, r = 9.2) => {
      const a = (deg * Math.PI) / 180;
      return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
    };
    const errands: [number, number, Errand][] = [
      // She draws water at the Archive well, at its crank on the side (the robots who work there
      // stand at its front).
      [0x6f7d3c, 0, { bench: bench(69), benchRot: 0, spot: new THREE.Vector3(SPOTS.archive.pos.x + 2.1, 0, SPOTS.archive.pos.z), spotFacing: 0, task: "water", offset: 0 }],
      [0xa0522d, 1, { bench: bench(151), benchRot: 0, spot: new THREE.Vector3(-12.4, 0, 7.3), spotFacing: 0, task: "flowers", offset: 31 }],
    ];
    for (const [tunic, hat, errand] of errands) {
      errand.benchRot = Math.atan2(-errand.bench.x, -errand.bench.z);
      if (errand.task === "flowers") {
        // He tends the flower bed nearest his bench (if one is close), standing just off its soil
        // on the bench's side, so he bends to reach the flowers; failing that, the nearest patch
        // of wildflowers, just outside it (a patch spreads about 0.65 from its middle).
        const b = errand.bench;
        const near = (p: { x: number; z: number }) => Math.hypot(p.x - b.x, p.z - b.z);
        const bed = [...beds].sort((p, q) => near(p) - near(q))[0];
        const patch = [...flowers].map(([x, z]) => ({ x, z })).sort((p, q) => near(p) - near(q))[0];
        const target = bed && near(bed) < 4 ? bed : patch && near(patch) < 8 ? patch : undefined;
        if (target) {
          const toward = new THREE.Vector3(b.x - target.x, 0, b.z - target.z).normalize();
          const reach = target === bed ? bedReach(bed, toward.x, toward.z) + 0.3 : 1.0;
          errand.spot.set(target.x + toward.x * reach, 0, target.z + toward.z * reach);
        }
        errand.spotFacing = target ? Math.atan2(target.x - errand.spot.x, target.z - errand.spot.z) : 2.2;
      } else {
        errand.spotFacing = Math.atan2(SPOTS.archive.pos.x - errand.spot.x, SPOTS.archive.pos.z - errand.spot.z);
      }
      const v = villager(tunic, hat === 0 ? "straw" : "cap");
      this.group.add(v.group);
      this.people.push({ ...v, errand });
    }
  }

  update(t: number, c: LifeConditions): void {
    const out = villagersOut(c);
    const lit = lanternLight(c.night);
    const SIT = 30;
    const WALK = 5;
    const STAY = 12;
    const DAY = SIT + WALK + STAY + WALK;
    for (const p of this.people) {
      p.group.visible = out;
      if (!out) continue;
      const e = p.errand;
      // On the bench, the seat is just in front of the backrest.
      const seat = e.bench.clone().add(new THREE.Vector3(Math.sin(e.benchRot), 0, Math.cos(e.benchRot)).multiplyScalar(0.05));
      const stand = e.bench.clone().add(new THREE.Vector3(Math.sin(e.benchRot), 0, Math.cos(e.benchRot)).multiplyScalar(0.55));
      const k = c.still ? 3 : (t + e.offset) % DAY;
      let walking = false;
      let sitting = false;
      let working = false;
      if (k < SIT) {
        sitting = true;
        p.group.position.copy(seat);
        p.group.rotation.y = e.benchRot;
      } else if (k < SIT + WALK) {
        walking = true;
        const f = (k - SIT) / WALK;
        p.group.position.lerpVectors(stand, e.spot, f);
        p.group.rotation.y = Math.atan2(e.spot.x - stand.x, e.spot.z - stand.z);
      } else if (k < SIT + WALK + STAY) {
        working = true;
        p.group.position.copy(e.spot);
        p.group.rotation.y = e.spotFacing;
      } else {
        walking = true;
        const f = (k - SIT - WALK - STAY) / WALK;
        p.group.position.lerpVectors(e.spot, stand, f);
        p.group.rotation.y = Math.atan2(stand.x - e.spot.x, stand.z - e.spot.z);
      }
      const swing = walking ? Math.sin(t * 7) * 0.5 : 0;
      p.legs[0]!.rotation.x = sitting ? -1.45 : swing;
      p.legs[1]!.rotation.x = sitting ? -1.45 : -swing;
      p.body.position.y = sitting ? 0.03 : walking ? Math.abs(Math.sin(t * 7)) * 0.025 : 0;
      p.body.rotation.x = working && e.task === "flowers" ? 0.55 + Math.sin(t * 1.3) * 0.1 : 0;
      // Arms: swinging, resting on the lap, or at work (winding the well, picking).
      const water = working && e.task === "water";
      const pick = working && e.task === "flowers";
      p.arms[0]!.rotation.x = sitting ? -0.6 : walking ? -swing * 0.8 : water ? -1.25 + Math.sin(t * 2.6) * 0.35 : 0;
      p.arms[1]!.rotation.x = sitting ? -0.6 : walking ? swing * 0.8 : water ? -1.25 + Math.cos(t * 2.6) * 0.35 : pick ? -0.7 + Math.sin(t * 2) * 0.3 : 0;
      // (Always drawn, so its shader is ready before the first dusk.)
      (p.lantern.material as THREE.MeshStandardMaterial).emissiveIntensity = lit * 2.2;
      p.lantern.scale.setScalar(lit > 0.02 ? 1 : 0.001);
    }
  }
}

// --- A rowboat on the far side of the river: a fisherman drifts and rows by day -------------

/** The mooring post at the edge of the far bank, where the boat is tied up at night. */
const MOORING = new THREE.Vector3(-21.4, 0, RIVER_Z - RIVER_HALF - 0.55);
const ROPE = 2.4;
/**
 * By day the fisherman lets the boat drift down the far bank while he fishes, then turns it
 * and rows back up, over and over. Close in to the bank, so the float and the oars stay clear of
 * the boats' lane, and upstream of the library, where the home view sees the water.
 */
const TRIP = { from: -29.5, to: -18.5, z: RIVER_Z - RIVER_HALF + 0.95, drift: 80, turn: 5, row: 22 };
const TRIP_SECONDS = TRIP.drift + TRIP.turn + TRIP.row + TRIP.turn;
/** The rod, in the boat's own frame: where it's held, how long, how far it leans out (to the boat's left). */
const ROD = { base: new THREE.Vector3(-0.3, 0.42, -0.5), length: 1.6, lean: 0.6 };
const FLOAT = new THREE.Vector3(-0.85, 0.03, -0.5);
/** Where the oars turn, on the gunwale. */
const OARLOCK = { x: 0.43, y: 0.28, z: 0.02 };

function rowboat(): THREE.Group {
  const b = new ModelBuilder();
  // A solid hull, narrowing to a point at the bow and towards the keel.
  const hull = new THREE.BoxGeometry(0.9, 0.34, 1.9, 1, 1, 2);
  const p = hull.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const [x, y, z] = [p.getX(i), p.getY(i), p.getZ(i)];
    const bow = z > 0.5;
    p.setXYZ(i, x * (bow ? 0.08 : z < -0.5 ? 0.85 : 1) * (y < 0 ? 0.62 : 1), y + (bow && y > 0 ? 0.08 : 0), z);
  }
  b.add(hull, P.woodLight, { at: [0, 0.05, 0] });
  // Inside (the floor between the sides), the gunwale and two seats.
  b.box([0.62, 0.03, 0.95], P.wood, { at: [0, 0.215, -0.4] });
  // The gunwale follows the hull: straight along the sides, then in to the bow.
  for (const s of [-1, 1]) {
    b.box([0.06, 0.06, 0.95], P.wood, { at: [s * 0.42, 0.23, -0.47] });
    b.box([0.06, 0.06, 1.04], P.wood, { at: [s * 0.21, 0.27, 0.47], rot: [0, -s * 0.425, 0] });
  }
  for (const [z, w] of [[-0.55, 0.82], [0.12, 0.66]] as const) b.box([w, 0.05, 0.2], P.wood, { at: [0, 0.27, z] });
  return b.build("rowboat");
}

/** An oar, turning at its oarlock: the handle inboard, the blade out along +x (or -x for the left one). */
function oar(side: 1 | -1): THREE.Group {
  const b = new ModelBuilder();
  b.box([1.25, 0.04, 0.04], P.trunk, { at: [side * 0.25, 0, 0] });
  b.box([0.3, 0.02, 0.12], P.trunk, { at: [side * 0.8, 0, 0] });
  const g = new THREE.Group();
  g.add(b.build("oar"));
  g.position.set(side * OARLOCK.x, OARLOCK.y, OARLOCK.z);
  g.rotation.order = "YZX";
  return g;
}

class Rowboat {
  readonly group = new THREE.Group();
  private readonly boat = new THREE.Group();
  private readonly rope: THREE.Mesh;
  private readonly fisher: ReturnType<typeof villager>;
  private readonly rod = new THREE.Group();
  private readonly line: THREE.Mesh;
  private readonly float: THREE.Object3D;
  private readonly oars: [THREE.Group, THREE.Group] = [oar(-1), oar(1)];

  constructor() {
    this.boat.add(rowboat(), ...this.oars);
    // The post it's tied to at night.
    const post = new ModelBuilder();
    post.add(new THREE.CylinderGeometry(0.09, 0.11, 1.3, 6), P.wood, { at: [MOORING.x, 0.1, MOORING.z] });
    this.group.add(post.build("mooring"));
    const rope = new ModelBuilder();
    rope.add(new THREE.CylinderGeometry(0.02, 0.02, 1, 4), 0xcbb98f, { at: [0, 0.5, 0] });
    this.rope = rope.build("rope").children[0] as THREE.Mesh;
    this.rope.castShadow = false;
    this.fisher = villager(0x4f6478, "straw");
    this.fisher.lantern.scale.setScalar(0.001);
    const r = new ModelBuilder();
    r.add(new THREE.CylinderGeometry(0.012, 0.022, ROD.length, 4), P.trunk, { at: [0, ROD.length / 2, 0] });
    this.rod.add(r.build("rod"));
    this.rod.position.copy(ROD.base);
    // The line hangs from the rod's tip to a float on the water.
    const l = new ModelBuilder();
    l.add(new THREE.CylinderGeometry(0.006, 0.006, 1, 3), 0xe8e2d4, { at: [0, 0.5, 0] });
    this.line = l.build("line").children[0] as THREE.Mesh;
    this.line.castShadow = false;
    const fl = new ModelBuilder();
    fl.add(new THREE.SphereGeometry(0.05, 6, 4), 0xe39a4a, { scale: [1, 0.8, 1] });
    fl.add(new THREE.SphereGeometry(0.035, 6, 4), 0xf0ebe0, { at: [0, 0.035, 0] });
    this.float = fl.build("float");
    this.float.position.copy(FLOAT);
    this.boat.add(this.fisher.group, this.rod, this.line, this.float);
    this.group.add(this.boat, this.rope);
  }

  update(t: number, c: LifeConditions): void {
    const out = villagersOut(c);
    const bob = WATER_Y - 0.02 + Math.sin(t * 1.7) * 0.02;
    this.rope.visible = !out;
    for (const o of [this.fisher.group, this.rod, this.line, this.float]) o.visible = out;
    if (!out) {
      // Tied up for the night: it swings slowly on its rope, bow to the post, oars shipped.
      const swing = 0.35 + Math.sin(t * 0.11) * 0.07 + Math.sin(t * 0.047 + 1) * 0.04;
      const dir = tmpV.set(Math.cos(swing), 0, Math.sin(swing));
      this.boat.position.set(MOORING.x + dir.x * ROPE, bob, MOORING.z + dir.z * ROPE);
      this.boat.rotation.set(Math.sin(t * 1.1) * 0.02, Math.atan2(-dir.x, -dir.z), Math.sin(t * 1.3) * 0.04, "YXZ");
      const bow = new THREE.Vector3(0, 0.25, 1.0).applyEuler(this.boat.rotation).add(this.boat.position);
      const top = new THREE.Vector3(MOORING.x, 0.65, MOORING.z);
      const along = bow.clone().sub(top);
      this.rope.position.copy(top);
      this.rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), along.clone().normalize());
      this.rope.scale.set(1, along.length(), 1);
      this.shipOars();
      return;
    }
    // By day: drift down fishing, turn, row back up, turn.
    const k = t % TRIP_SECONDS;
    const ease = (f: number) => f * f * (3 - 2 * f);
    let x: number;
    let yaw: number;
    let rowing = true;
    if (k < TRIP.drift) {
      rowing = false;
      x = TRIP.from + (TRIP.to - TRIP.from) * (k / TRIP.drift);
      yaw = Math.PI / 2; // drifting bow first, downstream
    } else if (k < TRIP.drift + TRIP.turn) {
      x = TRIP.to;
      yaw = Math.PI / 2 - Math.PI * ease((k - TRIP.drift) / TRIP.turn);
    } else if (k < TRIP.drift + TRIP.turn + TRIP.row) {
      x = TRIP.to + (TRIP.from - TRIP.to) * ease((k - TRIP.drift - TRIP.turn) / TRIP.row);
      yaw = -Math.PI / 2; // rowed bow first, upstream
    } else {
      x = TRIP.from;
      yaw = -Math.PI / 2 + Math.PI * ease((k - TRIP.drift - TRIP.turn - TRIP.row) / TRIP.turn);
    }
    const stroke = t * 2.6;
    this.boat.position.set(x, bob, TRIP.z);
    this.boat.rotation.set(rowing ? Math.sin(stroke) * 0.015 : 0, yaw, Math.sin(t * 1.3) * 0.04, "YXZ");
    const f = this.fisher;
    f.legs.forEach((leg) => (leg.rotation.x = -1.45));
    f.body.position.y = 0.03;
    this.rod.visible = this.line.visible = this.float.visible = !rowing;
    if (rowing) {
      // On the middle seat, facing the stern, pulling on the oars.
      f.group.position.set(0, 0.27 - 0.5, 0.12);
      f.group.rotation.y = Math.PI;
      f.body.rotation.x = -Math.sin(stroke) * 0.18;
      f.arms.forEach((arm) => (arm.rotation.x = -1.25 + Math.sin(stroke) * 0.45));
      this.oars.forEach((o, i) => {
        const side = i === 0 ? -1 : 1;
        o.rotation.set(0, side * Math.sin(stroke) * 0.5, side * -(0.28 + 0.12 * Math.cos(stroke)));
      });
      return;
    }
    // On the back seat, facing out over the water (to the boat's left, the village's side), fishing.
    f.group.position.set(0, 0.27 - 0.5, -0.5);
    f.group.rotation.y = -Math.PI / 2;
    f.body.rotation.x = 0;
    f.arms.forEach((arm) => (arm.rotation.x = -1.05 + Math.sin(t * 0.9) * 0.04));
    this.shipOars();
    const lean = ROD.lean + Math.sin(t * 0.9) * 0.03;
    this.rod.rotation.z = lean;
    const tip = ROD.base.clone().add(new THREE.Vector3(-Math.sin(lean), Math.cos(lean), 0).multiplyScalar(ROD.length));
    this.float.position.y = FLOAT.y + Math.sin(t * 2.3) * 0.015;
    const drop = this.float.position.clone().sub(tip);
    this.line.position.copy(tip);
    this.line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), drop.clone().normalize());
    this.line.scale.set(1, drop.length(), 1);
  }

  /** Oars in, lying along the sides. */
  private shipOars(): void {
    this.oars.forEach((o, i) => o.rotation.set(0, (i === 0 ? -1 : 1) * (Math.PI / 2 - 0.06), 0));
  }
}

// --- All of it -----------------------------------------------------------------------------

export class Life {
  readonly group = new THREE.Group();
  private readonly birds: Birds;
  private readonly butterflies: Butterflies;
  private readonly fireflies = new Fireflies();
  private readonly ducks = new Ducks();
  private readonly cat = new Cat();
  private readonly villagers: Villagers;
  private readonly rowboat = new Rowboat();

  /** `flowers`: where the patches of wildflowers are (the butterflies visit them); `beds`: the flower beds. */
  constructor(material: THREE.Material, flowers: readonly [number, number][], beds: readonly FlowerBed[]) {
    this.group.name = "life";
    this.birds = new Birds(material);
    this.butterflies = new Butterflies(material, flowers);
    this.villagers = new Villagers(flowers, beds);
    this.group.add(this.birds.body, ...this.birds.wings, ...this.butterflies.wings, this.fireflies.points, this.ducks.group, this.cat.group, this.villagers.group, this.rowboat.group);
    // Creatures look the same in any weather (no snow on a duck's back).
    keepDry(this.group);
    this.setTier("high");
  }

  private tier: Tier | null = null;

  setTier(tier: Tier): void {
    if (tier === this.tier) return;
    this.tier = tier;
    const n = COUNTS[tier];
    this.birds.setCount(n.birds);
    this.butterflies.setCount(n.butterflies);
    this.fireflies.setShare(n.fireflies / MAX.fireflies);
  }

  update(dt: number, time: number, c: LifeConditions, camera: THREE.PerspectiveCamera, drawHeight: number): void {
    const t = c.still ? STILL_T : time;
    const step = c.still ? 0 : dt;
    this.birds.update(step, t, c);
    this.butterflies.update(step, t, c);
    this.fireflies.update(step, t, c, drawHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)));
    this.ducks.update(t);
    this.cat.update(step, t, c);
    this.villagers.update(t, c);
    this.rowboat.update(t, c);
  }
}

