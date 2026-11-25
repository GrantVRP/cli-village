// Low-poly flowers: a rosette of leaves, a stem and a real head (rounded petals round a
// centre), in a few kinds; beds of them on a patch of dark soil; and window boxes. They're
// merged into whatever builder they're added to. Flowers take their own random numbers
// (`rng`), so how detailed they are never shifts anything else that's seeded.

import * as THREE from "three";
import type { ModelBuilder } from "./lowpoly.js";

export type FlowerKind = "daisy" | "cosmos" | "poppy" | "tulip" | "lavender";

export const FLOWER_KINDS: readonly FlowerKind[] = ["daisy", "cosmos", "poppy", "tulip", "lavender"];

/** Petal colours for each kind (picked from at random). */
export const FLOWER_COLORS: Record<FlowerKind, readonly number[]> = {
  daisy: [0xf4f1ea, 0xf6ead0],
  cosmos: [0xe48aa8, 0xc99ad8, 0xf0b6c4],
  poppy: [0xd9483b, 0xe8743a, 0xe35d4f],
  tulip: [0xe4566b, 0xf2c94c, 0xf0a0b8, 0xe0703c],
  lavender: [0x9584cf, 0x8a78c4],
};

const STEM = 0x6a9a45;
const LEAVES = [0x5f9440, 0x6ca24a, 0x57893b] as const;
const LAVENDER_LEAF = 0x8aa57a;
const SOIL = 0x5b4634;

export interface FlowerOptions {
  kind: FlowerKind;
  color: number;
  /** 1 = a garden flower about knee-high to a villager. */
  size?: number;
  rng: () => number;
  material?: THREE.Material;
  /** "low": fewer leaves and petals, for the hundreds of wildflowers in the meadows. */
  detail?: "full" | "low";
}

const q = new THREE.Quaternion();
const e = new THREE.Euler();
const v = new THREE.Vector3();
const one = new THREE.Vector3(1, 1, 1);

/** A matrix from a position and a rotation. */
function place(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, order: THREE.EulerOrder = "XYZ"): THREE.Matrix4 {
  return new THREE.Matrix4().compose(v.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz, order)), one);
}

/** A pointed leaf: a flat diamond `length` long along +z from its base. */
function leaf(width: number, length: number, thickness: number): THREE.BufferGeometry {
  return new THREE.OctahedronGeometry(1, 0).scale(width / 2, thickness / 2, length / 2).translate(0, 0, length / 2);
}

/** A rounded petal: a flat oval `length` long along +z from its base. */
function petal(width: number, length: number, thickness: number): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, 6, 2).scale(width / 2, thickness / 2, length / 2).translate(0, 0, length / 2);
}

/** Add one flower standing on the ground at (x, y, z). */
export function addFlower(b: ModelBuilder, x: number, y: number, z: number, o: FlowerOptions): void {
  const { kind, rng } = o;
  const s = o.size ?? 1;
  const material = o.material;
  const low = o.detail === "low";
  // The whole plant turns at random, and its stem leans a little.
  const base = place(x, y, z, 0, rng() * Math.PI * 2, 0);
  const lean = place(0, 0, 0, (rng() - 0.5) * 0.25, 0, (rng() - 0.5) * 0.25);
  const add = (geometry: THREE.BufferGeometry, color: number, ...frames: THREE.Matrix4[]) => {
    for (const f of frames) geometry.applyMatrix4(f);
    geometry.applyMatrix4(base);
    b.add(geometry, color, { rng, jitter: 0.05, material });
  };

  // A rosette of leaves round the foot of the stem.
  const leaves = low ? 3 : kind === "lavender" ? 7 : 5;
  const leafColor = kind === "lavender" ? LAVENDER_LEAF : LEAVES[Math.floor(rng() * LEAVES.length)]!;
  for (let i = 0; i < leaves; i++) {
    const shape =
      kind === "lavender" ? leaf(0.022 * s, 0.15 * s, 0.008 * s) : kind === "tulip" ? leaf(0.06 * s, 0.17 * s, 0.01 * s) : leaf(0.05 * s, 0.13 * s, 0.01 * s);
    const lift = kind === "tulip" ? -0.95 : kind === "lavender" ? -0.85 : -0.5 - rng() * 0.3;
    add(shape, leafColor, place(0, 0.01 * s, 0, lift, (i / leaves) * Math.PI * 2 + rng() * 0.5, 0, "YXZ"));
  }

  const tall = { daisy: 0.3, cosmos: 0.36, poppy: 0.3, tulip: 0.25, lavender: 0.36 }[kind];
  const h = tall * s * (0.85 + rng() * 0.3);
  add(new THREE.CylinderGeometry(0.012 * s, 0.017 * s, h, 5, 1, true).translate(0, h / 2, 0), STEM, lean);
  // One leaf partway up the stem.
  if (kind !== "lavender" && !low) add(leaf(0.035 * s, 0.09 * s, 0.008 * s), leafColor, place(0, h * 0.45, 0, -0.7, rng() * Math.PI * 2, 0, "YXZ"), lean);

  // The head, facing up and a little to one side.
  const head = place(0, h, 0, 0.15 + rng() * 0.35, rng() * Math.PI * 2, 0, "YXZ");
  const color = o.color;
  if (kind === "daisy" || kind === "cosmos") {
    const n = low ? (kind === "daisy" ? 8 : 6) : kind === "daisy" ? 11 : 8;
    const [w, l] = kind === "daisy" ? [0.03, 0.085] : [0.05, 0.08];
    add(new THREE.IcosahedronGeometry(kind === "daisy" ? 0.034 * s : 0.026 * s, 0).scale(1, 0.6, 1), kind === "daisy" ? 0xe9b43a : 0xd9a23c, head, lean);
    for (let i = 0; i < n; i++) {
      add(petal(w * s, l * s, 0.008 * s), color, place(0, 0, 0.02 * s, -0.12 - rng() * 0.1, 0, 0), place(0, 0, 0, 0, (i / n) * Math.PI * 2 + rng() * 0.12, 0), head, lean);
    }
  } else if (kind === "poppy") {
    // Five broad petals cupped round a dark centre.
    add(new THREE.IcosahedronGeometry(0.026 * s, 0).scale(1, 0.8, 1), 0x2f2b28, head, lean);
    for (let i = 0; i < 5; i++) {
      add(petal(0.085 * s, 0.075 * s, 0.009 * s), color, place(0, 0, 0.012 * s, -0.62, 0, 0), place(0, 0, 0, 0, (i / 5) * Math.PI * 2 + rng() * 0.2, 0), head, lean);
    }
  } else if (kind === "tulip") {
    // Six petals standing up round the top of the stem: a closed cup.
    for (let i = 0; i < 6; i++) {
      const inner = i % 2 === 0;
      const cup = new THREE.SphereGeometry(1, 6, 3).scale(0.036 * s, 0.065 * s, 0.014 * s).translate(0, 0.055 * s, 0);
      add(cup, color, place(0, -0.01 * s, (inner ? 0.016 : 0.026) * s, inner ? 0.06 : 0.16, 0, 0), place(0, 0, 0, 0, (i / 6) * Math.PI * 2, 0), place(0, h, 0), lean);
    }
  } else {
    // Lavender: a spike of little buds up the top of the stem.
    const buds = low ? 8 : 13;
    for (let i = 0; i < buds; i++) {
      const a = i * 2.4;
      const r = 0.014 * s * (1 - i / buds / 2);
      const gap = (0.016 * 13) / buds;
      add(new THREE.OctahedronGeometry(0.021 * s * (1 - i / buds / 3), 0).scale(1, 1.4, 1), color, place(Math.cos(a) * r, h + 0.03 * s - i * gap * s, Math.sin(a) * r), lean);
    }
  }
}

/** Pick a kind and a colour (two random numbers). */
export function pickFlower(rng: () => number, kinds: readonly FlowerKind[] = FLOWER_KINDS): { kind: FlowerKind; color: number } {
  const kind = kinds[Math.floor(rng() * kinds.length)]!;
  const colors = FLOWER_COLORS[kind];
  return { kind, color: colors[Math.floor(rng() * colors.length)]! };
}

export interface BedOptions {
  kinds: readonly FlowerKind[];
  /** Half the bed's length and width, and which way its length runs (radians, from +x toward +z). */
  rx: number;
  rz: number;
  turn: number;
  rng: () => number;
  /** Leave out a flower here (on a path, by a prop). */
  skip?: (x: number, z: number) => boolean;
}

/** A bed of flowers on a patch of dark soil with a soft, uneven edge. */
export function addBed(b: ModelBuilder, x: number, z: number, o: BedOptions): void {
  const { rng } = o;
  const c = Math.cos(o.turn);
  const s = Math.sin(o.turn);
  // The soil: a low disc, its edge wavy (by angle, so the sides stay joined).
  const soil = new THREE.CylinderGeometry(1, 1.1, 0.03, 14, 1);
  const pos = soil.getAttribute("position");
  const p1 = rng() * 6;
  const p2 = rng() * 6;
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    const k = 1 + 0.08 * Math.sin(3 * a + p1) + 0.05 * Math.sin(5 * a + p2);
    pos.setX(i, pos.getX(i) * k);
    pos.setZ(i, pos.getZ(i) * k);
  }
  b.add(soil, SOIL, { at: [x, 0.0, z], rot: [0, -o.turn, 0], scale: [o.rx + 0.16, 1, o.rz + 0.14], rng, jitter: 0.05 });
  // Flowers on a loose staggered grid inside the oval.
  const step = 0.26;
  let row = 0;
  for (let w = -o.rz; w <= o.rz + 1e-6; w += step * 0.86, row++) {
    for (let u = -o.rx + (row % 2 ? step / 2 : 0); u <= o.rx + 1e-6; u += step) {
      const uu = u + (rng() - 0.5) * 0.1;
      const ww = w + (rng() - 0.5) * 0.08;
      if ((uu / o.rx) ** 2 + (ww / o.rz) ** 2 > 1) continue;
      const fx = x + c * uu - s * ww;
      const fz = z + s * uu + c * ww;
      if (o.skip?.(fx, fz)) continue;
      addFlower(b, fx, 0.015, fz, { ...pickFlower(rng, o.kinds), rng, size: 0.9 + rng() * 0.25 });
    }
  }
}

/** Flowers in a window box (the box's top middle at x, y, z, `length` along x): a leafy mound and small blooms. */
export function addWindowBox(b: ModelBuilder, x: number, y: number, z: number, length: number, rng: () => number): void {
  const n = 7;
  for (let i = 0; i < 5; i++) {
    b.add(new THREE.IcosahedronGeometry(0.075, 1), LEAVES[i % LEAVES.length]!, { at: [x - length * 0.38 + (i * length * 0.76) / 4, y + 0.015, z], scale: [1.1, 0.45, 0.85], rng, jitter: 0.08 });
  }
  for (let i = 0; i < n; i++) {
    const fx = x - length * 0.4 + (i * length * 0.8) / (n - 1) + (rng() - 0.5) * 0.04;
    addFlower(b, fx, y, z + (rng() - 0.5) * 0.08, { ...pickFlower(rng, ["cosmos", "poppy", "daisy"]), rng, size: 0.72 });
  }
}
