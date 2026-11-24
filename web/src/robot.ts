// A little steampunk robot: brass barrel body, glowing cyan lantern head,
// a top hat or cap, and a crook staff with a hanging lantern.
// About a third of the height of a door.

import * as THREE from "three";
import type { AgentStatus } from "../../src/events/state.js";
import type { Building } from "../../src/events/types.js";
import { materials, ModelBuilder } from "./lowpoly.js";
import { keepDry } from "./render/weathering.js";
import { P } from "./palette.js";

const HATS = [
  { kind: "top", color: P.purple },
  { kind: "cap", color: P.teal },
  { kind: "top", color: 0x2e2a26 },
  { kind: "cap", color: 0xb5562f },
  { kind: "top", color: P.wood },
  { kind: "cap", color: P.purple },
] as const;

const CYAN = new THREE.Color(P.glow);
const RED = new THREE.Color(P.red);
// Doors are 1.6 tall. Robots are a bit under half that, so they stay small but
// are still easy to spot from the default camera height.
const SCALE = 0.7;
const SPEED = 2.6;

export interface TrailSink {
  spawn(position: THREE.Vector3): void;
}

export class Robot {
  readonly group = new THREE.Group();
  /** Where speech bubbles attach. */
  readonly bubbleAnchor = new THREE.Object3D();
  /** The building it's at, or walking to. */
  building: Building | null = null;
  status: AgentStatus = "idle";
  private readonly body = new THREE.Group();
  private readonly legs: THREE.Object3D[] = [];
  private readonly staff = new THREE.Group();
  private readonly headMaterial: THREE.MeshStandardMaterial;
  private readonly staffLanternMaterial: THREE.MeshStandardMaterial;
  private path: THREE.Vector3[] = [];
  private lookTarget: THREE.Vector3 | null = null;
  private trailTimer = 0;
  private readonly phase: number;
  private heading = 0;

  constructor(
    readonly name: string,
    index: number,
  ) {
    this.phase = index * 1.7;
    const hat = HATS[index % HATS.length]!;
    const metal = materials.metal;
    const b = new ModelBuilder();
    // Brass barrel body with darker bands and rivets.
    b.add(new THREE.CylinderGeometry(0.2, 0.23, 0.44, 10), P.brass, { at: [0, 0.48, 0], material: metal, jitter: 0.05 });
    for (const y of [0.31, 0.48, 0.66]) {
      b.add(new THREE.TorusGeometry(0.218, 0.022, 4, 14).rotateX(Math.PI / 2), P.brassDark, { at: [0, y, 0], material: metal });
    }
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      b.add(new THREE.SphereGeometry(0.018, 4, 3), P.brassDark, { at: [Math.sin(a) * 0.215, 0.57, Math.cos(a) * 0.215], material: metal });
    }
    // A little gauge on the chest.
    b.add(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 10), P.cream, { at: [0, 0.48, 0.225], rot: [Math.PI / 2, 0, 0] });
    // Neck and lantern head frame.
    b.add(new THREE.CylinderGeometry(0.06, 0.08, 0.07, 8), P.iron, { at: [0, 0.73, 0], material: metal });
    b.add(new THREE.CylinderGeometry(0.15, 0.13, 0.04, 8), P.brassDark, { at: [0, 0.78, 0], material: metal });
    b.add(new THREE.CylinderGeometry(0.13, 0.15, 0.04, 8), P.brassDark, { at: [0, 0.99, 0], material: metal });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      b.box([0.025, 0.2, 0.025], P.brassDark, { at: [Math.sin(a) * 0.125, 0.885, Math.cos(a) * 0.125], material: metal });
    }
    // Hat.
    if (hat.kind === "top") {
      b.add(new THREE.CylinderGeometry(0.2, 0.2, 0.025, 10), hat.color, { at: [0, 1.02, 0] });
      b.add(new THREE.CylinderGeometry(0.12, 0.13, 0.22, 10), hat.color, { at: [0, 1.14, 0] });
      b.add(new THREE.CylinderGeometry(0.132, 0.132, 0.04, 10), P.gold, { at: [0, 1.06, 0] });
    } else {
      b.add(new THREE.SphereGeometry(0.15, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), hat.color, { at: [0, 1.01, 0] });
      b.box([0.2, 0.025, 0.14], hat.color, { at: [0, 1.02, 0.16] });
    }
    // Arms.
    for (const side of [-1, 1]) {
      b.add(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 5), P.iron, { at: [side * 0.25, 0.5, 0.02], rot: [0, 0, side * 0.25], material: metal });
      b.add(new THREE.SphereGeometry(0.045, 5, 4), P.brassDark, { at: [side * 0.29, 0.35, 0.03], material: metal });
    }
    this.body.add(b.build(`robot-${name}`));

    // The glowing lantern head.
    this.headMaterial = new THREE.MeshStandardMaterial({ color: CYAN, emissive: CYAN, emissiveIntensity: 1.6, flatShading: true });
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.17, 8), this.headMaterial);
    head.position.y = 0.885;
    this.body.add(head);

    // Legs (they swing when walking).
    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(side * 0.09, 0.27, 0);
      const lb = new ModelBuilder();
      lb.box([0.08, 0.2, 0.08], P.iron, { at: [0, -0.1, 0], material: metal });
      lb.box([0.11, 0.06, 0.16], P.brassDark, { at: [0, -0.22, 0.03], material: metal });
      leg.add(lb.build("leg"));
      this.legs.push(leg);
      this.body.add(leg);
    }

    // Crook staff with a hanging lantern, held in the right hand.
    const sb = new ModelBuilder();
    sb.add(new THREE.CylinderGeometry(0.018, 0.022, 1.15, 5), P.wood, { at: [0, 0.57, 0] });
    sb.add(new THREE.TorusGeometry(0.08, 0.018, 4, 8, Math.PI), P.wood, { at: [0.08, 1.15, 0], rot: [0, 0, 0] });
    sb.box([0.01, 0.1, 0.01], P.iron, { at: [0.16, 1.1, 0], material: metal });
    this.staff.add(sb.build("staff"));
    this.staffLanternMaterial = new THREE.MeshStandardMaterial({ color: CYAN, emissive: CYAN, emissiveIntensity: 1.4, flatShading: true });
    const staffLantern = new THREE.Mesh(new THREE.OctahedronGeometry(0.055, 0), this.staffLanternMaterial);
    staffLantern.position.set(0.16, 1.0, 0);
    this.staff.add(staffLantern);
    this.staff.position.set(0.32, 0, 0.06);
    this.body.add(this.staff);

    this.bubbleAnchor.position.y = 1.35;
    this.body.add(this.bubbleAnchor);

    this.body.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) child.castShadow = true;
    });
    head.castShadow = false;
    this.group.add(this.body);
    this.group.scale.setScalar(SCALE);
    keepDry(this.group);
  }

  get walking(): boolean {
    return this.path.length > 0;
  }

  /** Start walking along these points. */
  walk(points: THREE.Vector3[], lookAt: THREE.Vector3 | null): void {
    this.path = points.slice(1);
    this.lookTarget = lookAt;
  }

  /** Put the robot somewhere right away, already facing the right way (when it first appears, or in still mode). */
  place(point: THREE.Vector3, lookAt: THREE.Vector3 | null): void {
    this.group.position.copy(point);
    this.path = [];
    this.lookTarget = lookAt;
    if (lookAt) {
      const to = lookAt.clone().sub(point);
      this.heading = Math.atan2(to.x, to.z);
      this.group.rotation.y = this.heading;
    }
  }

  update(dt: number, t: number, trails: TrailSink): void {
    const pos = this.group.position;
    let moving = false;
    if (this.path.length > 0) {
      const next = this.path[0]!;
      const to = next.clone().sub(pos).setY(0);
      const dist = to.length();
      const step = SPEED * dt;
      if (dist <= step) {
        pos.copy(next);
        this.path.shift();
      } else {
        pos.addScaledVector(to.normalize(), step);
        this.turnTowards(Math.atan2(to.x, to.z), dt);
      }
      moving = true;
      this.trailTimer -= dt;
      if (this.trailTimer <= 0) {
        this.trailTimer = 0.07;
        trails.spawn(pos);
      }
    } else if (this.lookTarget) {
      const to = this.lookTarget.clone().sub(pos);
      this.turnTowards(Math.atan2(to.x, to.z), dt);
    }

    // Idle: a gentle bob. Walking: bob and sway, legs swinging.
    const p = this.phase;
    if (moving) {
      this.body.position.y = Math.abs(Math.sin(t * 9 + p)) * 0.07;
      this.body.rotation.z = Math.sin(t * 9 + p) * 0.08;
      this.legs[0]!.rotation.x = Math.sin(t * 9 + p) * 0.6;
      this.legs[1]!.rotation.x = -Math.sin(t * 9 + p) * 0.6;
      this.staff.rotation.x = Math.sin(t * 9 + p) * 0.15;
    } else {
      this.body.position.y = Math.sin(t * 2.2 + p) * 0.03;
      this.body.rotation.z *= 0.9;
      for (const leg of this.legs) leg.rotation.x *= 0.85;
      this.staff.rotation.x = Math.sin(t * 1.3 + p) * 0.05;
    }
    this.staff.rotation.z = Math.sin(t * 1.7 + p) * 0.05;

    // Lantern color: cyan normally, red when something went wrong.
    const failed = this.status === "failed";
    const color = failed ? RED : CYAN;
    const working = this.status === "working";
    const glow = failed ? 1.8 + Math.sin(t * 6) * 0.6 : working ? 2.0 + Math.sin(t * 4 + p) * 0.4 : 1.3;
    this.headMaterial.color.lerp(color, 0.15);
    this.headMaterial.emissive.lerp(color, 0.15);
    this.headMaterial.emissiveIntensity = glow;
    this.staffLanternMaterial.emissive.lerp(color, 0.15);
  }

  private turnTowards(target: number, dt: number): void {
    let delta = target - this.heading;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.heading += delta * Math.min(1, dt * 8);
    this.group.rotation.y = this.heading;
  }
}
