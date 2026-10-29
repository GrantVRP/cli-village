// GITHUB HARBOR: a wooden dock across the river, a boat, and a checkpoint
// gate. A commit becomes a crate on a rail cart. The cart stops at the gate
// while it's scanned for leaked secrets: a leak keeps it there under a red
// warning light; a clean scan lifts the barrier. On push, the boat sails away.

import * as THREE from "three";
import type { Crate } from "../../src/events/state.js";
import { HARBOR, RIVER_Z } from "./layout.js";
import { glowMesh, makeRandom, materials, ModelBuilder, pick } from "./lowpoly.js";
import { P } from "./palette.js";

const rng = makeRandom(88);

function crateModel(): THREE.Group {
  const b = new ModelBuilder();
  b.box([0.56, 0.5, 0.56], P.woodLight, { jitter: 0.06 });
  for (const y of [-0.18, 0.18]) b.box([0.6, 0.07, 0.6], P.wood, { at: [0, y, 0] });
  b.box([0.07, 0.5, 0.6], P.wood, { at: [0, 0, 0], rot: [0, 0, 0.6] });
  return b.build("crate");
}

type CartGoal = "start" | "gate" | "end";

export class Harbor {
  readonly group = new THREE.Group();
  private readonly cart = new THREE.Group();
  private readonly cartCrate: THREE.Group;
  private readonly boat = new THREE.Group();
  private readonly boatCrates: THREE.Group[] = [];
  private readonly barrier = new THREE.Group();
  private readonly lamp: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly scanner: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly beam: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly alarm: THREE.PointLight;
  private readonly sail: THREE.Mesh;
  private readonly route = HARBOR.cartRoute;
  private readonly routeLengths: number[] = [];
  private readonly total: number;
  private cartAt = 0;
  private status: Crate["status"] | "none" = "none";
  private pushes = 0;
  private shipPending = false;
  private boatState: "docked" | "sailing" | "returning" = "docked";
  private boatTimer = 0;
  private boatCargo = 0;
  private barrierOpen = 0;

  constructor() {
    this.group.name = "harbor";
    let sum = 0;
    this.routeLengths.push(0);
    for (let i = 1; i < this.route.length; i++) {
      sum += this.route[i]!.distanceTo(this.route[i - 1]!);
      this.routeLengths.push(sum);
    }
    this.total = sum;

    this.group.add(this.buildDock());
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
    this.cartCrate = crateModel();
    this.cartCrate.position.y = 0.83;
    this.cartCrate.visible = false;
    this.cart.add(this.cartCrate);
    this.group.add(this.cart);
    this.placeCart(0);

    // The boat, moored by the dock.
    this.sail = this.buildBoat();
    this.boat.position.copy(HARBOR.boat);
    this.group.add(this.boat);
  }

  private buildDock(): THREE.Group {
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
    // Ropes and a bollard by the boat.
    b.add(new THREE.CylinderGeometry(0.12, 0.15, 0.4, 8), P.iron, { at: [x + 1.1, 0.5, RIVER_Z], material: materials.metal });
    b.box([1.6, 0.03, 0.03], 0xd8c8a0, { at: [x + 1.9, 0.55, RIVER_Z + 0.2], rot: [0, 0.2, -0.1] });
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

  private buildBoat(): THREE.Mesh {
    const b = new ModelBuilder();
    // Hull: a side profile with a pointed bow, pushed out sideways.
    const hull = new THREE.Shape();
    hull.moveTo(-1.6, 0.25);
    hull.lineTo(1.2, 0.25);
    hull.lineTo(1.95, 0.75);
    hull.lineTo(-1.75, 0.75);
    hull.closePath();
    const hullGeo = new THREE.ExtrudeGeometry(hull, { depth: 1.25, bevelEnabled: false });
    hullGeo.translate(0, -0.3, -0.62);
    b.add(hullGeo, P.wood, { jitter: 0.06 });
    b.box([3.5, 0.08, 1.15], P.woodLight, { at: [0.05, 0.47, 0] });
    b.box([3.5, 0.12, 0.1], P.teal, { at: [0.1, 0.42, 0.63] });
    b.box([3.5, 0.12, 0.1], P.teal, { at: [0.1, 0.42, -0.63] });
    b.box([0.9, 0.6, 0.85], P.cream, { at: [-1.0, 0.8, 0] });
    b.box([1.05, 0.1, 1.0], P.roof2, { at: [-1.0, 1.14, 0] });
    b.add(new THREE.CylinderGeometry(0.05, 0.06, 2.8, 6), P.wood, { at: [0.3, 1.9, 0] });
    b.box([1.4, 0.05, 0.05], P.wood, { at: [0.85, 1.0, 0] });
    this.boat.add(b.build("boat"));
    const sailShape = new THREE.Shape();
    sailShape.moveTo(0, 0);
    sailShape.lineTo(1.4, 0);
    sailShape.lineTo(0, 2.3);
    sailShape.closePath();
    const sail = new THREE.Mesh(
      new THREE.ShapeGeometry(sailShape),
      new THREE.MeshStandardMaterial({ color: P.cream, flatShading: true, side: THREE.DoubleSide, roughness: 0.9 }),
    );
    sail.position.set(0.35, 1.05, 0.02);
    sail.castShadow = true;
    this.boat.add(sail);
    for (let i = 0; i < 3; i++) {
      const crate = crateModel();
      crate.position.set(1.0 - i * 0.62, 0.77, 0);
      crate.visible = false;
      this.boat.add(crate);
      this.boatCrates.push(crate);
    }
    return sail;
  }

  private placeCart(distance: number): void {
    const d = Math.max(0, Math.min(this.total, distance));
    let i = 1;
    while (i < this.route.length - 1 && this.routeLengths[i]! < d) i++;
    const a = this.route[i - 1]!;
    const b = this.route[i]!;
    const k = (d - this.routeLengths[i - 1]!) / (this.routeLengths[i]! - this.routeLengths[i - 1]!);
    this.cart.position.lerpVectors(a, b, k);
    this.cart.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
  }

  /** Follow the village state: the newest crate and how many pushes happened. */
  sync(crates: readonly Crate[], pushes: number): void {
    const latest = [...crates].reverse().find((c) => c.status !== "shipped");
    this.status = latest?.status ?? "none";
    if (latest) this.cartCrate.visible = true;
    if (pushes > this.pushes) this.shipPending = true;
    this.pushes = pushes;
  }

  private goal(): CartGoal {
    if (this.shipPending) return "end";
    switch (this.status) {
      case "packed":
      case "scanning":
      case "blocked":
        return "gate";
      case "cleared":
        return "end";
      default:
        return "start";
    }
  }

  update(dt: number, t: number): void {
    // Move the cart toward where it should be.
    const gateDistance = this.routeLengths[2]! - 0.9;
    const goal = this.goal();
    const target = goal === "start" ? 0 : goal === "gate" ? gateDistance : this.total;
    const speed = 3.2;
    if (Math.abs(target - this.cartAt) > 0.01) {
      // The cart can't pass the closed barrier.
      const limit = this.barrierOpen < 0.8 && this.cartAt <= gateDistance + 0.01 ? gateDistance : this.total;
      const next = this.cartAt + Math.sign(target - this.cartAt) * Math.min(Math.abs(target - this.cartAt), speed * dt);
      this.cartAt = Math.min(next, Math.max(limit, this.cartAt));
    }
    this.placeCart(this.cartAt);

    // At the end of the dock with a push waiting: load the crate onto the boat.
    if (this.shipPending && this.cartAt >= this.total - 0.05 && this.boatState === "docked") {
      this.shipPending = false;
      this.cartCrate.visible = false;
      this.boatCargo = Math.min(3, this.boatCargo + 1);
      this.boatCrates.forEach((c, i) => (c.visible = i < this.boatCargo));
      this.boatState = "sailing";
      this.boatTimer = 0;
    }
    if (!this.shipPending && this.status === "none" && this.cartAt < 0.05) this.cartCrate.visible = false;

    // Barrier: open for a cleared crate, or to let the cart come back.
    const wantOpen = this.status === "cleared" || this.shipPending || (goal === "start" && this.cartAt > gateDistance - 0.5);
    this.barrierOpen += ((wantOpen ? 1 : 0) - this.barrierOpen) * Math.min(1, dt * 3);
    this.barrier.rotation.z = this.barrierOpen * 1.35;

    // Gate lights: cyan sweep while scanning, blinking red for a leak, green when clear.
    const lampColor = this.status === "blocked" ? P.red : this.status === "cleared" ? P.health[0] : P.glow;
    this.lamp.material.color.set(lampColor);
    this.lamp.material.emissive.set(lampColor);
    this.scanner.material.emissive.set(lampColor);
    const blink = Math.sin(t * 9) > 0 ? 1 : 0.2;
    this.lamp.material.emissiveIntensity = this.status === "blocked" ? 3 * blink : this.status === "scanning" ? 1.5 + Math.sin(t * 7) : 0.7;
    this.scanner.material.emissiveIntensity = this.status === "scanning" ? 2 + Math.sin(t * 14) : this.status === "blocked" ? 2 * blink : 0.5;
    this.beam.material.color.set(lampColor);
    this.beam.material.opacity = this.status === "scanning" ? 0.16 + Math.sin(t * 10) * 0.06 : this.status === "blocked" ? 0.22 * blink : 0;
    this.beam.rotation.y = t * 2;
    this.alarm.intensity = this.status === "blocked" ? 9 * blink : 0;

    // Boat: bob at the dock, sail away on push, then a fresh boat glides in.
    const dock = HARBOR.boat;
    this.boat.rotation.z = Math.sin(t * 1.3) * 0.03;
    this.boat.position.y = dock.y + Math.sin(t * 1.6) * 0.05;
    this.sail.scale.x = 1 + Math.sin(t * 2) * 0.04;
    if (this.boatState === "sailing") {
      this.boatTimer += dt;
      this.boat.position.x = dock.x + Math.pow(this.boatTimer, 1.6) * 1.8;
      this.sail.scale.x = 1.15;
      if (this.boat.position.x > 62) {
        this.boatState = "returning";
        this.boatTimer = 0;
        this.boatCargo = 0;
        this.boatCrates.forEach((c) => (c.visible = false));
        this.boat.position.x = -62;
      }
    } else if (this.boatState === "returning") {
      this.boatTimer += dt;
      const k = Math.min(1, this.boatTimer / 9);
      const ease = 1 - Math.pow(1 - k, 3);
      this.boat.position.x = -62 + (dock.x + 62) * ease;
      if (k >= 1) this.boatState = "docked";
    } else {
      this.boat.position.x = dock.x;
    }
  }
}
