// GITHUB HARBOR: a wooden dock across the river, a cargo ship, and a checkpoint
// gate. A commit becomes a crate on a rail cart. The cart stops at the gate
// while it's scanned for leaked secrets: a leak keeps it there under a red
// warning light; a clean scan lifts the barrier. On push, the crates go aboard
// the ship and it sails away to GitHub.
//
// Once the cart is past the gate it waits on the dock, behind the ship. A newer
// crate that hasn't passed yet waits at the gate on its own, until it passes and
// joins the cart (or the cart comes back for it).
//
// The ship moors stern-to the dock, facing downstream. On push the crates hop
// over its stern onto the after deck, one by one; then it casts off, fills its
// sails and runs away east with the wind and the current. A while later it
// comes back up the river, turns round clear of the dock and backs onto its berth.

import * as THREE from "three";
import type { HarborLoad, LastPush } from "../../src/events/state.js";
import { HARBOR } from "./layout.js";
import { glowMesh, makeRandom, materials, ModelBuilder, pick } from "./lowpoly.js";
import { P } from "./palette.js";
import { buildShip, crateSpots, type ShipModel } from "./ship.js";

const rng = makeRandom(88);

/** Pale pine, so the cargo stands out from the dark dock and hull, by day and at dusk. */
const CRATE_BOARDS = 0xc49d68;

/**
 * A crate of commits that passed the gate: pale pine panels in a dark frame, brass corners, and
 * two teal cargo straps crossed over the top with a brass seal where they meet. It looks the same
 * from every side and from above (crates turn on the cart and aboard), and stays inside
 * 0.6 × 0.5 × 0.6, so the stacks and the spots aboard still fit.
 */
function crateModel(): THREE.Group {
  const b = new ModelBuilder();
  const w = 0.28; // half its width
  const h = 0.245; // half its height
  const t = 0.07; // the frame's thickness
  const e = w - t / 2;
  const f = h - t / 2;
  b.box([2 * w - 0.03, 2 * h - 0.03, 2 * w - 0.03], CRATE_BOARDS, { jitter: 0.05 });
  for (const x of [-e, e]) for (const z of [-e, e]) b.box([t, 2 * h, t], P.wood, { at: [x, 0, z] });
  for (const y of [-f, f]) {
    for (const s of [-e, e]) {
      b.box([2 * w, t, t], P.wood, { at: [0, y, s] });
      b.box([t, t, 2 * w], P.wood, { at: [s, y, 0] });
    }
  }
  // Two straps all the way round, crossed on top (the second sits a hair higher where they cross).
  const strap = 0.1;
  const k = 0.01;
  b.box([2 * (w + k), 2 * (h + k), strap], P.teal);
  b.box([strap, 2 * (h + k) + 0.004, 2 * (w + k)], P.teal);
  // Brass: the seal where the straps cross, a buckle on each side, and the corners.
  const brass = { material: materials.metal };
  b.add(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 10), P.brass, { ...brass, at: [0, h + k + 0.012, 0] });
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    b.box([x ? 0.016 : 0.12, 0.075, z ? 0.016 : 0.12], P.brass, { ...brass, at: [x * (w + k), 0, z * (w + k)] });
  }
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    b.box([0.085, 0.085, 0.085], P.brassDark, { ...brass, at: [x * (w - 0.035), y * (h - 0.035), z * (w - 0.035)] });
  }
  return b.build("crate");
}

type CartGoal = "start" | "gate" | "end";

/** The most crates a cart (or the ship) carries at once. More snapshots still fit: they're just not all drawn. */
const MAX_LOAD = 3;
/** Where crates sit on the cart, for 1, 2 or 3 of them: two side by side, the third on top. */
const CART_SPOTS: [number, number, number][][] = [
  [[0, 0.83, 0]],
  [
    [0, 0.83, -0.29],
    [0, 0.83, 0.29],
  ],
  [
    [0, 0.83, -0.29],
    [0, 0.83, 0.29],
    [0.02, 1.3, 0],
  ],
];
/** Crates waiting at the gate without the cart sit on a pallet, this much lower than on the cart. */
const PALLET_DROP = 0.34;
/** How far the pallet stands to the side of the rails. */
const PALLET_SIDE = 1.45;

/** Show `n` of these crates, arranged like on the cart. */
function arrange(crates: THREE.Group[], n: number, drop = 0): void {
  crates.forEach((crate, i) => {
    crate.visible = i < n;
    const spot = CART_SPOTS[Math.max(0, Math.min(n, MAX_LOAD) - 1)]?.[i];
    if (spot) crate.position.set(spot[0], spot[1] - drop, spot[2]);
    crate.rotation.y = i === 2 ? 0.35 : 0;
    crate.scale.setScalar(n > 1 ? 0.92 : 1);
  });
}

/** The river's surface: the ship floats on it. */
const WATER_Y = -0.32;
/** Where the ship moors, facing downstream (east). */
const BERTH = HARBOR.boat;
/** Where the ship turns round when it comes back: clear of the dock and of both banks. */
const TURN = { x: 18.8, z: -23.0 };
/** Far enough down the river to be out of sight. */
const FAR_X = 62;
/**
 * One crate's hop aboard, and the pause before the next one (seconds), and how high a crate from
 * the cart bed hops: it has to stay under the main boom, so the one on top just slides down.
 */
const HOP = 0.8;
const HOP_GAP = 0.25;
const HOP_HEIGHT = 0.4;
/**
 * Which cart crate hops aboard first, second, third (for 1, 2 or 3 of them): the top one first.
 * They fill the ship's spots in order, the far ones first, so no crate hops over another.
 */
const HOP_ORDER: number[][] = [[0], [1, 0], [2, 0, 1]];
/** How far the ship runs off before it's out of sight: it speeds up as its sails fill. */
const runOff = (seconds: number) => 1.1 * seconds ** 1.9;
const SAILING = ((FAR_X - BERTH.x) / 1.1) ** (1 / 1.9);
/** Seconds out of sight, coming back up the river, turning round, backing onto the berth. */
const AWAY = 1.5;
const GLIDE = 11;
const TURNING = 5.5;
const BERTHING = 4;
/** How far out the booms swing when the ship runs before the wind (radians). */
const RUNNING_BOOM = 1.0;
/** How full the sails are when there's no way on the ship: slack, flapping a little. */
const SLACK = 0.12;

type ShipState = "docked" | "loading" | "sailing" | "away" | "arriving" | "turning" | "berthing";

const smooth = (k: number) => {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
};

/** The two stern lines, from the dock's posts to the ship's quarters: rope that sags a little. */
class MooringLines {
  readonly mesh: THREE.Mesh;
  private readonly position: THREE.BufferAttribute;
  private static readonly SEGMENTS = 6;

  constructor() {
    // Each piece of rope is two crossed ribbons, so it looks round from any side.
    const vertices = 2 * MooringLines.SEGMENTS * 2 * 6;
    this.position = new THREE.BufferAttribute(new Float32Array(vertices * 3), 3);
    this.position.setUsage(THREE.DynamicDrawUsage);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", this.position);
    this.mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xcbb88e, flatShading: true, roughness: 0.95, side: THREE.DoubleSide }));
    this.mesh.name = "stern-lines";
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
  }

  set(lines: readonly (readonly [THREE.Vector3, THREE.Vector3])[]): void {
    const n = MooringLines.SEGMENTS;
    const w = 0.02;
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    const side = new THREE.Vector3();
    const lift = new THREE.Vector3(0, w, 0);
    const at = (a: THREE.Vector3, b: THREE.Vector3, sag: number, s: number, out: THREE.Vector3) => out.lerpVectors(a, b, s).setY(out.y - 4 * sag * s * (1 - s));
    let o = 0;
    for (const [a, b] of lines) {
      const sag = 0.05 + a.distanceTo(b) * 0.05;
      side.set(-(b.z - a.z), 0, b.x - a.x).normalize().multiplyScalar(w);
      for (let i = 0; i < n; i++) {
        at(a, b, sag, i / n, p);
        at(a, b, sag, (i + 1) / n, q);
        for (const off of [side, lift]) {
          const corners = [p.clone().sub(off), p.clone().add(off), q.clone().add(off), q.clone().sub(off)];
          for (const k of [0, 1, 2, 0, 2, 3]) this.position.setXYZ(o++, corners[k]!.x, corners[k]!.y, corners[k]!.z);
        }
      }
    }
    this.position.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }
}

/**
 * The ship's wake: foam spreading back from the bow in a V, and the wash behind the stern,
 * fading out behind it. It shows as much as the ship is moving.
 */
function wakeMesh(): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> {
  const positions: number[] = [];
  const colors: number[] = [];
  /** A soft strip: `spine(k)` is its middle at k (0 front, 1 back), `across` its sideways direction, alpha fading back and to both edges. */
  const strip = (spine: (k: number) => [number, number], across: (k: number) => [number, number], width: (k: number) => number, strength: number) => {
    const steps = 6;
    const point = (k: number, side: number): [number, number, number] => {
      const [x, z] = spine(k);
      const [ax, az] = across(k);
      const w = width(k) * side;
      return [x + ax * w, z + az * w, side === 0 ? strength * (1 - k) ** 1.5 : 0];
    };
    for (let i = 0; i < steps; i++) {
      for (const [s0, s1] of [[-1, 0], [0, 1]] as const) {
        const a = point(i / steps, s0), b = point(i / steps, s1), c = point((i + 1) / steps, s1), d = point((i + 1) / steps, s0);
        for (const p of [a, b, c, a, c, d]) {
          positions.push(p[0], 0, p[1]);
          colors.push(1, 1, 1, p[2]);
        }
      }
    }
  };
  // Each arm of the V, from the bow back and out.
  for (const side of [-1, 1]) {
    const dir = [-6.5, side * 2.1];
    const len = Math.hypot(dir[0]!, dir[1]!);
    strip((k) => [2.0 + dir[0]! * k, side * 0.42 + dir[1]! * k], () => [-dir[1]! / len, dir[0]! / len], (k) => 0.12 + k * 0.45, 0.9);
  }
  // The wash behind the stern.
  strip((k) => [-1.9 - k * 4, 0], () => [0, 1], (k) => 0.4 + k * 0.6, 0.7);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0xf2f5f2, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, roughness: 1, side: THREE.DoubleSide }),
  );
  mesh.name = "wake";
  mesh.renderOrder = 1;
  // Foam on the water casts no shadow (the shadow helper would give it a solid one).
  mesh.castShadow = false;
  mesh.userData.noShadow = true;
  return mesh;
}

export class Harbor {
  readonly group = new THREE.Group();
  private readonly cart = new THREE.Group();
  private readonly cartCrates: THREE.Group[] = [];
  /** Crates waiting at the gate while the cart is at the dock. */
  private readonly gateStack = new THREE.Group();
  private readonly gateCrates: THREE.Group[] = [];
  private readonly ship: ShipModel;
  /** The crate in the air on its way aboard. */
  private readonly flying = crateModel();
  private readonly lines = new MooringLines();
  private readonly wake = wakeMesh();
  /** Where the ship was last frame, for how fast it's going. */
  private readonly lastShipAt = new THREE.Vector3();
  private shipSpeed = 0;
  /** Where the stern lines are tied on the dock (port, starboard). */
  private readonly linePosts: [THREE.Vector3, THREE.Vector3];
  private readonly barrier = new THREE.Group();
  private readonly lamp: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly scanner: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly beam: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly alarm: THREE.PointLight;
  private readonly route = HARBOR.cartRoute;
  private readonly routeLengths: number[] = [];
  private readonly total: number;
  private readonly gateDistance: number;
  /** Where the cart stops on the dock: right behind the ship. */
  private readonly dockStop: number;
  private cartAt = 0;
  private load: HarborLoad = { atGate: 0, atDock: 0, gate: "idle" };
  private pushes = 0;
  private shipPending = false;
  /** How many crates the waiting push puts on the ship. */
  private shipping = 0;
  private shipState: ShipState = "docked";
  private shipTimer = 0;
  /** Crates on board (or hopping aboard) this trip. */
  private cargo = 0;
  private barrierOpen = 0;
  /** The ship's own clock for bobbing and flapping: it stands still in still mode. */
  private clock = 0;
  /** Frames left to jump straight to where things should be, after the page caught up. */
  private snapFrames = 0;

  constructor() {
    this.group.name = "harbor";
    let sum = 0;
    this.routeLengths.push(0);
    for (let i = 1; i < this.route.length; i++) {
      sum += this.route[i]!.distanceTo(this.route[i - 1]!);
      this.routeLengths.push(sum);
    }
    this.total = sum;
    // Where the cart stops, just before the barrier.
    this.gateDistance = this.routeLengths[2]! - 0.9;
    const gatePoint = this.route[2]!;
    this.dockStop = Math.min(this.total, this.routeLengths[2]! + Math.abs(gatePoint.z - BERTH.z));

    // The stern lines go to the dock's two posts either side of the berth.
    const posts: number[] = [];
    for (let z = HARBOR.dockStart.z + 0.2; z > HARBOR.dockEnd.z - 0.3; z -= 1.8) posts.push(z);
    const north = Math.max(...posts.filter((z) => z < BERTH.z));
    const south = Math.min(...posts.filter((z) => z > BERTH.z));
    const postX = HARBOR.dockStart.x + 1.25;
    this.linePosts = [new THREE.Vector3(postX + 0.1, 0.62, north), new THREE.Vector3(postX + 0.1, 0.62, south)];

    this.group.add(this.buildDock([north, south]));
    this.group.add(this.buildGate());

    // Gate lights.
    const g = HARBOR.gate;
    this.lamp = glowMesh(new THREE.SphereGeometry(0.2, 8, 6), P.glow, 0.6);
    this.lamp.position.set(g.x, 3.15, g.z);
    this.scanner = glowMesh(new THREE.BoxGeometry(2.0, 0.08, 0.14), P.glow, 0.5);
    this.scanner.position.set(g.x, 2.48, g.z);
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 1.1, 2.3, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: P.glow, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.beam.position.set(g.x, 1.3, g.z);
    this.alarm = new THREE.PointLight(P.red, 0, 9, 1.4);
    this.alarm.position.set(g.x, 2.6, g.z);
    this.group.add(this.lamp, this.scanner, this.beam, this.alarm);

    // Barrier arm, hinged on the left post.
    const arm = new ModelBuilder();
    for (let i = 0; i < 6; i++) arm.box([0.32, 0.12, 0.12], i % 2 ? P.cream : 0xc94c4c, { at: [0.16 + i * 0.33, 0, 0] });
    this.barrier.add(arm.build("barrier"));
    this.barrier.position.set(g.x - 1.05, 1.05, g.z + 0.35);
    this.group.add(this.barrier);

    // Rail cart with a crate.
    const cb = new ModelBuilder();
    cb.box([0.85, 0.32, 1.0], P.rail, { at: [0, 0.36, 0], material: materials.metal });
    cb.box([0.95, 0.07, 1.1], P.iron, { at: [0, 0.54, 0], material: materials.metal });
    for (const x of [-0.3, 0.3]) for (const z of [-0.32, 0.32]) {
      cb.add(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 8), P.iron, { at: [x, 0.17, z], rot: [0, 0, Math.PI / 2], material: materials.metal });
    }
    this.cart.add(cb.build("cart"));
    for (let i = 0; i < MAX_LOAD; i++) {
      const crate = crateModel();
      crate.visible = false;
      this.cart.add(crate);
      this.cartCrates.push(crate);
    }
    this.group.add(this.cart);
    this.placeCart(0);

    // A pallet on the rails where the cart stops at the gate, for crates waiting there on their own.
    const pallet = new ModelBuilder();
    pallet.box([0.9, 0.08, 1.05], P.wood, { at: [0, 0.2, 0], jitter: 0.05 });
    for (const z of [-0.38, 0, 0.38]) pallet.box([0.9, 0.08, 0.14], P.woodLight, { at: [0, 0.12, z] });
    this.gateStack.add(pallet.build("pallet"));
    for (let i = 0; i < MAX_LOAD; i++) {
      const crate = crateModel();
      this.gateStack.add(crate);
      this.gateCrates.push(crate);
    }
    // It stands beside the rails, so the cart can always get past it.
    this.place(this.gateStack, this.gateDistance);
    const along = this.route[2]!.clone().sub(this.route[1]!).normalize();
    this.gateStack.position.add(new THREE.Vector3(-along.z, 0, along.x).multiplyScalar(PALLET_SIDE));
    this.gateStack.visible = false;
    this.group.add(this.gateStack);

    // The ship, moored at its berth, and the crate that hops aboard.
    this.ship = buildShip(crateModel);
    this.group.add(this.ship.group);
    this.flying.visible = false;
    this.group.add(this.flying);
    this.group.add(this.lines.mesh, this.wake);
    this.poseShip(0, true);
  }

  /** The dock: planks across the river on posts. `linePosts`: the z of the two posts the stern lines tie to. */
  private buildDock(linePosts: number[]): THREE.Group {
    const b = new ModelBuilder();
    const start = HARBOR.dockStart.z + 0.4;
    const end = HARBOR.dockEnd.z - 0.3;
    const x = HARBOR.dockStart.x;
    for (let z = start; z > end; z -= 0.32) {
      b.box([2.6, 0.1, 0.28], pick([P.woodLight, P.wood, 0x8a6544], rng), { at: [x + (rng() - 0.5) * 0.06, 0.26, z], jitter: 0.05 });
    }
    for (let z = start - 0.2; z > end; z -= 1.8) {
      for (const dx of [-1.25, 1.25]) {
        b.add(new THREE.CylinderGeometry(0.11, 0.13, 1.6, 6), P.wood, { at: [x + dx, -0.4, z] });
        b.add(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 6), P.wood, { at: [x + dx, 0.5, z] });
      }
    }
    // The eyes of the stern lines, looped over their posts.
    for (const z of linePosts) b.add(new THREE.TorusGeometry(0.11, 0.025, 4, 10), 0xcbb88e, { at: [x + 1.25, 0.62, z], rot: [Math.PI / 2, 0, 0] });
    return b.build("dock");
  }

  private buildGate(): THREE.Group {
    const b = new ModelBuilder();
    const g = HARBOR.gate;
    for (const dx of [-1.15, 1.15]) {
      b.box([0.45, 2.7, 0.45], P.stone, { at: [g.x + dx, 1.35, g.z], jitter: 0.07 });
      b.box([0.6, 0.22, 0.6], P.stoneDark, { at: [g.x + dx, 2.76, g.z] });
    }
    b.box([2.9, 0.3, 0.5], P.wood, { at: [g.x, 2.7, g.z] });
    b.box([0.35, 0.3, 0.35], P.iron, { at: [g.x, 2.98, g.z], material: materials.metal });
    b.box([1.0, 0.36, 0.06], P.cream, { at: [g.x, 3.0, g.z + 0.26] }); // sign board (label shows the words)
    return b.build("gate");
  }

  /** Put something on the rails, this far along the cart's route. */
  private place(obj: THREE.Object3D, distance: number): void {
    const d = Math.max(0, Math.min(this.total, distance));
    let i = 1;
    while (i < this.route.length - 1 && this.routeLengths[i]! < d) i++;
    const a = this.route[i - 1]!;
    const b = this.route[i]!;
    const k = (d - this.routeLengths[i - 1]!) / (this.routeLengths[i]! - this.routeLengths[i - 1]!);
    obj.position.lerpVectors(a, b, k);
    obj.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
  }

  private placeCart(distance: number): void {
    this.place(this.cart, distance);
  }

  /**
   * Follow the village state: where the crates are, and how many pushes happened.
   * `fresh`: the page just caught up with everything so far (it opened, or reconnected).
   * Pushes from before aren't new, so the ship stays, and the cart goes straight to its place.
   */
  sync(load: HarborLoad, pushes: number, lastPush?: LastPush, fresh = false): void {
    this.load = load;
    if (fresh) {
      this.pushes = pushes;
      this.shipPending = false;
      this.shipping = 0;
      this.snapFrames = 3; // a few big steps: the cart may have to wait one for the barrier
      return;
    }
    if (pushes > this.pushes) {
      // A push sends its commits even when none were seen being saved (made outside CLI
      // Village, or a forced push). Pushes the ship hasn't taken yet add up.
      const sent = Math.max(lastPush?.crates ?? 0, lastPush?.commits ?? 0);
      this.shipping = Math.min(MAX_LOAD, (this.shipPending ? this.shipping : 0) + sent);
      this.shipPending = true;
    }
    this.pushes = pushes;
  }

  private goal(): CartGoal {
    // The cart stays at the dock while its crates hop aboard.
    if (this.shipState === "loading") return "end";
    if (this.shipPending && this.shipping > 0) return "end";
    // Crates that passed the gate wait at the dock; ones that haven't wait at the gate.
    if (this.load.atDock > 0) return "end";
    if (this.load.atGate > 0) return "gate";
    return "start";
  }

  update(dt: number, t: number, still = false): void {
    if (this.snapFrames > 0) {
      this.snapFrames--;
      dt = 60;
    }
    if (!still) this.clock += Math.min(dt, 0.1);
    // Move the cart toward where it should be.
    const gate = this.gateDistance;
    const goal = this.goal();
    const target = goal === "start" ? 0 : goal === "gate" ? gate : this.dockStop;
    const speed = 3.2;
    if (Math.abs(target - this.cartAt) > 0.01) {
      // The cart can't pass the closed barrier.
      const limit = this.barrierOpen < 0.8 && this.cartAt <= gate + 0.01 ? gate : this.total;
      const next = this.cartAt + Math.sign(target - this.cartAt) * Math.min(Math.abs(target - this.cartAt), speed * dt);
      this.cartAt = Math.min(next, Math.max(limit, this.cartAt));
    }
    this.placeCart(this.cartAt);

    // At the dock with a push waiting: the crates go aboard (a push that only published the
    // branch has no crates, so the ship doesn't wait for the cart).
    const cartArrived = this.shipping === 0 || this.cartAt >= this.dockStop - 0.05;
    if (this.shipPending && cartArrived && this.shipState === "docked") {
      this.shipPending = false;
      this.cargo = this.shipping;
      this.shipping = 0;
      crateSpots(this.cargo).forEach((spot, i) => {
        const crate = this.ship.crates[i]!;
        crate.position.copy(spot);
        // Turned like they were on the cart, so they don't spin round on the way.
        crate.rotation.y = Math.PI + (i - 1) * 0.07;
      });
      this.setShipState(this.cargo > 0 ? "loading" : "sailing");
    }
    this.advanceShip(dt);

    // Crates that haven't passed the gate ride the cart up to it. Once the cart has gone
    // on to the dock, they wait at the gate on a pallet, until the cart comes back for them.
    const passed = this.cartAt > gate + 0.05;
    const onPallet = this.shipPending || passed ? this.load.atGate : 0;
    if (this.shipState === "loading") {
      // The cart keeps its load where it was, less the crates that have hopped off.
      arrange(this.cartCrates, this.cargo);
      const order = HOP_ORDER[this.cargo - 1]!;
      order.forEach((from, k) => {
        if (this.shipTimer >= k * (HOP + HOP_GAP)) this.cartCrates[from]!.visible = false;
      });
    } else {
      arrange(this.cartCrates, this.shipPending ? this.shipping : this.load.atDock + (passed ? 0 : this.load.atGate));
    }
    arrange(this.gateCrates, onPallet, PALLET_DROP);
    this.gateStack.visible = onPallet > 0;

    this.poseShip(dt, still);

    // Barrier: open to let the cart through to the dock, or to let it come back. It closes
    // behind the cart, so a later check stops the next crate.
    const goingOn = goal === "end" && this.cartAt <= gate + 0.8;
    const comingBack = target < this.cartAt - 0.01 && this.cartAt > gate - 0.5;
    this.barrierOpen += ((goingOn || comingBack ? 1 : 0) - this.barrierOpen) * Math.min(1, dt * 3);
    this.barrier.rotation.z = this.barrierOpen * 1.35;

    // Gate lights: cyan sweep while scanning, blinking red when a crate is stopped, green when clear.
    const light = this.load.gate;
    const lampColor = light === "stopped" ? P.red : light === "clear" ? P.health[0] : P.glow;
    this.lamp.material.color.set(lampColor);
    this.lamp.material.emissive.set(lampColor);
    this.scanner.material.emissive.set(lampColor);
    const blink = Math.sin(t * 9) > 0 ? 1 : 0.2;
    this.lamp.material.emissiveIntensity = light === "stopped" ? 3 * blink : light === "scanning" ? 1.5 + Math.sin(t * 7) : 0.7;
    this.scanner.material.emissiveIntensity = light === "scanning" ? 2 + Math.sin(t * 14) : light === "stopped" ? 2 * blink : 0.5;
    this.beam.material.color.set(lampColor);
    this.beam.material.opacity = light === "scanning" ? 0.16 + Math.sin(t * 10) * 0.06 : light === "stopped" ? 0.22 * blink : 0;
    this.beam.rotation.y = t * 2;
    this.alarm.intensity = light === "stopped" ? 9 * blink : 0;
  }

  private setShipState(state: ShipState): void {
    this.shipState = state;
    this.shipTimer = 0;
  }

  /** How long the ship spends in a state (seconds). */
  private stateLength(state: ShipState): number {
    switch (state) {
      case "docked":
        return Infinity;
      case "loading":
        return this.cargo * (HOP + HOP_GAP);
      case "sailing":
        return SAILING;
      case "away":
        return AWAY;
      case "arriving":
        return GLIDE;
      case "turning":
        return TURNING;
      case "berthing":
        return BERTHING;
    }
  }

  /** Move the ship's story on by `dt` seconds: a big step goes through as many states as it covers. */
  private advanceShip(dt: number): void {
    const next: Record<ShipState, ShipState> = {
      docked: "docked",
      loading: "sailing",
      sailing: "away",
      away: "arriving",
      arriving: "turning",
      turning: "berthing",
      berthing: "docked",
    };
    this.shipTimer += dt;
    for (let guard = 0; guard < 8 && this.shipTimer >= this.stateLength(this.shipState); guard++) {
      const left = this.shipTimer - this.stateLength(this.shipState);
      const state = next[this.shipState];
      // Out of sight, the crates are delivered.
      if (state === "away") this.cargo = 0;
      this.setShipState(state);
      this.shipTimer = state === "docked" ? 0 : left;
    }
  }

  /** Put the ship where its story says, with its sails, flags, crates and lines. */
  private poseShip(dt: number, still: boolean): void {
    const k = this.shipTimer;
    let x = BERTH.x;
    let z = BERTH.z;
    let heading = 0;
    let full = SLACK;
    let boom = 0;
    switch (this.shipState) {
      case "sailing":
        x += runOff(k);
        full = SLACK + (1 - SLACK) * smooth(k / 1.5);
        boom = RUNNING_BOOM * smooth(k / 2.2);
        break;
      case "away":
        x = FAR_X;
        break;
      case "arriving": {
        // Up the river under sail, slowing down as it comes in.
        const e = k / GLIDE;
        x = FAR_X + (TURN.x - FAR_X) * (1 - (1 - e) ** 3);
        z = TURN.z;
        heading = Math.PI;
        const way = Math.min(1, ((3 * (FAR_X - TURN.x)) / GLIDE) * (1 - e) ** 2 / 5);
        full = SLACK + (1 - SLACK) * way;
        boom = 0.3 * way;
        break;
      }
      case "turning":
        x = TURN.x;
        z = TURN.z;
        heading = Math.PI * (1 - smooth(k / TURNING));
        break;
      case "berthing": {
        const e = smooth(k / BERTHING);
        x = TURN.x + (BERTH.x - TURN.x) * e;
        z = TURN.z + (BERTH.z - TURN.z) * e;
        break;
      }
    }
    const ship = this.ship;
    const c = this.clock;
    ship.group.visible = this.shipState !== "away";
    // The wake: as strong as the ship is fast (eased, so a big still-mode step doesn't flash it).
    if (dt > 0 && dt < 0.5) {
      const speed = Math.hypot(x - this.lastShipAt.x, z - this.lastShipAt.z) / dt;
      this.shipSpeed += (speed - this.shipSpeed) * Math.min(1, dt * 4);
    } else this.shipSpeed = 0;
    this.lastShipAt.set(x, 0, z);
    this.wake.visible = ship.group.visible && this.shipSpeed > 0.05;
    this.wake.material.opacity = Math.min(1, this.shipSpeed / 4) * 0.5;
    this.wake.position.set(x, WATER_Y + 0.03, z);
    this.wake.rotation.y = heading;
    ship.group.position.set(x, WATER_Y + Math.sin(c * 1.6) * 0.03, z);
    ship.group.rotation.set(Math.sin(c * 1.3) * 0.02, heading, Math.sin(c * 1.05 + 1) * 0.012, "YXZ");
    for (const rig of ship.rigs) rig.rotation.y = boom;
    for (const sail of ship.sails) sail.update(full, c);
    for (const flag of ship.flags) {
      flag.mesh.rotation.y = -heading; // the wind blows east, whichever way the ship points
      flag.update(Math.min(dt, 0.1), still);
    }

    // Crates on board: the ones that have landed.
    const loading = this.shipState === "loading";
    const landed = loading ? Math.min(this.cargo, Math.floor((k + HOP_GAP) / (HOP + HOP_GAP))) : this.shipState === "sailing" ? this.cargo : 0;
    ship.crates.forEach((crate, i) => (crate.visible = i < landed));

    // The crate in the air: from its place on the cart, over the stern, down onto its spot.
    const hop = loading ? Math.floor(k / (HOP + HOP_GAP)) : -1;
    const s = loading ? (k - hop * (HOP + HOP_GAP)) / HOP : 1;
    this.flying.visible = loading && hop < this.cargo && s < 1;
    if (this.flying.visible) {
      const from = this.cartCrates[HOP_ORDER[this.cargo - 1]![hop]!]!;
      const to = ship.crates[hop]!;
      const a = from.getWorldPosition(new THREE.Vector3());
      const b = to.getWorldPosition(new THREE.Vector3());
      // It gets across early and drops onto its spot from above, so it clears the stern rail.
      const across = 1 - (1 - s) ** 2;
      const lift = Math.max(0, HOP_HEIGHT - (a.y - CART_SPOTS[0]![0]![1]));
      this.flying.position.lerpVectors(a, b, across).setY(THREE.MathUtils.lerp(a.y, b.y, s) + 4 * lift * s * (1 - s));
      this.flying.quaternion.slerpQuaternions(from.getWorldQuaternion(new THREE.Quaternion()), to.getWorldQuaternion(new THREE.Quaternion()), s);
      this.flying.scale.setScalar(THREE.MathUtils.lerp(from.getWorldScale(new THREE.Vector3()).x, to.getWorldScale(new THREE.Vector3()).x, s));
    }

    // Stern lines while it's moored.
    const moored = this.shipState === "docked" || loading;
    this.lines.mesh.visible = moored;
    if (moored) {
      const [port, starboard] = ship.cleats.map((cleat) => ship.group.localToWorld(cleat.clone()));
      this.lines.set([
        [this.linePosts[0], port!],
        [this.linePosts[1], starboard!],
      ]);
    }
  }
}
