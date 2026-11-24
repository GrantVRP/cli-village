// Nature details: the small things that make the diorama feel lived-in.
//   - grass tufts across the meadows, thicker in some places than others;
//   - patches of wildflowers in soft colours;
//   - mossy boulders with pebbles around them;
//   - reeds and cattails along both river banks, swaying with the trees;
//   - low wooden fences around the cottage gardens (open at the front, where the robots walk).
//
// Everything is placed from its own random numbers, so the rest of the village looks exactly
// as before, and kept clear of the plaza, the paths and rails, the buildings, the props, the
// trees and the river. It's merged into a few meshes. The tiny things (grass, flowers,
// pebbles) don't cast shadows: theirs would be too small to see, and they'd cost the most.

import * as THREE from "three";
import { BUILDINGS } from "../../src/events/types.js";
import { HARBOR, RIVER_HALF, RIVER_Z, SPOTS, TRACK_R } from "./layout.js";
import { makeRandom, materials, type ModelBuilder, ModelBuilder as Builder, pick } from "./lowpoly.js";
import { P } from "./palette.js";

/**
 * Grass is lit as if it faced straight up, like the ground it grows from (as stylized games
 * do): thin blades lit by their own steep faces would look dark from above.
 *
 * The tiny things (grass, flowers, pebbles) don't write depth, and are drawn after the other
 * solid things, so everything still hides them correctly. The effects that read the depth
 * (ambient occlusion, depth of field, haze) then see the ground under them, as for a decal:
 * otherwise the occlusion would find a crease around every blade and turn the grass black.
 */
const grassMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, depthWrite: false });
grassMaterial.name = "grass";
const smallMaterial = materials.matte.clone();
smallMaterial.depthWrite = false;
smallMaterial.name = "nature-small";
const SMALL_ORDER = 10;

/** A spot to keep clear: x, z and radius. */
export type KeepOut = readonly [number, number, number];

/** A little lighter and warmer than the ground, like blades catching the light. */
const GRASS = [0x8fbc5a, 0x9cc463, 0x84b152, 0xa9c76c, 0x7fae4e] as const;
const MEADOW_FLOWERS = [0xf1ead8, 0xe9cf6a, 0xd98a9a, 0xa898d0, 0xf4f1ea, 0xe3a86b] as const;
const REEDS = [0x6f8a3e, 0x82964a, 0x5f7a36, 0x99a056] as const;
const ROCKS = [P.stone, P.stoneDark, 0x8f8a7c, 0x9a9484] as const;
const MOSS = [0x5f7d3a, 0x6b8a40, 0x58743a] as const;
const FENCE = [P.woodLight, 0x8a7458, 0x76603f] as const;

/** Props and spots that aren't buildings or paths. */
const PROPS: readonly KeepOut[] = [
  [0, 10.6, 1.7], // well
  [3.2, -9.6, 1.4], // notice board
  [-13.1, 14.2, 1.3], // barrels by the workshop
  [10.9, -17.5, 1.1], // barrels by the harbor
  [11.2, -15.5, 1.1], // crates at the harbor
];

function distanceToSegment(x: number, z: number, a: THREE.Vector3, b: THREE.Vector3): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
}

/**
 * Grass blades, written straight into one buffer: tens of thousands of them, so no shape
 * objects or matrices per blade (that took over half a second). A blade is a thin
 * three-sided spike, three triangles, darker at the root and lighter at the tip.
 */
class Blades {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];
  private readonly root = new THREE.Color();
  private readonly tip = new THREE.Color();

  /** A blade from (x, y, z), `height` tall and `width` across, its tip pushed by (leanX, leanZ). */
  add(x: number, y: number, z: number, height: number, width: number, leanX: number, leanZ: number, color: THREE.Color, r: () => number): void {
    const turn = r() * Math.PI * 2;
    const tipX = x + leanX;
    const tipY = y + height;
    const tipZ = z + leanZ;
    this.root.copy(color).multiplyScalar(0.72);
    this.tip.copy(color).multiplyScalar(1.12);
    for (let side = 0; side < 3; side++) {
      const a0 = turn + (side * Math.PI * 2) / 3;
      const a1 = a0 + (Math.PI * 2) / 3;
      this.positions.push(x + Math.cos(a0) * width, y, z + Math.sin(a0) * width, x + Math.cos(a1) * width, y, z + Math.sin(a1) * width, tipX, tipY, tipZ);
      const { root, tip } = this;
      this.colors.push(root.r, root.g, root.b, root.r, root.g, root.b, tip.r, tip.g, tip.b);
    }
  }

  build(name: string): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    const count = this.positions.length / 3;
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    // Lit as if facing up, like the ground (see grassMaterial).
    const normals = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) normals[i * 3 + 1] = 1;
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, grassMaterial);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = SMALL_ORDER;
    return mesh;
  }
}

/**
 * Add the nature details. The bigger things (boulders, reeds, fences) go into `big`, with the
 * rest of the village, so they cast shadows; the tiny ones come back as their own group,
 * without shadows. `dense` is extra grass that fills out the meadows, for the graphics settings
 * that can afford it (it has its own random numbers, so the rest is the same with or without
 * it). `trees` are the trees around the village, so nothing grows through a trunk.
 */
export function addNature(big: ModelBuilder, foliage: THREE.Material, trees: readonly KeepOut[]): { small: THREE.Group; dense: THREE.Group; flowers: [number, number][] } {
  const rng = makeRandom(91);
  const small = new Builder();
  const keepOut = [...PROPS, ...trees];
  const lines: [THREE.Vector3, THREE.Vector3][] = BUILDINGS.map((id) => [SPOTS[id].edge, SPOTS[id].door]);
  const route = HARBOR.cartRoute;
  for (let i = 0; i < route.length - 1; i++) lines.push([route[i]!, route[i + 1]!]);

  /** Is this spot clear of everything, with this much room to spare? */
  const clear = (x: number, z: number, room: number, keepTrees = false): boolean => {
    if (Math.hypot(x, z) < TRACK_R + 1.1 + room) return false;
    if (Math.abs(z - RIVER_Z) < RIVER_HALF + 1.5 + room) return false;
    for (const id of BUILDINGS) {
      const s = SPOTS[id];
      if (Math.hypot(x - s.pos.x, z - s.pos.z) < s.radius + 0.6 + room) return false;
    }
    for (const [a, b] of lines) if (distanceToSegment(x, z, a, b) < 1.35 + room) return false;
    for (const [kx, kz, kr] of keepTrees ? keepOut : PROPS) if (Math.hypot(x - kx, z - kz) < kr + room) return false;
    return true;
  };
  /** Somewhere in the land around the village, on either side of the river. */
  const somewhere = (): [number, number] => [(rng() - 0.5) * 88, -44 + rng() * 80];
  /** Meadows: some places grow thicker than others (a smooth, repeatable pattern). */
  const lush = (x: number, z: number) =>
    0.5 + 0.3 * Math.sin(x * 0.31 + 1.3) * Math.cos(z * 0.27 - 0.4) + 0.2 * Math.sin((x + z) * 0.13);
  /** The ground's height there: flat around the village, hills behind the river (as world.ts). */
  const groundAt = (x: number, z: number) => (z < -30 ? Math.min(2.5, (-30 - z) * 0.12) + Math.sin(x * 0.3) * 0.3 : 0);

  // Grass tufts: three to five blades leaning out from the middle.
  const grass = new Blades();
  const color = new THREE.Color();
  const tuft = (x: number, z: number, size = 1, into = grass, r = rng) => {
    const y = groundAt(x, z) - 0.03;
    const blades = 3 + Math.floor(r() * 3);
    const tall = (0.34 + r() * 0.26) * size;
    for (let k = 0; k < blades; k++) {
      // Each blade a slightly different shade of the tuft's green.
      if (k === 0) color.set(pick(GRASS, r));
      const shade = 0.92 + r() * 0.16;
      const a = (k / blades) * Math.PI * 2 + r();
      const lean = (0.25 + r() * 0.35) * tall;
      const h = tall * (0.7 + r() * 0.5);
      const out = 0.1 * size;
      into.add(x + Math.cos(a) * out, y, z + Math.sin(a) * out, h, 0.06 * size, Math.cos(a) * lean, Math.sin(a) * lean, color.clone().multiplyScalar(shade), r);
    }
  };
  // In patches across the meadows, thicker where the land is lusher.
  for (let i = 0, placed = 0; i < 3000 && placed < 360; i++) {
    const [x, z] = somewhere();
    if (rng() > lush(x, z) || !clear(x, z, 0)) continue;
    placed++;
    const count = 5 + Math.floor(rng() * 12);
    const spread = 0.6 + rng() * 1.1;
    for (let k = 0; k < count; k++) {
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * spread;
      const tx = x + Math.cos(a) * d;
      const tz = z + Math.sin(a) * d * 0.8;
      if (clear(tx, tz, 0)) tuft(tx, tz, 1 - (d / spread) * 0.35);
    }
  }
  // Along the edges where nobody walks: beside the paths and round the buildings' feet.
  for (const [a, b] of lines) {
    const length = a.distanceTo(b);
    const dir = b.clone().sub(a).normalize();
    const out = new THREE.Vector3(dir.z, 0, -dir.x);
    for (let t = 0; t < length; t += 0.45 + rng() * 0.6) {
      for (const sideOf of [-1, 1]) {
        if (rng() < 0.35) continue;
        const p = a.clone().addScaledVector(dir, t).addScaledVector(out, sideOf * (1.45 + rng() * 0.35));
        if (clear(p.x, p.z, 0)) tuft(p.x, p.z, 0.8 + rng() * 0.3);
      }
    }
  }
  for (const id of BUILDINGS) {
    if (id === "harbor") continue;
    const sp = SPOTS[id];
    for (let k = 0; k < 34; k++) {
      const a = rng() * Math.PI * 2;
      const d = sp.radius + 0.65 + rng() * 0.5;
      const x = sp.pos.x + Math.cos(a) * d;
      const z = sp.pos.z + Math.sin(a) * d;
      if (clear(x, z, -0.05)) tuft(x, z, 0.75 + rng() * 0.35);
    }
  }

  // Wildflowers, in small patches (where they are is kept: the butterflies visit them).
  const flowers: [number, number][] = [];
  for (let i = 0, placed = 0; i < 400 && placed < 46; i++) {
    const [x, z] = somewhere();
    if (!clear(x, z, 0.4, true)) continue;
    placed++;
    flowers.push([x, z]);
    const bloom = pick(MEADOW_FLOWERS, rng);
    const count = 4 + Math.floor(rng() * 5);
    const y = groundAt(x, z);
    for (let k = 0; k < count; k++) {
      const fx = x + (rng() - 0.5) * 1.3;
      const fz = z + (rng() - 0.5) * 1.0;
      const h = 0.18 + rng() * 0.14;
      grass.add(fx, y, fz, h, 0.03, 0, 0, color.set(pick(GRASS, rng)), rng);
      small.add(new THREE.IcosahedronGeometry(0.06 + rng() * 0.025, 0), rng() < 0.85 ? bloom : pick(MEADOW_FLOWERS, rng), { at: [fx, y + h + 0.02, fz], material: smallMaterial, rng });
    }
  }

  // Mossy boulders, one to three together, with pebbles around them.
  for (let i = 0, placed = 0; i < 300 && placed < 11; i++) {
    const [x, z] = somewhere();
    if (!clear(x, z, 1.2, true)) continue;
    placed++;
    const y = groundAt(x, z);
    const rocks = 1 + Math.floor(rng() * 3);
    for (let k = 0; k < rocks; k++) {
      const r = (k === 0 ? 0.6 : 0.3) + rng() * 0.4;
      const rx = x + (k === 0 ? 0 : (rng() - 0.5) * 1.8);
      const rz = z + (k === 0 ? 0 : (rng() - 0.5) * 1.4);
      const squash = 0.55 + rng() * 0.2;
      big.add(new THREE.IcosahedronGeometry(r, 0), pick(ROCKS, rng), { at: [rx, y + r * squash * 0.55, rz], rot: [0, rng() * 3, 0], scale: [1, squash, 0.85 + rng() * 0.2], jitter: 0.08, rng });
      // Moss on top, on the bigger ones.
      if (r > 0.5) big.add(new THREE.IcosahedronGeometry(r * 0.78, 0), pick(MOSS, rng), { at: [rx, y + r * squash * 1.32, rz], rot: [0, rng() * 3, 0], scale: [1, 0.3, 0.85], jitter: 0.08, rng });
      // Grass grows up round its foot.
      for (let t = 0; t < 4; t++) {
        const a = rng() * Math.PI * 2;
        tuft(rx + Math.cos(a) * (r + 0.15), rz + Math.sin(a) * (r + 0.1), 0.8);
      }
    }
    for (let k = 0; k < 5 + rng() * 4; k++) {
      const a = rng() * Math.PI * 2;
      const d = 0.9 + rng() * 1.0;
      small.add(new THREE.IcosahedronGeometry(0.05 + rng() * 0.09, 0), pick(ROCKS, rng), { at: [x + Math.cos(a) * d, y + 0.02, z + Math.sin(a) * d], scale: [1, 0.6, 1], material: smallMaterial, rng });
    }
  }

  // Reeds and cattails at the water's edge, on both banks (not at the dock or the boat).
  for (const side of [1, -1]) {
    for (let x = -46; x < 46; x += 1.8 + rng() * 3.2) {
      if (x > 11.2 && x < 19.5) continue;
      if (rng() < 0.25) continue;
      const cz = RIVER_Z + side * (RIVER_HALF + 0.35 + rng() * 0.4);
      const stems = 9 + Math.floor(rng() * 8);
      for (let k = 0; k < stems; k++) {
        const sx = x + (rng() - 0.5) * 1.1;
        const sz = cz + (rng() - 0.5) * 0.4;
        const h = 0.75 + rng() * 0.75;
        const tilt: [number, number, number] = [(rng() - 0.5) * 0.25, 0, (rng() - 0.5) * 0.25];
        big.add(new THREE.ConeGeometry(0.06, h, 3, 1, true), pick(REEDS, rng), { at: [sx, -0.32 + h / 2, sz], rot: tilt, jitter: 0.08, material: foliage, rng });
        if (k < 2 && rng() < 0.7) {
          big.add(new THREE.CylinderGeometry(0.07, 0.07, 0.28, 6), 0x6b4a2f, { at: [sx + tilt[2] * -h * 0.4, -0.32 + h * 0.78, sz + tilt[0] * h * 0.4], rot: tilt, material: foliage, rng });
        }
      }
    }
  }

  // Low fences around the cottage gardens: the sides and the back, open towards the plaza.
  for (const id of ["home", "lab", "workshop"] as const) {
    const s = SPOTS[id];
    const toCenter = new THREE.Vector3(-s.pos.x, 0, -s.pos.z).normalize();
    const across = new THREE.Vector3(toCenter.z, 0, -toCenter.x);
    const at = (u: number, v: number) => s.pos.clone().addScaledVector(across, u).addScaledVector(toCenter, v);
    const w = 3.4;
    const corners = [at(-w, 1.3), at(-w, -3.5), at(w, -3.5), at(w, 1.3)];
    const color = pick(FENCE, rng);
    let last: THREE.Vector3 | null = null;
    for (let c = 0; c < corners.length - 1; c++) {
      const a = corners[c]!;
      const b = corners[c + 1]!;
      const steps = Math.max(1, Math.round(a.distanceTo(b) / 0.95));
      for (let k = c === 0 ? 0 : 1; k <= steps; k++) {
        const p = a.clone().lerp(b, k / steps);
        if (keepOut.some(([kx, kz, kr]) => Math.hypot(p.x - kx, p.z - kz) < kr * 0.7 + 0.4)) {
          last = null; // leave a gap round a barrel or a tree
          continue;
        }
        big.box([0.11, 0.72, 0.11], color, { at: [p.x, 0.36, p.z], rot: [0, rng() * 0.3, (rng() - 0.5) * 0.08], jitter: 0.08, rng });
        if (rng() < 0.7) tuft(p.x + (rng() - 0.5) * 0.5, p.z + (rng() - 0.5) * 0.5, 0.85);
        if (last) {
          const mid = last.clone().add(p).multiplyScalar(0.5);
          const len = last.distanceTo(p);
          const rotY = Math.atan2(p.x - last.x, p.z - last.z);
          for (const h of [0.3, 0.56]) big.box([0.05, 0.07, len], color, { at: [mid.x, h, mid.z], rot: [0, rotY, 0], jitter: 0.06, rng });
        }
        last = p;
      }
    }
  }

  // Extra grass for Medium and High: more and bigger patches, and single tufts in between.
  const dense = new Blades();
  const more = makeRandom(92);
  const where = (): [number, number] => [(more() - 0.5) * 88, -44 + more() * 80];
  for (let i = 0, placed = 0; i < 5000 && placed < 560; i++) {
    const [x, z] = where();
    if (more() > lush(x, z) + 0.15 || !clear(x, z, 0)) continue;
    placed++;
    const count = 6 + Math.floor(more() * 14);
    const spread = 0.8 + more() * 1.4;
    for (let k = 0; k < count; k++) {
      const a = more() * Math.PI * 2;
      const d = Math.sqrt(more()) * spread;
      const tx = x + Math.cos(a) * d;
      const tz = z + Math.sin(a) * d * 0.8;
      if (clear(tx, tz, 0)) tuft(tx, tz, 1 - (d / spread) * 0.35, dense, more);
    }
  }
  for (let i = 0; i < 2600; i++) {
    const [x, z] = where();
    if (more() > lush(x, z) * 0.8 || !clear(x, z, 0)) continue;
    tuft(x, z, 0.7 + more() * 0.4, dense, more);
  }

  const smallGroup = small.build("nature-small");
  smallGroup.traverse((child) => {
    child.castShadow = false;
    child.renderOrder = SMALL_ORDER;
  });
  smallGroup.add(grass.build("grass"));
  const denseGroup = new THREE.Group();
  denseGroup.name = "nature-dense";
  denseGroup.add(dense.build("grass-dense"));
  return { small: smallGroup, dense: denseGroup, flowers };
}
