// The ground and everything that doesn't move much: plaza, rails, paths,
// river, trees and props (barrels, flowers, benches, lamps, notice board, well).

import * as THREE from "three";
import { BUILDINGS } from "../../src/events/types.js";
import { glowMaterials } from "./buildings.js";
import { HARBOR, PLAZA_R, CURB_R, RIVER_HALF, RIVER_Z, SPOTS, TRACK_R } from "./layout.js";
import { glowMesh, makeRandom, materials, ModelBuilder, pick } from "./lowpoly.js";
import { P } from "./palette.js";

/** The faint cyan glow along the rails. Brighter at night. */
export const railGlow = new THREE.MeshStandardMaterial({
  color: P.glow,
  emissive: P.glow,
  emissiveIntensity: 0.9,
  flatShading: true,
});

export interface World {
  group: THREE.Group;
  update(dt: number, t: number): void;
}

const rng = makeRandom(7);

/** The fine ground around the village is this big. Coarser land goes on past it, out into the fog. */
const GROUND_SIZE = 120;
const FAR_SIZE = 320;
/** How far the tree line and the river run to each side (well into the fog). */
const SIDE_REACH = 84;

/** The lie of the land: the river bed and its banks, and gentle hills behind. */
function landHeight(x: number, z: number, wobble: () => number): number {
  const fromRiver = Math.abs(z - RIVER_Z);
  let y = wobble() * 0.08;
  if (fromRiver < RIVER_HALF + 0.4) y = -0.95; // river bed
  else if (fromRiver < RIVER_HALF + 1.4) y = -0.25 + wobble() * 0.1; // banks
  if (z < -30) y += Math.min(2.5, (-30 - z) * 0.12) + Math.sin(x * 0.3) * 0.3; // gentle hills behind
  return y;
}

/** Ground made of flat-colored triangles: river bed, sandy banks, and two greens with a little jitter. */
function groundMesh(geo: THREE.BufferGeometry, name: string, random = rng): THREE.Mesh {
  const pos = geo.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    if (y < -0.6) c.set(0x6f6a55);
    else if (y < -0.12) c.set(P.sand);
    else c.set(random() < 0.5 ? P.grass : P.grass2);
    c.offsetHSL(0, 0, (random() - 0.5) * 0.05);
    for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (i + k) * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.deleteAttribute("uv");
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, materials.matte);
  mesh.receiveShadow = true;
  mesh.name = name;
  return mesh;
}

function ground(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, 80, 80).rotateX(-Math.PI / 2).toNonIndexed();
  const pos = geo.getAttribute("position");
  const heights = new Map<string, number>();
  const heightAt = (x: number, z: number) => {
    const key = `${x.toFixed(2)},${z.toFixed(2)}`;
    const cached = heights.get(key);
    if (cached !== undefined) return cached;
    let y = landHeight(x, z, () => rng() - 0.5);
    if (Math.hypot(x, z) < 24 && z > -19) y = Math.min(y, 0) * 0.3; // keep the village flat
    heights.set(key, y);
    return y;
  };
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  return groundMesh(geo, "ground");
}

/**
 * Coarser land all around the fine ground, so its edge never comes into view.
 * It sits a little lower and tucks under the fine ground's edge, so the two never fight.
 */
function farGround(): THREE.Mesh {
  const cell = 5;
  const cells = FAR_SIZE / cell;
  const hole = GROUND_SIZE / 2 - cell; // overlap the fine ground by one cell
  const corner = (x: number, z: number) => new THREE.Vector3(x, landHeight(x, z, () => 0) - 0.12, z);
  const points: number[] = [];
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const x0 = -FAR_SIZE / 2 + i * cell;
      const z0 = -FAR_SIZE / 2 + j * cell;
      if (Math.abs(x0 + cell / 2) < hole && Math.abs(z0 + cell / 2) < hole) continue;
      const a = corner(x0, z0);
      const b = corner(x0, z0 + cell);
      const c = corner(x0 + cell, z0 + cell);
      const d = corner(x0 + cell, z0);
      for (const p of [a, b, c, a, c, d]) points.push(p.x, p.y, p.z);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  // With its own random numbers, so the village's colors and trees don't depend on it.
  return groundMesh(geo, "far-ground", makeRandom(31));
}

function plaza(b: ModelBuilder): void {
  // Grout underneath, then rings of cobblestones, then a raised edge.
  b.add(new THREE.CylinderGeometry(PLAZA_R + 0.15, PLAZA_R + 0.25, 0.14, 48), P.grout, { at: [0, 0.07, 0], jitter: 0.02 });
  for (let r = 0.95; r < PLAZA_R - 0.1; r += 0.52) {
    const count = Math.floor((Math.PI * 2 * r) / 0.56);
    const offset = rng() * Math.PI;
    for (let i = 0; i < count; i++) {
      const a = offset + (i / count) * Math.PI * 2;
      const arc = ((Math.PI * 2 * r) / count) * 0.88;
      b.box([arc, 0.09 + rng() * 0.03, 0.44], P.plaza, {
        at: [Math.cos(a) * r, 0.17, Math.sin(a) * r],
        rot: [0, -a + Math.PI / 2, 0],
        jitter: 0.07,
      });
    }
  }
  const curbs = 40;
  for (let i = 0; i < curbs; i++) {
    const a = (i / curbs) * Math.PI * 2;
    b.box([((Math.PI * 2 * CURB_R) / curbs) * 0.93, 0.32, 0.5], pick([P.stone, P.stoneDark], rng), {
      at: [Math.cos(a) * CURB_R, 0.16, Math.sin(a) * CURB_R],
      rot: [0, -a + Math.PI / 2, 0],
      jitter: 0.05,
    });
  }
}

/** A straight piece of track: two rails set into the ground, with a glow line. */
function railSegment(b: ModelBuilder, from: THREE.Vector3, to: THREE.Vector3, sleepers = true): void {
  const dir = to.clone().sub(from);
  const len = dir.length();
  const mid = from.clone().add(to).multiplyScalar(0.5);
  const rotY = Math.atan2(dir.x, dir.z);
  b.push([mid.x, 0, mid.z], rotY);
  for (const x of [-0.3, 0.3]) b.box([0.07, 0.06, len], P.rail, { at: [x, 0.1, 0], material: materials.metal });
  b.box([0.04, 0.02, len], P.glow, { at: [0, 0.08, 0], material: railGlow });
  if (sleepers) {
    for (let s = -len / 2 + 0.3; s < len / 2; s += 0.6) b.box([0.95, 0.05, 0.18], P.wood, { at: [0, 0.06, s] });
  }
  b.pop();
}

function ringTrack(b: ModelBuilder): void {
  b.add(new THREE.RingGeometry(TRACK_R - 0.75, TRACK_R + 0.75, 96, 1).rotateX(-Math.PI / 2), P.dirt, { at: [0, 0.03, 0], jitter: 0.05 });
  for (const r of [TRACK_R - 0.3, TRACK_R + 0.3]) {
    b.add(new THREE.TorusGeometry(r, 0.045, 4, 160).rotateX(Math.PI / 2), P.rail, { at: [0, 0.12, 0], material: materials.metal });
  }
  b.add(new THREE.TorusGeometry(TRACK_R, 0.022, 3, 160).rotateX(Math.PI / 2), P.glow, { at: [0, 0.085, 0], material: railGlow });
  const sleepers = 90;
  for (let i = 0; i < sleepers; i++) {
    const a = (i / sleepers) * Math.PI * 2;
    b.box([0.2, 0.05, 0.95], P.wood, { at: [Math.cos(a) * TRACK_R, 0.06, Math.sin(a) * TRACK_R], rot: [0, -a, 0] });
  }
}

/** Dirt paths (with inlaid rails) from the plaza to each building. */
function paths(b: ModelBuilder): void {
  for (const id of BUILDINGS) {
    const s = SPOTS[id];
    const from = s.edge.clone();
    const to = s.door.clone().add(s.door.clone().sub(s.edge).normalize().multiplyScalar(id === "harbor" ? 0.4 : 1.1));
    const dir = to.clone().sub(from);
    const len = dir.length();
    const mid = from.clone().add(to).multiplyScalar(0.5);
    const rotY = Math.atan2(dir.x, dir.z);
    b.push([mid.x, 0, mid.z], rotY);
    b.box([1.8, 0.05, len], P.dirt, { at: [0, 0.035, 0], jitter: 0.06 });
    for (let z = -len / 2; z < len / 2; z += 0.7) {
      for (const side of [-1, 1]) {
        if (rng() < 0.6) b.box([0.22 + rng() * 0.2, 0.06, 0.2 + rng() * 0.2], pick([P.stone, 0xb59b72], rng), { at: [side * (0.95 + rng() * 0.12), 0.04, z] });
      }
    }
    b.pop();
    railSegment(b, from, to, false);
  }
  // The harbor's branch line for the commit cart.
  const route = HARBOR.cartRoute;
  for (let i = 0; i < route.length - 1; i++) railSegment(b, route[i]!, route[i + 1]!, true);
}

function tree(b: ModelBuilder, x: number, z: number, scale: number, leaf: number, y = 0, random = rng): void {
  const trunkH = 1.3 * scale;
  b.add(new THREE.CylinderGeometry(0.13 * scale, 0.2 * scale, trunkH, 6), P.trunk, { at: [x, y + trunkH / 2, z] });
  const blobs = 3 + Math.floor(random() * 2);
  for (let i = 0; i < blobs; i++) {
    const r = (0.75 + random() * 0.45) * scale;
    b.add(new THREE.IcosahedronGeometry(r, 1), leaf, {
      at: [x + (random() - 0.5) * 0.9 * scale, y + trunkH + r * 0.6 + (i === 0 ? 0.35 * scale : random() * 0.7 * scale), z + (random() - 0.5) * 0.9 * scale],
      jitter: 0.08,
    });
  }
}

function treeLineTree(b: ModelBuilder, x: number, row: number, random: () => number): void {
  const z = RIVER_Z - RIVER_HALF - 3.2 - row * 3.4 - random() * 1.5;
  const hill = z < -30 ? Math.min(2.5, (-30 - z) * 0.12) : 0;
  tree(b, x, z, 1.1 + random() * 0.7 + row * 0.15, pick(P.leaf, random), hill - 0.1, random);
}

function trees(b: ModelBuilder): void {
  // The tree line beyond the river. It goes on past the sides (out into the fog), with
  // its own random numbers there, so the trees by the village don't depend on how far it goes.
  const sides = makeRandom(43);
  for (let row = 0; row < 3; row++) {
    for (let x = -54; x < 54; x += 2.6 + rng() * 1.6) treeLineTree(b, x, row, rng);
  }
  for (let row = 0; row < 3; row++) {
    for (const dir of [-1, 1]) {
      for (let x = 56; x < SIDE_REACH; x += 2.6 + sides() * 1.6) treeLineTree(b, x * dir, row, sides);
    }
  }
  // A few around the village, plus one orange autumn tree.
  const around: [number, number, number][] = [
    [-21, 9, 1.4], [-22, -2, 1.2], [-20, 17, 1.1], [-6.5, 21, 1.3], [5.5, 21.5, 1.2],
    [21, 12, 1.3], [22.5, -5, 1.2], [20, -12, 1.1], [-7.5, -19, 1.2], [-24, 4.5, 1.0],
    [24, 4, 1.1], [-16, 18.5, 0.9], [16.5, 19, 1.0], [7.5, -18.5, 1.0],
  ];
  for (const [x, z, s] of around) tree(b, x, z, s, pick(P.leaf, rng));
  // Off to the side of the Library, so it doesn't hide the dome.
  tree(b, -24, -12.5, 1.55, P.autumn);
  // Bushes.
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2;
    const r = 18 + rng() * 8;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (z < RIVER_Z + RIVER_HALF + 2) continue;
    b.add(new THREE.IcosahedronGeometry(0.45 + rng() * 0.35, 0), pick(P.leaf, rng), { at: [x, 0.3, z], jitter: 0.08 });
  }
}

function river(): { mesh: THREE.Mesh; update: (t: number) => void } {
  const geo = new THREE.PlaneGeometry(SIDE_REACH * 2 + 40, RIVER_HALF * 2 + 1.0, 150, 7).rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({
    color: P.river,
    flatShading: true,
    roughness: 0.25,
    metalness: 0.1,
    transparent: true,
    opacity: 0.93,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(0, -0.32, RIVER_Z);
  mesh.receiveShadow = true;
  const pos = geo.getAttribute("position");
  const base = Float32Array.from(pos.array as Float32Array);
  return {
    mesh,
    update: (t) => {
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3]!;
        const z = base[i * 3 + 2]!;
        pos.setY(i, Math.sin(x * 0.55 + t * 1.3) * 0.05 + Math.cos(z * 1.7 + x * 0.3 + t * 1.8) * 0.04);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
    },
  };
}

function riverBanks(b: ModelBuilder): void {
  const rock = (x: number, side: number, random: () => number) =>
    b.add(new THREE.IcosahedronGeometry(0.22 + random() * 0.3, 0), pick([P.stone, P.stoneDark, 0x8f8a7c], random), {
      at: [x, -0.25, RIVER_Z + side * (RIVER_HALF + 0.3 + random() * 0.5)],
      jitter: 0.08,
    });
  for (const side of [1, -1]) {
    for (let x = -50; x < 50; x += 0.9 + rng() * 1.2) {
      if (side === 1 && Math.abs(x - HARBOR.dockStart.x) < 1.8) continue;
      rock(x, side, rng);
    }
  }
  // On past the sides, with their own random numbers (see the tree line).
  const sides = makeRandom(44);
  for (const side of [1, -1]) {
    for (const dir of [-1, 1]) {
      for (let x = 51; x < SIDE_REACH; x += 0.9 + sides() * 1.2) rock(x * dir, side, sides);
    }
  }
}

// --- Props --------------------------------------------------------------------

function lampPost(b: ModelBuilder, x: number, z: number): void {
  const metal = materials.metal;
  b.add(new THREE.CylinderGeometry(0.12, 0.16, 0.25, 8), P.stoneDark, { at: [x, 0.12, z] });
  b.add(new THREE.CylinderGeometry(0.05, 0.07, 2.6, 6), P.iron, { at: [x, 1.4, z], material: metal });
  b.box([0.5, 0.05, 0.05], P.iron, { at: [x + 0.2, 2.62, z], material: metal });
  b.box([0.26, 0.06, 0.26], P.iron, { at: [x + 0.42, 2.55, z], material: metal });
  b.box([0.18, 0.26, 0.18], P.warmLight, { at: [x + 0.42, 2.38, z], material: glowMaterials.lantern });
  b.box([0.22, 0.05, 0.22], P.iron, { at: [x + 0.42, 2.22, z], material: metal });
}

function bench(b: ModelBuilder, x: number, z: number, rotY: number): void {
  b.push([x, 0, z], rotY);
  b.box([1.5, 0.08, 0.42], P.woodLight, { at: [0, 0.46, 0] });
  b.box([1.5, 0.36, 0.07], P.woodLight, { at: [0, 0.7, -0.2] });
  for (const bx of [-0.62, 0.62]) b.box([0.08, 0.46, 0.38], P.iron, { at: [bx, 0.23, 0], material: materials.metal });
  b.pop();
}

export function barrel(b: ModelBuilder, x: number, z: number, y = 0): void {
  b.add(new THREE.CylinderGeometry(0.33, 0.33, 0.85, 10), P.woodLight, { at: [x, y + 0.425, z], jitter: 0.06 });
  for (const yy of [0.18, 0.67]) {
    b.add(new THREE.TorusGeometry(0.335, 0.025, 3, 12).rotateX(Math.PI / 2), P.iron, { at: [x, y + yy, z], material: materials.metal });
  }
}

function well(b: ModelBuilder, x: number, z: number): void {
  b.add(new THREE.CylinderGeometry(0.95, 1.0, 0.8, 12), P.stone, { at: [x, 0.4, z], jitter: 0.08 });
  b.add(new THREE.CylinderGeometry(0.72, 0.72, 0.05, 12), 0x3c5a6a, { at: [x, 0.72, z] });
  for (const dx of [-0.85, 0.85]) b.box([0.12, 1.9, 0.12], P.wood, { at: [x + dx, 1.3, z] });
  b.add(new THREE.ConeGeometry(1.35, 0.7, 4), P.roof2, { at: [x, 2.55, z], rot: [0, Math.PI / 4, 0], scale: [1, 1, 0.7] });
  b.box([1.8, 0.07, 0.07], P.wood, { at: [x, 1.95, z] });
  b.box([0.03, 0.55, 0.03], 0xd8c8a0, { at: [x, 1.65, z] });
  b.add(new THREE.CylinderGeometry(0.13, 0.11, 0.2, 8), P.woodLight, { at: [x, 1.32, z] });
}

function noticeBoard(b: ModelBuilder, x: number, z: number, rotY: number): void {
  b.push([x, 0, z], rotY);
  for (const px of [-0.8, 0.8]) b.box([0.12, 2.0, 0.12], P.wood, { at: [px, 1.0, 0] });
  b.box([1.7, 1.05, 0.08], P.woodLight, { at: [0, 1.35, 0] });
  b.box([1.95, 0.08, 0.5], P.roof2, { at: [0, 2.05, 0], rot: [0.15, 0, 0] });
  const notes: [number, number, number, number][] = [
    [-0.5, 1.55, 0.42, 0.32], [0.05, 1.5, 0.36, 0.42], [0.52, 1.6, 0.3, 0.3], [-0.3, 1.1, 0.46, 0.3], [0.4, 1.12, 0.34, 0.36],
  ];
  for (const [nx, ny, nw, nh] of notes) {
    b.box([nw, nh, 0.02], pick([P.cream, 0xf4f1ea, 0xe9d9a8], rng), { at: [nx, ny, 0.05], rot: [0, 0, (rng() - 0.5) * 0.2] });
  }
  b.pop();
}

function flowers(b: ModelBuilder, x: number, z: number, count = 9): void {
  for (let i = 0; i < count; i++) {
    const fx = x + (rng() - 0.5) * 1.4;
    const fz = z + (rng() - 0.5) * 1.0;
    b.add(new THREE.ConeGeometry(0.08, 0.3, 4), pick(P.leaf, rng), { at: [fx, 0.15, fz] });
    b.add(new THREE.IcosahedronGeometry(0.08, 0), pick([0xe85d75, 0xf2d15c, 0xf4f1ea, 0xb070e0, 0xf08c4a], rng), { at: [fx, 0.34, fz] });
  }
}

function props(b: ModelBuilder): void {
  const angles = (deg: number) => (deg * Math.PI) / 180;
  const ringPoint = (deg: number, r: number): [number, number] => [Math.cos(angles(deg)) * r, Math.sin(angles(deg)) * r];
  for (const deg of [-119, -72, 29, 111, -168]) {
    const [x, z] = ringPoint(deg, 9.0);
    lampPost(b, x, z);
  }
  for (const deg of [-22, 151, 69]) {
    const [x, z] = ringPoint(deg, 9.2);
    bench(b, x, z, Math.atan2(-x, -z));
  }
  well(b, 0, 10.6);
  noticeBoard(b, 3.2, -9.6, Math.atan2(-3.2, 9.6));
  // Barrels by the workshop and the harbor.
  barrel(b, -13.4, 13.6);
  barrel(b, -12.7, 14.3);
  barrel(b, -13.2, 14.8, 0);
  barrel(b, 11.2, -17.2);
  barrel(b, 10.6, -17.8);
  // Flowers along the plaza and by the cottages.
  for (const deg of [-40, 10, 60, 100, 140, 190, -140, -100]) {
    const [x, z] = ringPoint(deg, 10.4 + rng());
    flowers(b, x, z);
  }
  for (const id of ["home", "lab", "workshop"] as const) {
    const s = SPOTS[id];
    const side = new THREE.Vector3(Math.cos(s.rotY), 0, -Math.sin(s.rotY));
    for (const k of [-1, 1]) {
      const p = s.door.clone().addScaledVector(side, k * 2.6);
      flowers(b, p.x, p.z, 6);
    }
  }
  // Stacked crates waiting at the harbor.
  for (const [x, z, y] of [[10.9, -15.6, 0], [11.6, -15.3, 0], [11.2, -15.45, 0.58]] as const) {
    b.box([0.6, 0.55, 0.6], P.woodLight, { at: [x, y + 0.28, z], rot: [0, rng() * 0.4, 0], jitter: 0.06 });
  }
}

export function createWorld(): World {
  const group = new THREE.Group();
  group.name = "world";
  group.add(ground(), farGround());

  const b = new ModelBuilder();
  plaza(b);
  ringTrack(b);
  paths(b);
  riverBanks(b);
  trees(b);
  props(b);
  group.add(b.build("world-static"));

  const water = river();
  group.add(water.mesh);

  // A soft glow under the lamps so they read as lights.
  for (const deg of [-119, -72, 29, 111, -168]) {
    const a = (deg * Math.PI) / 180;
    const halo = glowMesh(new THREE.CircleGeometry(0.7, 12).rotateX(-Math.PI / 2), P.warmLight, 0.15);
    (halo.material as THREE.MeshStandardMaterial).transparent = true;
    (halo.material as THREE.MeshStandardMaterial).opacity = 0.25;
    halo.position.set(Math.cos(a) * 9.0 + 0.42, 0.05, Math.sin(a) * 9.0);
    halo.userData.lampHalo = true;
    group.add(halo);
  }

  return {
    group,
    update: (_dt, t) => water.update(t),
  };
}

