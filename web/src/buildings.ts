// Building models, all made from simple shapes in code (no images).
// Each building faces +z in its own space; the village turns it to face the plaza.

import * as THREE from "three";
import type { Building } from "../../src/events/types.js";
import { wavingFlag } from "./flag.js";
import { addWindowBox } from "./flora.js";
import { glowMesh, makeRandom, materials, ModelBuilder, pick } from "./lowpoly.js";
import { P } from "./palette.js";

/** Shared glowing materials, so day/night can change them all at once. */
export const glowMaterials = {
  window: new THREE.MeshStandardMaterial({
    color: 0x3a4654,
    emissive: P.warmLight,
    emissiveIntensity: 0.04,
    roughness: 0.25,
    metalness: 0.2,
    flatShading: true,
  }),
  lantern: new THREE.MeshStandardMaterial({
    color: P.warmLight,
    emissive: P.warmLight,
    emissiveIntensity: 0.55,
    flatShading: true,
  }),
};

export interface BuildingModel {
  id: Building;
  group: THREE.Group;
  /** Chimney tops, in the building's own space (for smoke). */
  chimneys: THREE.Vector3[];
  /** Spots for effects such as bubbling flasks, in the building's own space. */
  extras: Record<string, THREE.Vector3[]>;
  /** Called every frame. `still` = nothing should move (--no-animation or reduced motion). */
  update(dt: number, t: number, active: boolean, still: boolean): void;
}

const shadeOf = (hex: number, amount: number) => new THREE.Color(hex).offsetHSL(0, 0, amount).getHex();
const ROOF_TILES = [P.roof, P.roof, P.roof2, P.roof3];

// ---------------------------------------------------------------------------
// Small parts
// ---------------------------------------------------------------------------

/** A window on a wall. The wall surface is at z = 0, outside is +z. */
function windowOn(b: ModelBuilder, shutter: number, w = 0.5, h = 0.64): void {
  b.box([w + 0.16, 0.08, 0.1], P.wood, { at: [0, h / 2 + 0.04, 0.04] });
  b.box([w + 0.16, 0.08, 0.1], P.wood, { at: [0, -h / 2 - 0.04, 0.04] });
  b.box([0.08, h, 0.1], P.wood, { at: [-w / 2 - 0.04, 0, 0.04] });
  b.box([0.08, h, 0.1], P.wood, { at: [w / 2 + 0.04, 0, 0.04] });
  b.box([0.04, h, 0.05], P.wood, { at: [0, 0, 0.03] });
  b.box([w, h, 0.04], 0xffffff, { at: [0, 0, 0.0], material: glowMaterials.window });
  b.box([w + 0.32, 0.07, 0.18], P.stone, { at: [0, -h / 2 - 0.11, 0.08] });
  b.box([w / 2 + 0.03, h + 0.06, 0.04], shutter, { at: [-w / 2 - 0.22, 0, 0.12], rot: [0, 0.4, 0] });
  b.box([w / 2 + 0.03, h + 0.06, 0.04], shutter, { at: [w / 2 + 0.22, 0, 0.12], rot: [0, -0.4, 0] });
}

/** A door with a frame. Its bottom is at y = 0, on a wall at z = 0. */
function doorOn(b: ModelBuilder, color: number, w = 0.9, h = 1.6): void {
  b.box([w + 0.24, 0.15, 0.16], P.wood, { at: [0, h + 0.075, 0.06] });
  b.box([0.12, h, 0.14], P.wood, { at: [-w / 2 - 0.06, h / 2, 0.05] });
  b.box([0.12, h, 0.14], P.wood, { at: [w / 2 + 0.06, h / 2, 0.05] });
  b.box([w, h, 0.06], color, { at: [0, h / 2, 0.01] });
  for (const x of [-w / 6, w / 6]) b.box([0.025, h * 0.92, 0.02], shadeOf(color, -0.08), { at: [x, h / 2, 0.05] });
  b.add(new THREE.SphereGeometry(0.05, 6, 4), P.brass, { at: [w * 0.33, h * 0.48, 0.07], material: materials.metal });
}

/** A lantern hanging from a bracket on a wall. */
function lanternOn(b: ModelBuilder): void {
  const metal = materials.metal;
  b.box([0.05, 0.05, 0.36], P.iron, { at: [0, 0, 0.18], material: metal });
  b.box([0.04, 0.26, 0.04], P.iron, { at: [0, -0.13, 0.03], rot: [0.6, 0, 0], material: metal });
  b.box([0.2, 0.05, 0.2], P.iron, { at: [0, -0.07, 0.36], material: metal });
  b.box([0.14, 0.2, 0.14], P.warmLight, { at: [0, -0.2, 0.36], material: glowMaterials.lantern });
  b.box([0.18, 0.04, 0.18], P.iron, { at: [0, -0.32, 0.36], material: metal });
}

/** Stone steps leading up to a door. */
function steps(b: ModelBuilder, z: number, width = 1.5): void {
  b.box([width, 0.15, 0.32], P.stone, { at: [0, 0.075, z + 0.62] });
  b.box([width - 0.15, 0.15, 0.3], P.stone, { at: [0, 0.225, z + 0.36] });
  b.box([width - 0.3, 0.15, 0.24], P.stone, { at: [0, 0.375, z + 0.14] });
}

/** The triangle-shaped attic under a gable roof (ridge runs left to right). */
function attic(b: ModelBuilder, w: number, d: number, rise: number, y: number, color: number): void {
  const shape = new THREE.Shape();
  shape.moveTo(-d / 2, 0);
  shape.lineTo(d / 2, 0);
  shape.lineTo(0, rise);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  g.translate(0, 0, -w / 2);
  g.rotateY(Math.PI / 2);
  b.add(g, color, { at: [0, y, 0], jitter: 0.03 });
}

/** A gable roof made of offset rows of tiles, each a slightly different color. */
function roof(
  b: ModelBuilder,
  o: { width: number; depth: number; y: number; rise: number; overhang: number; rng: () => number },
): void {
  const angle = Math.atan2(o.rise, o.depth / 2);
  const length = (o.depth / 2 + o.overhang) / Math.cos(angle);
  const rows = Math.ceil(length / 0.3);
  const tileW = 0.44;
  const thick = 0.07;
  const count = Math.ceil(o.width / tileW) + 1;
  for (const side of [1, -1]) {
    // A solid layer under the tiles, so there are no gaps.
    const mid = length / 2;
    b.box([o.width, 0.06, length], shadeOf(P.roof2, -0.12), {
      at: [0, o.y + o.rise - mid * Math.sin(angle), side * mid * Math.cos(angle)],
      rot: [side * angle, 0, 0],
    });
    for (let r = 0; r < rows; r++) {
      const s = (r + 0.5) * (length / rows);
      const z = side * s * Math.cos(angle);
      const y = o.y + o.rise - s * Math.sin(angle) + thick;
      const offset = (r % 2) * (tileW / 2);
      for (let i = 0; i < count; i++) {
        const x = -o.width / 2 + i * tileW + offset - tileW / 4;
        if (x > o.width / 2 - tileW / 4 || x < -o.width / 2 + tileW / 4) continue;
        b.box([tileW * 0.95, thick, (length / rows) * 1.25], pick(ROOF_TILES, o.rng), {
          at: [x, y, z],
          rot: [side * angle + (o.rng() - 0.5) * 0.05, (o.rng() - 0.5) * 0.04, 0],
          jitter: 0.06,
        });
      }
    }
  }
  b.box([o.width + 0.1, 0.16, 0.3], shadeOf(P.roof2, -0.08), { at: [0, o.y + o.rise + 0.12, 0] });
}

interface CottageSpec {
  w: number;
  d: number;
  h: number;
  wall: number;
  upper?: number;
  shutter: number;
  rng: () => number;
  chimney?: boolean;
  door?: boolean;
  /** Leave this much space in the middle of the front free of windows. */
  clearCenter?: number;
}

interface CottageInfo {
  chimneyTop?: THREE.Vector3;
  ridgeY: number;
  wallTop: number;
  front: number;
}

const BASE = 0.45;

/** A two-storey cottage: stone base, trim band, tiled gable roof, chimney, windows with shutters, door, steps and a lantern. */
function cottage(b: ModelBuilder, s: CottageSpec): CottageInfo {
  const { w, d, h, rng } = s;
  const upper = s.upper ?? s.wall;
  const front = d / 2;

  // Stone base, with a few blocks that stick out a little.
  b.box([w + 0.3, BASE, d + 0.3], P.stoneDark, { at: [0, BASE / 2, 0], jitter: 0.07 });
  for (const row of [0, 1]) {
    for (let x = -w / 2 - 0.1 + row * 0.25; x < w / 2; ) {
      const len = 0.38 + rng() * 0.3;
      if (x + len > w / 2 + 0.12) break;
      b.box([len - 0.04, 0.19, 0.06], pick([P.stone, P.stoneDark, 0xb3ad9f], rng), {
        at: [x + len / 2, 0.12 + row * 0.21, front + 0.17],
      });
      x += len;
    }
  }

  // Ground floor, trim band, upper floor with timber corners.
  b.box([w, h, d], s.wall, { at: [0, BASE + h / 2, 0], jitter: 0.03 });
  const trimY = BASE + h;
  b.box([w + 0.18, 0.16, d + 0.18], P.wood, { at: [0, trimY, 0] });
  const h2 = h * 0.92;
  const upperY = trimY + 0.08;
  const wallTop = upperY + h2;
  b.box([w, h2, d], upper, { at: [0, upperY + h2 / 2, 0], jitter: 0.03 });
  for (const x of [-w / 2, w / 2]) {
    for (const z of [-d / 2, d / 2]) b.box([0.15, h2, 0.15], P.wood, { at: [x, upperY + h2 / 2, z] });
  }

  // Roof.
  const rise = d * 0.55;
  attic(b, w, d, rise, wallTop, upper);
  roof(b, { width: w + 0.55, depth: d, y: wallTop, rise, overhang: 0.45, rng });

  // Front door, steps and lantern.
  if (s.door !== false) {
    b.push([0, BASE, front]);
    doorOn(b, s.shutter);
    b.pop();
    steps(b, front + 0.15);
    b.push([0.9, BASE + 1.9, front]);
    lanternOn(b);
    b.pop();
  }

  // Windows: front and back (both floors), and one on each floor of each side, so no wall is
  // left blank whichever way it's seen from.
  const n = Math.max(2, Math.round(w / 1.45));
  const clear = s.clearCenter ?? 0.95;
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + ((i + 0.5) * w) / n;
    if (Math.abs(x) > clear) {
      b.push([x, BASE + h * 0.56, front]);
      windowOn(b, s.shutter);
      b.pop();
    }
    if (s.clearCenter === undefined || Math.abs(x) > clear) {
      b.push([x, upperY + h2 * 0.52, front]);
      windowOn(b, s.shutter);
      b.pop();
    }
  }
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + ((i + 0.5) * w) / n;
    for (const y of [BASE + h * 0.56, upperY + h2 * 0.52]) {
      b.push([x, y, -front], Math.PI);
      windowOn(b, s.shutter);
      b.pop();
    }
  }
  for (const side of [-1, 1]) {
    for (const y of [BASE + h * 0.56, upperY + h2 * 0.52]) {
      b.push([side * (w / 2), y, 0], (side * Math.PI) / 2);
      windowOn(b, s.shutter);
      b.pop();
    }
  }

  // Chimney on the back slope.
  let chimneyTop: THREE.Vector3 | undefined;
  if (s.chimney !== false) {
    const cx = w * 0.28;
    const cz = -d * 0.2;
    const ch = rise + 1.0;
    b.box([0.6, ch, 0.6], 0x9b6b52, { at: [cx, wallTop + ch / 2, cz], jitter: 0.1 });
    b.box([0.76, 0.16, 0.76], P.stoneDark, { at: [cx, wallTop + ch, cz] });
    chimneyTop = new THREE.Vector3(cx, wallTop + ch + 0.25, cz);
  }
  return { chimneyTop, ridgeY: wallTop + rise, wallTop, front };
}

/** The window boxes' flowers have their own random numbers (see flora.ts). */
const boxBloom = makeRandom(6161);

function flowerBox(b: ModelBuilder, x: number, y: number, z: number, rng: () => number): void {
  b.box([0.8, 0.18, 0.22], P.woodLight, { at: [x, y, z] });
  b.box([0.72, 0.02, 0.16], 0x5b4634, { at: [x, y + 0.085, z] });
  // (Ten random numbers, as the old flowers took, so the rest of the building stays the same.)
  for (let i = 0; i < 10; i++) rng();
  addWindowBox(b, x, y + 0.09, z, 0.8, boxBloom);
}

const noop = () => {};

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

function home(): BuildingModel {
  const rng = makeRandom(11);
  const b = new ModelBuilder();
  const info = cottage(b, { w: 4.4, d: 3.6, h: 1.45, wall: P.ochre, shutter: P.teal, rng });
  flowerBox(b, -1.45, BASE + 0.55, info.front + 0.2, rng);
  flowerBox(b, 1.45, BASE + 0.55, info.front + 0.2, rng);
  // A bench by the door for resting robots.
  b.box([1.3, 0.08, 0.38], P.woodLight, { at: [-1.6, 0.45, info.front + 1.2] });
  b.box([1.3, 0.34, 0.07], P.woodLight, { at: [-1.6, 0.66, info.front + 1.02] });
  for (const x of [-2.1, -1.1]) b.box([0.08, 0.42, 0.3], P.wood, { at: [x, 0.21, info.front + 1.2] });
  return { id: "home", group: b.build("home"), chimneys: info.chimneyTop ? [info.chimneyTop] : [], extras: {}, update: noop };
}

function workshop(): BuildingModel {
  const rng = makeRandom(22);
  const b = new ModelBuilder();
  const info = cottage(b, { w: 4.4, d: 3.6, h: 1.45, wall: P.ochre, upper: 0xd2b07a, shutter: P.teal, rng });
  // Anvil on a stump by the door.
  const ax = -1.75;
  const az = info.front + 1.05;
  b.add(new THREE.CylinderGeometry(0.3, 0.36, 0.5, 7), P.wood, { at: [ax, 0.25, az] });
  b.box([0.3, 0.16, 0.22], P.iron, { at: [ax, 0.58, az], material: materials.metal });
  b.box([0.6, 0.18, 0.26], P.iron, { at: [ax, 0.75, az], material: materials.metal });
  b.add(new THREE.ConeGeometry(0.11, 0.32, 6), P.iron, { at: [ax + 0.44, 0.76, az], rot: [0, 0, -Math.PI / 2], material: materials.metal });
  b.box([0.5, 0.05, 0.05], P.wood, { at: [ax - 0.05, 0.9, az + 0.05], rot: [0, 0.5, 0.2] }); // hammer handle
  b.box([0.12, 0.1, 0.1], P.iron, { at: [ax + 0.18, 0.92, az + 0.18], material: materials.metal });
  // Forge: a stone box with glowing coals.
  const fx = 1.75;
  b.box([0.9, 0.6, 0.7], P.stoneDark, { at: [fx, 0.3, info.front + 0.9], jitter: 0.08 });
  const group = b.build("workshop");
  const coals = glowMesh(new THREE.BoxGeometry(0.7, 0.08, 0.5), 0xff8a3d, 0.8);
  coals.position.set(fx, 0.62, info.front + 0.9);
  group.add(coals);
  return {
    id: "workshop",
    group,
    chimneys: info.chimneyTop ? [info.chimneyTop] : [],
    extras: { sparks: [new THREE.Vector3(ax + 0.1, 0.9, az)], forge: [coals.position.clone()] },
    update: (_dt, t, active) => {
      coals.material.emissiveIntensity = (active ? 1.8 : 0.6) + Math.sin(t * 9) * (active ? 0.4 : 0.1);
    },
  };
}

function lab(): BuildingModel {
  const rng = makeRandom(33);
  const b = new ModelBuilder();
  const info = cottage(b, { w: 4.4, d: 3.6, h: 1.45, wall: P.warmGrey, shutter: P.purple, rng });
  const group = b.build("lab");
  // Flasks at the ends of the top and bottom steps (wholly on them), with glowing liquid.
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xdff4f2, transparent: true, opacity: 0.35, roughness: 0.1, flatShading: true });
  const spots: THREE.Vector3[] = [];
  const liquids: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = [];
  const flasks: [number, number, number, number][] = [
    [-0.42, 0.45, info.front + 0.29, 0x7cf06a],
    [0.42, 0.45, info.front + 0.29, 0x6fe3ff],
    [-0.57, 0.15, info.front + 0.79, 0xd46bf0],
    [0.57, 0.15, info.front + 0.79, 0xf2e16b],
  ];
  for (const [x, y, z, color] of flasks) {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), glassMat);
    body.position.set(x, y + 0.14, z);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.16, 6), glassMat);
    neck.position.set(x, y + 0.34, z);
    const liquid = glowMesh(new THREE.SphereGeometry(0.105, 8, 5, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65), color, 0.6);
    liquid.position.set(x, y + 0.13, z);
    group.add(body, neck, liquid);
    liquids.push(liquid);
    spots.push(new THREE.Vector3(x, y + 0.42, z));
  }
  return {
    id: "lab",
    group,
    chimneys: info.chimneyTop ? [info.chimneyTop] : [],
    extras: { flasks: spots },
    update: (_dt, t, active) => {
      liquids.forEach((l, i) => {
        l.material.emissiveIntensity = (active ? 1.6 : 0.5) + Math.sin(t * 4 + i * 1.7) * 0.25;
      });
    },
  };
}

function townhall(): BuildingModel {
  const rng = makeRandom(44);
  const b = new ModelBuilder();
  const info = cottage(b, {
    w: 7.8,
    d: 5,
    h: 1.75,
    wall: P.ochre,
    shutter: P.purple,
    rng,
    door: false,
    chimney: true,
    clearCenter: 1.6,
  });
  // Tower at the front middle.
  const tw = 2.5;
  const tz = info.front - 0.85;
  const towerH = 7.6;
  b.box([tw + 0.3, BASE, tw + 0.3], P.stoneDark, { at: [0, BASE / 2, tz] });
  b.box([tw, towerH, tw], P.warmGrey, { at: [0, BASE + towerH / 2, tz], jitter: 0.03 });
  for (const y of [BASE + 1.9, BASE + 3.8, BASE + towerH]) b.box([tw + 0.2, 0.18, tw + 0.2], P.wood, { at: [0, y, tz] });
  // Double door and steps.
  b.push([0, BASE, tz + tw / 2]);
  doorOn(b, P.purple, 1.3, 1.75);
  b.pop();
  steps(b, tz + tw / 2 + 0.15, 2.0);
  b.push([-1.0, BASE + 2.0, tz + tw / 2]);
  lanternOn(b);
  b.pop();
  b.push([1.0, BASE + 2.0, tz + tw / 2]);
  lanternOn(b);
  b.pop();
  b.push([0, BASE + 2.8, tz + tw / 2]);
  windowOn(b, P.purple, 0.55, 0.8);
  b.pop();
  // Clock face.
  const clockY = BASE + 5.7;
  b.add(new THREE.CylinderGeometry(0.7, 0.7, 0.1, 16), P.cream, { at: [0, clockY, tz + tw / 2 + 0.05], rot: [Math.PI / 2, 0, 0] });
  b.add(new THREE.TorusGeometry(0.72, 0.07, 4, 16), P.brass, { at: [0, clockY, tz + tw / 2 + 0.08], material: materials.metal });
  b.box([0.06, 0.5, 0.04], P.wood, { at: [0, clockY + 0.2, tz + tw / 2 + 0.13] });
  b.box([0.36, 0.06, 0.04], P.wood, { at: [0.16, clockY, tz + tw / 2 + 0.13] });
  // Pyramid roof and flagpole.
  const roofY = BASE + towerH;
  b.add(new THREE.ConeGeometry(2.15, 2.2, 4), P.roof2, { at: [0, roofY + 1.1, tz], rot: [0, Math.PI / 4, 0], jitter: 0.08 });
  b.add(new THREE.CylinderGeometry(0.04, 0.05, 2.3, 6), P.iron, { at: [0, roofY + 3.2, tz], material: materials.metal });
  b.add(new THREE.SphereGeometry(0.09, 6, 4), P.brass, { at: [0, roofY + 4.38, tz], material: materials.metal });
  const group = b.build("townhall");

  // The flag waves in the wind (flag.ts), faster while the village is busy.
  const flag = wavingFlag(1.5, 0.85, P.purple);
  flag.mesh.position.set(0.05, roofY + 3.85, tz);
  group.add(flag.mesh);
  return {
    id: "townhall",
    group,
    chimneys: info.chimneyTop ? [info.chimneyTop] : [],
    extras: {},
    update: (dt, _t, active, still) => flag.update(dt, still, active),
  };
}

function library(): BuildingModel {
  const rng = makeRandom(55);
  const b = new ModelBuilder();
  const w = 4.2;
  const d = 4;
  const storey = 1.6;
  const front = d / 2;
  b.box([w + 0.35, BASE, d + 0.35], P.stoneDark, { at: [0, BASE / 2, 0], jitter: 0.07 });
  for (let i = 0; i < 3; i++) {
    const y = BASE + i * (storey + 0.14);
    b.box([w, storey, d], i === 0 ? P.stone : P.warmGrey, { at: [0, y + storey / 2, 0], jitter: 0.03 });
    b.box([w + 0.2, 0.14, d + 0.2], P.wood, { at: [0, y + storey + 0.07, 0] });
    for (const x of [-1.25, 0, 1.25]) {
      if (i === 0 && x === 0) continue;
      b.push([x, y + storey * 0.55, front]);
      windowOn(b, P.teal, 0.44, 0.9);
      b.pop();
    }
    for (const side of [-1, 1]) {
      b.push([side * (w / 2), y + storey * 0.55, 0], (side * Math.PI) / 2);
      windowOn(b, P.teal, 0.44, 0.9);
      b.pop();
    }
  }
  const top = BASE + 3 * (storey + 0.14);
  b.box([w + 0.4, 0.25, d + 0.4], P.stone, { at: [0, top + 0.12, 0] });
  // Door with columns.
  b.push([0, BASE, front]);
  doorOn(b, P.teal, 1.0, 1.5);
  b.pop();
  steps(b, front + 0.15, 1.8);
  for (const x of [-0.95, 0.95]) {
    b.add(new THREE.CylinderGeometry(0.13, 0.15, 1.75, 8), P.cream, { at: [x, BASE + 0.87, front + 0.3] });
  }
  b.box([2.4, 0.2, 0.55], P.cream, { at: [0, BASE + 1.84, front + 0.28] });
  b.push([1.5, BASE + 1.85, front]);
  lanternOn(b);
  b.pop();
  // Observatory drum and dome.
  b.add(new THREE.CylinderGeometry(1.75, 1.85, 0.8, 12), P.stone, { at: [0, top + 0.65, 0], jitter: 0.06 });
  const group = b.build("library");

  const dome = new THREE.Group();
  dome.position.set(0, top + 1.05, 0);
  const db = new ModelBuilder();
  db.add(new THREE.SphereGeometry(1.72, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0x5d968f, { jitter: 0.07 });
  db.box([0.5, 1.2, 1.9], 0x2c3a3c, { at: [0, 0.75, 0.75], rot: [-0.55, 0, 0] });
  dome.add(db.build("dome"));
  const telescope = new ModelBuilder()
    .add(new THREE.CylinderGeometry(0.16, 0.24, 2.3, 8), P.brass, { at: [0, 0, 0], material: materials.metal })
    .add(new THREE.TorusGeometry(0.2, 0.04, 4, 10), P.brassDark, { at: [0, 0.7, 0], rot: [Math.PI / 2, 0, 0], material: materials.metal })
    .build("telescope");
  telescope.position.set(0, 0.9, 0.7);
  telescope.rotation.x = 0.95;
  dome.add(telescope);
  group.add(dome);
  return {
    id: "library",
    group,
    chimneys: [],
    extras: {},
    update: (dt, t, active, still) => {
      if (active && !still) dome.rotation.y += dt * 0.35;
      telescope.rotation.x = 0.95 + Math.sin(t * 0.6) * (active ? 0.15 : 0.03);
    },
  };
}

function vault(): BuildingModel {
  const rng = makeRandom(66);
  const b = new ModelBuilder();
  const w = 5;
  const d = 4;
  const h = 2.6;
  const front = d / 2;
  const doorY = 1.35;
  b.box([w + 0.5, 0.3, d + 0.5], P.stoneDark, { at: [0, 0.15, 0] });
  b.box([w - 0.12, h, d - 0.12], P.stoneDark, { at: [0, h / 2, 0] });
  // Heavy stone blocks on every side, staggered like real masonry.
  const faces: { at: [number, number, number]; rotY: number; len: number }[] = [
    { at: [0, 0, front], rotY: 0, len: w },
    { at: [0, 0, -front], rotY: Math.PI, len: w },
    { at: [w / 2, 0, 0], rotY: Math.PI / 2, len: d },
    { at: [-w / 2, 0, 0], rotY: -Math.PI / 2, len: d },
  ];
  for (const face of faces) {
    b.push(face.at, face.rotY);
    let row = 0;
    for (let y = 0.3; y < h - 0.05; y += 0.46, row++) {
      for (let x = -face.len / 2 + (row % 2) * 0.35; x < face.len / 2 - 0.1; ) {
        const len = Math.min(0.65 + rng() * 0.55, face.len / 2 - x);
        const cx = x + len / 2;
        const onDoor = face.rotY === 0 && Math.hypot(cx, y + 0.23 - doorY) < 1.25;
        if (!onDoor && len > 0.15) {
          b.box([len - 0.06, 0.42, 0.2], pick([P.stone, P.stoneDark, 0xb2ab9c, 0x958f82], rng), {
            at: [cx, y + 0.23, 0.04 + rng() * 0.05],
          });
        }
        x += len;
      }
    }
    b.pop();
  }
  // Roof slab, battlements and a low stone cap.
  b.box([w + 0.45, 0.34, d + 0.45], P.stone, { at: [0, h + 0.17, 0] });
  for (let i = 0; i < 6; i++) {
    const x = -w / 2 + 0.25 + (i * (w - 0.5)) / 5;
    b.box([0.5, 0.36, 0.5], P.stoneDark, { at: [x, h + 0.52, front - 0.05] });
    b.box([0.5, 0.36, 0.5], P.stoneDark, { at: [x, h + 0.52, -front + 0.05] });
  }
  b.add(new THREE.ConeGeometry(2.3, 0.8, 4), P.stoneDark, { at: [0, h + 0.75, 0], rot: [0, Math.PI / 4, 0], scale: [1.25, 1, 0.95] });
  // The round door's stone frame and the dark opening behind it.
  b.add(new THREE.TorusGeometry(1.04, 0.22, 6, 18), P.stone, { at: [0, doorY, front + 0.12], jitter: 0.06 });
  b.add(new THREE.CylinderGeometry(0.95, 0.95, 0.1, 18), 0x24211c, { at: [0, doorY, front + 0.04], rot: [Math.PI / 2, 0, 0] });
  steps(b, front + 0.1, 2.2);
  b.push([1.75, 2.0, front + 0.05]);
  lanternOn(b);
  b.pop();
  const group = b.build("vault");

  // Glow from inside, seen when the door opens.
  const glow = glowMesh(new THREE.CircleGeometry(0.9, 18), P.glow, 0);
  glow.position.set(0, doorY, front + 0.1);
  group.add(glow);

  // The heavy round door, hinged on its left edge.
  const hinge = new THREE.Group();
  hinge.position.set(-0.92, doorY, front + 0.24);
  const db = new ModelBuilder();
  db.add(new THREE.CylinderGeometry(0.88, 0.88, 0.26, 18), 0x7d828c, { at: [0.92, 0, 0], rot: [Math.PI / 2, 0, 0], material: materials.metal });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    db.add(new THREE.CylinderGeometry(0.055, 0.055, 0.08, 6), P.brass, {
      at: [0.92 + Math.cos(a) * 0.7, Math.sin(a) * 0.7, 0.15],
      rot: [Math.PI / 2, 0, 0],
      material: materials.metal,
    });
  }
  db.add(new THREE.TorusGeometry(0.34, 0.045, 4, 14), P.brass, { at: [0.92, 0, 0.22], material: materials.metal });
  for (let i = 0; i < 3; i++) {
    db.box([0.68, 0.05, 0.05], P.brass, { at: [0.92, 0, 0.22], rot: [0, 0, (i * Math.PI) / 3], material: materials.metal });
  }
  db.add(new THREE.SphereGeometry(0.09, 8, 6), P.brassDark, { at: [0.92, 0, 0.24], material: materials.metal });
  hinge.add(db.build("vault-door"));
  group.add(hinge);

  let open = 0;
  return {
    id: "vault",
    group,
    chimneys: [],
    extras: {},
    update: (dt, t, active, still) => {
      open += ((active ? 1 : 0) - open) * (still ? 1 : Math.min(1, dt * 2.2));
      hinge.rotation.y = -open * 1.55;
      glow.material.emissiveIntensity = open * (2.2 + Math.sin(t * 5) * 0.4);
    },
  };
}

export function createBuildingModels(): Record<Exclude<Building, "harbor">, BuildingModel> {
  return {
    home: home(),
    workshop: workshop(),
    lab: lab(),
    townhall: townhall(),
    library: library(),
    vault: vault(),
  };
}
