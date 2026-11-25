// The dock crane: a slewing derrick on the dock's village side, beside the ship's stern. On a
// push it lifts the crates off the cart one at a time and swings them aboard. Its boom luffs
// (tilts up and down) to reach nearer or farther, its turntable slews round, and its hook hangs
// straight down from the boom's tip.

import * as THREE from "three";
import { materials, ModelBuilder } from "./lowpoly.js";
import { P } from "./palette.js";

/** Where the crane stands (the middle of its turntable, on the dock's planks): on the village side of the berth, so it's in sight, clear of the cart, the rails and the stern lines. */
export const CRANE_AT = new THREE.Vector3(14.55, 0.31, -21.9);
/** The boom's heel: out from the slewing axis, and up from the planks. */
const HEEL_OUT = 0.2;
const HEEL_UP = 0.66;
/** The boom's length, from its heel to the sheave at its tip. */
const BOOM = 3.4;
/** The pedestal's height, where the turntable sits. */
const PEDESTAL = 0.36;
/** The A-frame's top, where the topping lift holds the boom (in the turntable's frame: +x is where the boom points). */
const APEX = new THREE.Vector3(-0.12, 1.95, 0);
/** The winch drum, where the hoist rope comes from. */
const DRUM = new THREE.Vector3(-0.05, 0.22, 0);
const ROPE_DARK = 0x4a3c2e;
const TIMBER = 0x6e5038;

/** Where the crane points: which way (radians: 0 is east, a quarter turn is north), how far out the hook is from its axis, and how high the hook is. */
export interface CranePose {
  slew: number;
  reach: number;
  hook: number;
}

/** The slew and reach that put the hook straight above a point. */
export function aimAt(x: number, z: number): { slew: number; reach: number } {
  return { slew: Math.atan2(-(z - CRANE_AT.z), x - CRANE_AT.x), reach: Math.hypot(x - CRANE_AT.x, z - CRANE_AT.z) };
}

/** Blend two poses: the slew the short way round. */
export function mixPose(a: CranePose, b: CranePose, k: number): CranePose {
  let turn = b.slew - a.slew;
  turn = Math.atan2(Math.sin(turn), Math.cos(turn));
  return { slew: a.slew + turn * k, reach: a.reach + (b.reach - a.reach) * k, hook: a.hook + (b.hook - a.hook) * k };
}

export class Crane {
  readonly group = new THREE.Group();
  /** The hook block, placed in the harbor's frame. */
  readonly hook = new THREE.Group();
  private readonly turret = new THREE.Group();
  private readonly boom = new THREE.Group();
  /** After pose(): the boom's tip, the A-frame's top and the winch drum, in the harbor's frame. */
  readonly tip = new THREE.Vector3();
  readonly apex = new THREE.Vector3();
  readonly drum = new THREE.Vector3();

  constructor() {
    this.group.name = "crane";
    this.group.position.copy(CRANE_AT);

    // A squat timber pedestal with iron bands, and the iron slewing ring on top.
    const base = new ModelBuilder();
    base.box([0.66, PEDESTAL, 0.66], P.wood, { at: [0, PEDESTAL / 2, 0], jitter: 0.05 });
    for (const y of [0.07, PEDESTAL - 0.07]) base.box([0.69, 0.05, 0.69], P.iron, { at: [0, y, 0], material: materials.metal });
    base.add(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 12), P.iron, { at: [0, PEDESTAL + 0.02, 0], material: materials.metal });
    this.group.add(base.build("crane-base"));

    // The turntable: a platform, an A-frame with the topping lift's sheave, the winch, and a
    // counterweight at the back.
    const t = new ModelBuilder();
    t.box([0.82, 0.07, 0.72], P.woodLight, { at: [-0.06, 0.075, 0], jitter: 0.05 });
    for (const s of [-1, 1]) {
      const foot = new THREE.Vector3(-0.3, 0.1, s * 0.3);
      const mid = foot.clone().lerp(APEX, 0.5);
      const length = foot.distanceTo(APEX);
      const leg = new THREE.BoxGeometry(0.09, length, 0.09);
      const dir = APEX.clone().sub(foot).normalize();
      leg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
      t.add(leg, TIMBER, { at: [mid.x, mid.y, mid.z], jitter: 0.04 });
      // The heel's iron cheeks, and the winch's side frames.
      t.box([0.16, 0.2, 0.03], P.iron, { at: [HEEL_OUT, HEEL_UP - PEDESTAL - 0.04, s * 0.085], material: materials.metal });
      t.box([0.18, 0.26, 0.04], TIMBER, { at: [DRUM.x, 0.21, s * 0.2] });
      t.box([0.03, 0.12, 0.03], P.iron, { at: [DRUM.x, 0.27, s * 0.245], material: materials.metal });
    }
    t.box([0.07, 0.05, 0.36], TIMBER, { at: [-0.21, 1.0, 0] });
    t.box([0.16, 0.12, 0.16], P.iron, { at: [APEX.x, APEX.y, 0], material: materials.metal });
    t.add(new THREE.CylinderGeometry(0.075, 0.075, 0.36, 10), 0x7a6247, { at: [DRUM.x, DRUM.y, 0], rot: [Math.PI / 2, 0, 0] });
    t.box([0.3, 0.32, 0.56], P.stoneDark, { at: [-0.48, 0.27, 0], jitter: 0.06 });
    t.box([0.32, 0.05, 0.58], P.iron, { at: [-0.48, 0.38, 0], material: materials.metal });
    this.turret.add(t.build("crane-turntable"));
    this.turret.position.y = PEDESTAL;
    this.group.add(this.turret);

    // The boom: a tapering timber with iron bands, a sheave at its tip.
    const m = new ModelBuilder();
    m.box([BOOM * 0.56, 0.12, 0.12], TIMBER, { at: [BOOM * 0.28, 0, 0], jitter: 0.04 });
    m.box([BOOM * 0.46, 0.09, 0.09], TIMBER, { at: [BOOM * 0.77, 0, 0], jitter: 0.04 });
    for (const x of [0.12, BOOM * 0.55, BOOM - 0.1]) m.box([0.05, 0.14, 0.14], P.iron, { at: [x, 0, 0], material: materials.metal });
    m.add(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 10), P.iron, { at: [BOOM, -0.02, 0], rot: [Math.PI / 2, 0, 0], material: materials.metal });
    m.add(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 6), P.iron, { at: [0, 0, 0], rot: [Math.PI / 2, 0, 0], material: materials.metal });
    this.boom.add(m.build("crane-boom"));
    this.boom.position.set(HEEL_OUT, HEEL_UP - PEDESTAL, 0);
    this.turret.add(this.boom);

    // The hook block: an iron block over a hook, hanging from the hoist rope. Its hook is at the group's origin.
    const h = new ModelBuilder();
    h.box([0.1, 0.14, 0.08], P.iron, { at: [0, 0.16, 0], material: materials.metal });
    h.add(new THREE.CylinderGeometry(0.018, 0.018, 0.08, 6), P.iron, { at: [0, 0.06, 0], material: materials.metal });
    h.add(new THREE.TorusGeometry(0.035, 0.012, 4, 8, Math.PI * 1.5), P.brassDark, { at: [0.01, 0.0, 0], rot: [0, 0, Math.PI * 0.75], material: materials.metal });
    this.hook.add(h.build("crane-hook"));
    this.hook.name = "crane-hook";
  }

  /** The height of the boom's tip for a reach: it luffs up to reach in, down to reach out. */
  static tipHeight(reach: number): number {
    const out = Math.min(BOOM * 0.97, Math.max(0.3, reach - HEEL_OUT));
    return CRANE_AT.y + HEEL_UP + Math.sqrt(BOOM * BOOM - out * out);
  }

  /** Set the crane to a pose (the hook's world height must be under the tip). */
  pose(p: CranePose): void {
    const out = Math.min(BOOM * 0.97, Math.max(0.3, p.reach - HEEL_OUT));
    this.turret.rotation.y = p.slew;
    this.boom.rotation.z = Math.acos(out / BOOM);
    this.group.updateMatrixWorld(true);
    this.boom.localToWorld(this.tip.set(BOOM, 0, 0));
    this.tip.y -= 0.08; // the rope leaves the bottom of the sheave
    this.turret.localToWorld(this.apex.copy(APEX));
    this.turret.localToWorld(this.drum.copy(DRUM).setY(DRUM.y + 0.07));
    // The world here is the harbor's frame (the harbor group sits at the origin).
    this.hook.position.set(this.tip.x, Math.min(p.hook, this.tip.y - 0.3), this.tip.z);
    this.hook.rotation.y = p.slew;
  }
}

/** The crane's rope colour (tarred, darker than the stern lines). */
export const CRANE_ROPE = ROPE_DARK;
