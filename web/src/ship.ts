// The harbor's cargo ship: a little two-masted schooner that carries your snapshots (crates)
// to GitHub. Built from primitives like everything else: a lofted hull with a painted stripe,
// two masts with gaff sails and a jib, a deckhouse with portholes that light up at night, a
// lantern on the mainmast, and GitHub's colours on its flags (just the colours: a charcoal flag
// and a white pennant, no mark).
//
// The ship's own frame: the bow points along +x, +y is up, the waterline is at y = 0. It moors
// stern-to the dock, so the crates come aboard over the stern onto the open after deck (nothing
// hangs over it but the main boom, well above them).

import * as THREE from "three";
import { glowMaterials } from "./buildings.js";
import { type Flag, wavingFlag } from "./flag.js";
import { makeRandom, ModelBuilder } from "./lowpoly.js";
import { P } from "./palette.js";

/** The ship is modelled at this size and drawn this much bigger. */
export const SHIP_SCALE = 1.25;

const rng = makeRandom(1907);

const TOPSIDES = 0x4a3324;
const BOTTOM = 0x7c4632;
const STRIPE = P.teal;
const SPAR = 0x8a6a48;
const ROPE = 0x3a2f25;
const CANVAS = 0xeee6d2;
const HOUSE = 0xd8cdb4;
const HOUSE_ROOF = 0x58544b;
const GITHUB_CHARCOAL = 0x24292f;
const GITHUB_WHITE = 0xf6f8fa;

/** The hull's shape, stern to bow: [x, half its width at the deck, deck height, keel depth]. */
const STATIONS: readonly (readonly [number, number, number, number])[] = [
  [-1.5, 0.36, 0.47, -0.1],
  [-1.2, 0.48, 0.43, -0.19],
  [-0.6, 0.55, 0.39, -0.24],
  [0.0, 0.57, 0.375, -0.25],
  [0.6, 0.54, 0.385, -0.24],
  [1.1, 0.43, 0.42, -0.2],
  [1.45, 0.26, 0.47, -0.08],
  [1.72, 0.03, 0.54, 0.12],
];

/** Deck height and half width at `x` (between the stations). */
export function deckAt(x: number): { y: number; half: number } {
  for (let i = 1; i < STATIONS.length; i++) {
    const a = STATIONS[i - 1]!;
    const b = STATIONS[i]!;
    if (x <= b[0] || i === STATIONS.length - 1) {
      const k = Math.min(1, Math.max(0, (x - a[0]) / (b[0] - a[0])));
      return { y: a[2] + (b[2] - a[2]) * k, half: a[1] + (b[1] - a[1]) * k };
    }
  }
  return { y: 0.4, half: 0.5 };
}

/**
 * The ring of points round one station: port deck edge, down round the keel, up to the starboard
 * deck edge. The boot-top (where the paint changes) sits just above the waterline, or just above
 * the keel where the stem rises out of the water, so the points always go down in order.
 */
function ring([x, half, deck, keel]: readonly [number, number, number, number]): THREE.Vector3[] {
  const knuckle = deck - 0.075;
  const bootTop = Math.min(knuckle - 0.02, Math.max(0.04, keel + 0.01));
  const bilge = keel + (bootTop - keel) * 0.4;
  const side = (s: number) => [
    new THREE.Vector3(x, deck, s * half),
    new THREE.Vector3(x, knuckle, s * half),
    new THREE.Vector3(x, bootTop, s * half * 0.97),
    new THREE.Vector3(x, bilge, s * half * 0.72),
  ];
  return [...side(-1), new THREE.Vector3(x, keel, 0), ...side(1).reverse()];
}

function triangles(points: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  // Normals too: every part merged into one mesh needs the same attributes.
  g.computeVertexNormals();
  return g;
}

/** The band of hull between ring points j and j+1, all along the ship. */
function band(rings: THREE.Vector3[][], j: number): THREE.BufferGeometry {
  const pts: number[] = [];
  for (let i = 0; i + 1 < rings.length; i++) {
    const a = rings[i]![j]!;
    const b = rings[i]![j + 1]!;
    const c = rings[i + 1]![j + 1]!;
    const d = rings[i + 1]![j]!;
    pts.push(...a.toArray(), ...c.toArray(), ...b.toArray(), ...a.toArray(), ...d.toArray(), ...c.toArray());
  }
  return triangles(pts);
}

/** A flat cap over a ring (the transom, or the tip of the bow), facing aft or forward. */
function cap(points: THREE.Vector3[], forward: boolean): THREE.BufferGeometry {
  const c = points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / points.length);
  const pts: number[] = [];
  const loop = [...points, points[0]!];
  for (let j = 0; j + 1 < loop.length; j++) {
    const [p, q] = forward ? [loop[j + 1]!, loop[j]!] : [loop[j]!, loop[j + 1]!];
    pts.push(...c.toArray(), ...p.toArray(), ...q.toArray());
  }
  return triangles(pts);
}

/** The deck: between the two deck edges, all along. */
function deck(rings: THREE.Vector3[][]): THREE.BufferGeometry {
  const pts: number[] = [];
  const last = rings[0]!.length - 1;
  for (let i = 0; i + 1 < rings.length; i++) {
    const a = rings[i]![0]!;
    const b = rings[i]![last]!;
    const c = rings[i + 1]![last]!;
    const d = rings[i + 1]![0]!;
    pts.push(...a.toArray(), ...b.toArray(), ...c.toArray(), ...a.toArray(), ...c.toArray(), ...d.toArray());
  }
  return triangles(pts);
}

const up = new THREE.Vector3(0, 1, 0);
const along = new THREE.Vector3(1, 0, 0);

/** A round spar or rope from a to b. */
function rod(b: ModelBuilder, from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number, color: number, sides = 5): void {
  const g = new THREE.CylinderGeometry(r1, r0, from.distanceTo(to), sides, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(up, to.clone().sub(from).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(from.clone().add(to).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  b.add(g, color, { jitter: 0.04, rng });
}

/** A squared timber from a to b (a rail). */
function beam(b: ModelBuilder, from: THREE.Vector3, to: THREE.Vector3, width: number, height: number, color: number): void {
  const g = new THREE.BoxGeometry(from.distanceTo(to), height, width);
  const q = new THREE.Quaternion().setFromUnitVectors(along, to.clone().sub(from).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(from.clone().add(to).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  b.add(g, color, { jitter: 0.05, rng });
}

/** A sail that fills with wind. */
export interface Sail {
  mesh: THREE.Mesh;
  /** `full`: 0 (slack, flapping a little) to 1 (full of wind). `t` moves the flapping. */
  update(full: number, t: number): void;
}

const canvas = new THREE.MeshStandardMaterial({ color: CANVAS, flatShading: true, side: THREE.DoubleSide, roughness: 0.95 });
canvas.name = "sailcloth";

/**
 * A sail from a grid of points. Each point knows how far it may bulge (most in the middle, none
 * at the edges held by spars and stays), how much it flaps when slack (most at the free edge),
 * and where it is in the flapping wave.
 */
function sailMesh(positions: number[], index: number[], bulge: number[], flap: number[], wave: number[]): Sail {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
  const flat = positions.filter((_, k) => k % 3 === 2);
  const mesh = new THREE.Mesh(geometry, canvas);
  mesh.castShadow = true;
  // Thin curved cloth lit from both sides would stripe itself with its own shadow: it casts
  // shadows on the deck and the water, but takes none.
  mesh.receiveShadow = false;
  mesh.userData.noShadowOnSelf = true;
  return {
    mesh,
    update(full, t) {
      for (let k = 0; k < pos.count; k++) {
        const slack = (1 - full) * flap[k]! * Math.sin(t * 5.5 - wave[k]!) * 0.035;
        pos.setZ(k, flat[k]! + bulge[k]! * (0.2 + 0.8 * full) + slack);
      }
      pos.needsUpdate = true;
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
    },
  };
}

/** A four-sided gaff sail between its tack, clew, peak and throat. */
function gaffSail(tack: THREE.Vector3, clew: THREE.Vector3, peak: THREE.Vector3, throat: THREE.Vector3, depth: number): Sail {
  const n = 6;
  const positions: number[] = [];
  const bulge: number[] = [];
  const flap: number[] = [];
  const wave: number[] = [];
  const foot = new THREE.Vector3();
  const head = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const u = i / n; // from the mast to the leech
      const v = j / n; // from the boom up to the gaff
      foot.lerpVectors(tack, clew, u);
      head.lerpVectors(throat, peak, u);
      p.lerpVectors(foot, head, v);
      positions.push(p.x, p.y, p.z);
      bulge.push(Math.sin(Math.PI * Math.pow(u, 0.8)) * Math.pow(Math.sin(Math.PI * v), 0.6) * depth);
      flap.push(u * Math.sin(Math.PI * v));
      wave.push(u * 7 + v * 1.5);
    }
  }
  const index: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      index.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
    }
  }
  return sailMesh(positions, index, bulge, flap, wave);
}

/** A three-sided sail (the jib), set along a stay. */
function jibSail(tack: THREE.Vector3, head: THREE.Vector3, clew: THREE.Vector3, depth: number): Sail {
  const n = 6;
  const positions: number[] = [];
  const bulge: number[] = [];
  const flap: number[] = [];
  const wave: number[] = [];
  const rows: number[] = [];
  for (let j = 0; j <= n; j++) {
    rows.push(positions.length / 3);
    for (let i = 0; i <= n - j; i++) {
      const wHead = j / n;
      const wClew = i / n;
      const wTack = 1 - wHead - wClew;
      const p = tack.clone().multiplyScalar(wTack).addScaledVector(head, wHead).addScaledVector(clew, wClew);
      positions.push(p.x, p.y, p.z);
      bulge.push(27 * wTack * wHead * wClew * depth);
      flap.push(wClew);
      wave.push(wClew * 7 + wHead * 1.5);
    }
  }
  const index: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n - j; i++) {
      const a = rows[j]! + i;
      const b = rows[j + 1]! + i;
      index.push(a, a + 1, b);
      if (i < n - j - 1) index.push(a + 1, b + 1, b);
    }
  }
  return sailMesh(positions, index, bulge, flap, wave);
}

export interface ShipModel {
  /** The whole ship (drawn SHIP_SCALE bigger than it's modelled). */
  group: THREE.Group;
  /** Crates on the after deck: `crateSpots(n)` says where `n` of them stand. */
  crates: THREE.Object3D[];
  /** Each mast's boom, gaff and sail, turning about the mast: 0 = along the ship, more = out to starboard. */
  rigs: THREE.Group[];
  sails: Sail[];
  /** They stream with the wind, not with the ship: keep turning them back as the ship turns. */
  flags: Flag[];
  /** Where the stern lines tie on (port, starboard), in the ship's own frame. */
  cleats: [THREE.Vector3, THREE.Vector3];
}

/** How big a crate is on board, once the ship is scaled: a touch smaller than on the cart (90%), so a stack of three fits inside the rail. */
export const CRATE_SCALE = 0.9 / SHIP_SCALE;
/** A crate from its middle down to its bottom (its straps), and its height in a stack. */
const CRATE_HALF_HEIGHT = 0.257 * CRATE_SCALE;
const CRATE_STACK = 0.514 * CRATE_SCALE;
/** Where the crates stand: on the after deck behind the mainmast, clear of its shrouds, the stern cleats and the mainsail when its boom swings out. */
const CARGO_X = -0.92;
/** The deck rises toward the stern there: the crates tilt with it (radians, about their own z). */
export const CARGO_TILT = Math.atan((deckAt(CARGO_X - 0.2).y - deckAt(CARGO_X + 0.2).y) / 0.4);

/**
 * Where `n` crates stand on the after deck (the middle of each), for 1, 2 or 3 of them, in the
 * order the crane sets them down: port first (the far side from the crane), then starboard,
 * then the third on top, like on the cart.
 */
export function crateSpots(n: number): THREE.Vector3[] {
  const y = deckAt(CARGO_X).y + CRATE_HALF_HEIGHT * Math.cos(CARGO_TILT) + 0.005;
  // One on top sits square on the two below, so it leans with them.
  const on = (z: number, level = 0) => new THREE.Vector3(CARGO_X + level * CRATE_STACK * Math.sin(CARGO_TILT), y + level * CRATE_STACK * Math.cos(CARGO_TILT), z);
  if (n <= 1) return [on(0)];
  if (n === 2) return [on(-0.218), on(0.218)];
  return [on(-0.218), on(0.218), on(0, 1)];
}

/** Masts: where they stand, how tall, where the boom and the gaff are, how long they are. */
const MASTS = [
  { x: 0.85, top: 2.95, boomY: 1.3, boomLength: 0.9, throatY: 2.35, gaff: 0.7 },
  { x: -0.25, top: 3.4, boomY: 1.5, boomLength: 1.25, throatY: 2.85, gaff: 0.85 },
] as const;
const GAFF_RISE = 0.55;

/** Build the ship. `crate` makes one cargo crate (the same as on the cart). */
export function buildShip(crate: () => THREE.Group): ShipModel {
  const group = new THREE.Group();
  group.name = "ship";
  group.scale.setScalar(SHIP_SCALE);
  const b = new ModelBuilder();

  // The hull: bands of colour all along it (the stripe under the deck edge, the dark topsides,
  // the red-brown bottom below the waterline), a flat transom and a deck.
  const rings = STATIONS.map(ring);
  const colors = [STRIPE, TOPSIDES, BOTTOM, BOTTOM, BOTTOM, BOTTOM, TOPSIDES, STRIPE];
  colors.forEach((color, j) => b.add(band(rings, j), color, { jitter: 0.05, quads: true, rng }));
  b.add(cap(rings[0]!, false), TOPSIDES, { jitter: 0.04, rng });
  b.add(cap(rings[rings.length - 1]!, true), TOPSIDES, { jitter: 0.04, rng });
  b.add(deck(rings), P.woodLight, { jitter: 0.06, quads: true, rng });

  // A low rail along both sides, up to the stem, and across the stern.
  for (const s of [-1, 1]) {
    for (let i = 0; i + 1 < STATIONS.length - 1; i++) {
      const [x0, h0, d0] = STATIONS[i]!;
      const [x1, h1, d1] = STATIONS[i + 1]!;
      beam(b, new THREE.Vector3(x0, d0 + 0.05, s * (h0 - 0.02)), new THREE.Vector3(x1, d1 + 0.05, s * (h1 - 0.02)), 0.045, 0.1, P.wood);
    }
    const [x0, h0, d0] = STATIONS[STATIONS.length - 2]!;
    const [x1, , d1] = STATIONS[STATIONS.length - 1]!;
    beam(b, new THREE.Vector3(x0, d0 + 0.05, s * (h0 - 0.02)), new THREE.Vector3(x1, d1 + 0.05, 0), 0.045, 0.1, P.wood);
  }
  const [sx, sh, sd] = STATIONS[0]!;
  beam(b, new THREE.Vector3(sx + 0.02, sd + 0.05, -sh + 0.02), new THREE.Vector3(sx + 0.02, sd + 0.05, sh - 0.02), 0.045, 0.1, P.wood);

  // The rudder, hung on the transom.
  b.box([0.1, 0.52, 0.04], P.wood, { at: [-1.55, 0.1, 0], jitter: 0.05, rng });
  b.box([0.05, 0.06, 0.06], P.iron, { at: [-1.51, 0.3, 0] });

  // A deckhouse between the masts: pale painted walls, a dark tarred roof, a door aft, a porthole
  // each side that's lit at night.
  const house = deckAt(0.25);
  b.box([0.5, 0.32, 0.56], HOUSE, { at: [0.25, house.y + 0.16, 0], jitter: 0.04, rng });
  b.box([0.6, 0.05, 0.66], HOUSE_ROOF, { at: [0.25, house.y + 0.345, 0], jitter: 0.05, rng });
  b.box([0.54, 0.035, 0.6], P.wood, { at: [0.25, house.y + 0.0175, 0] });
  b.box([0.03, 0.24, 0.18], P.wood, { at: [-0.005, house.y + 0.13, 0] });
  for (const s of [-1, 1]) {
    b.add(new THREE.CylinderGeometry(0.055, 0.055, 0.03, 8), P.brass, { at: [0.25, house.y + 0.19, s * 0.285], rot: [Math.PI / 2, 0, 0] });
    b.add(new THREE.CylinderGeometry(0.038, 0.038, 0.034, 8), 0xffffff, { at: [0.25, house.y + 0.19, s * 0.287], rot: [Math.PI / 2, 0, 0], material: glowMaterials.window });
  }
  // The wheel, behind the deckhouse.
  const helm = deckAt(-0.12);
  b.box([0.06, 0.24, 0.06], P.wood, { at: [-0.12, helm.y + 0.12, 0] });
  b.add(new THREE.TorusGeometry(0.1, 0.013, 4, 10), P.wood, { at: [-0.1, helm.y + 0.27, 0], rot: [0, Math.PI / 2, 0] });
  for (let k = 0; k < 4; k++) b.box([0.012, 0.25, 0.012], P.wood, { at: [-0.1, helm.y + 0.27, 0], rot: [(k * Math.PI) / 4, 0, 0] });

  // A windlass at the bow for the anchor.
  const bow = deckAt(1.3);
  b.add(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 8), P.wood, { at: [1.3, bow.y + 0.09, 0], rot: [Math.PI / 2, 0, 0] });
  for (const s of [-1, 1]) b.box([0.12, 0.16, 0.04], P.wood, { at: [1.3, bow.y + 0.08, s * 0.22] });

  // The bowsprit, the masts with flag staffs, and the shrouds.
  const sprit = { from: new THREE.Vector3(1.5, 0.52, 0), to: new THREE.Vector3(2.45, 0.7, 0) };
  rod(b, sprit.from, sprit.to, 0.035, 0.025, SPAR, 6);
  for (const m of MASTS) {
    const foot = deckAt(m.x);
    rod(b, new THREE.Vector3(m.x, foot.y - 0.05, 0), new THREE.Vector3(m.x, m.top, 0), 0.05, 0.032, SPAR, 6);
    b.box([0.09, 0.05, 0.09], P.wood, { at: [m.x, m.top - 0.2, 0] });
    rod(b, new THREE.Vector3(m.x, m.top, 0), new THREE.Vector3(m.x, m.top + 0.55, 0), 0.012, 0.009, SPAR, 4);
    b.add(new THREE.SphereGeometry(0.028, 6, 4), P.brass, { at: [m.x, m.top + 0.56, 0] });
    for (const s of [-1, 1]) {
      for (const dx of [-0.14, 0.08]) {
        const at = deckAt(m.x + dx);
        rod(b, new THREE.Vector3(m.x, m.top - 0.24, 0), new THREE.Vector3(m.x + dx, at.y + 0.08, s * (at.half - 0.03)), 0.007, 0.007, ROPE, 4);
      }
    }
  }
  // Stays: the forestay to the end of the bowsprit, and the main topmast stay to the foremast.
  const fore = MASTS[0];
  const main = MASTS[1];
  const foreStayTop = new THREE.Vector3(fore.x, fore.top - 0.12, 0);
  rod(b, foreStayTop, sprit.to, 0.008, 0.008, ROPE, 4);
  rod(b, new THREE.Vector3(main.x, main.top - 0.12, 0), new THREE.Vector3(fore.x, fore.top - 0.26, 0), 0.008, 0.008, ROPE, 4);

  // A lantern on the mainmast, lighting the after deck at night.
  b.box([0.08, 0.03, 0.04], P.iron, { at: [main.x - 0.07, 1.2, 0] });
  b.box([0.1, 0.13, 0.1], P.warmLight, { at: [main.x - 0.12, 1.12, 0], material: glowMaterials.lantern });
  b.box([0.13, 0.03, 0.13], P.iron, { at: [main.x - 0.12, 1.2, 0] });

  // Cleats on the quarters for the stern lines.
  const quarter = deckAt(-1.35);
  const cleats: [THREE.Vector3, THREE.Vector3] = [
    new THREE.Vector3(-1.35, quarter.y + 0.11, -(quarter.half - 0.04)),
    new THREE.Vector3(-1.35, quarter.y + 0.11, quarter.half - 0.04),
  ];
  for (const c of cleats) b.box([0.12, 0.03, 0.03], P.iron, { at: [c.x, c.y, c.z] });

  group.add(b.build("ship"));

  // Each mast's boom, gaff and sail turn together about the mast.
  const rigs: THREE.Group[] = [];
  const sails: Sail[] = [];
  for (const m of MASTS) {
    const rig = new THREE.Group();
    rig.position.set(m.x, 0, 0);
    const r = new ModelBuilder();
    const clew = new THREE.Vector3(-m.boomLength, m.boomY + 0.04, 0);
    const throat = new THREE.Vector3(-0.05, m.throatY, 0);
    const peak = new THREE.Vector3(-0.05 - m.gaff * Math.cos(GAFF_RISE), m.throatY + m.gaff * Math.sin(GAFF_RISE), 0);
    rod(r, new THREE.Vector3(-0.05, m.boomY, 0), clew, 0.026, 0.02, SPAR, 5);
    rod(r, throat, peak, 0.022, 0.016, SPAR, 5);
    // Collars where the boom and the gaff meet the mast.
    r.add(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 6), P.iron, { at: [0, m.boomY, 0] });
    r.add(new THREE.CylinderGeometry(0.055, 0.055, 0.05, 6), P.iron, { at: [0, m.throatY, 0] });
    rig.add(r.build("rig"));
    const sail = gaffSail(
      new THREE.Vector3(-0.06, m.boomY + 0.04, 0),
      clew.clone().setY(clew.y + 0.02),
      peak.clone().setY(peak.y - 0.03),
      throat.clone().setY(throat.y - 0.03),
      0.16,
    );
    rig.add(sail.mesh);
    sails.push(sail);
    rigs.push(rig);
    group.add(rig);
  }
  // The jib, along the forestay.
  const stay = (k: number) => sprit.to.clone().lerp(foreStayTop, k);
  const jib = jibSail(stay(0.1), stay(0.82), new THREE.Vector3(1.32, 1.0, 0), 0.14);
  group.add(jib.mesh);
  sails.push(jib);

  // GitHub's colours (only the colours): a charcoal flag on the main staff, a white pennant on the fore.
  const flags = [wavingFlag(0.55, 0.34, GITHUB_CHARCOAL), wavingFlag(0.65, 0.12, GITHUB_WHITE, true)];
  flags[0]!.mesh.position.set(main.x, main.top + 0.36, 0);
  flags[1]!.mesh.position.set(fore.x, fore.top + 0.44, 0);
  for (const f of flags) group.add(f.mesh);

  const crates: THREE.Object3D[] = [];
  for (let i = 0; i < 3; i++) {
    const c = crate();
    c.scale.setScalar(CRATE_SCALE);
    c.visible = false;
    group.add(c);
    crates.push(c);
  }

  return { group, crates, rigs, sails, flags, cleats };
}
