// Where everything stands, and how robots walk between buildings.
// The plaza is at the center (0, 0, 0). The river runs across the back (−z).

import * as THREE from "three";
import type { Building } from "../../src/events/types.js";

export const PLAZA_R = 6; // cobblestone radius
export const CURB_R = 6.35; // raised edge
export const TRACK_R = 7.6; // ring rail track around the plaza
export const WALK_R = 4.2; // robots cross the plaza along this circle (around the column)
export const RIVER_Z = -23;
export const RIVER_HALF = 3.2;

export interface Spot {
  id: Building;
  /** Center of the building on the ground. */
  pos: THREE.Vector3;
  /** Turn so the front faces the plaza. */
  rotY: number;
  /** Where robots stand when they work here. */
  door: THREE.Vector3;
  /** Where this building's path meets the plaza. */
  edge: THREE.Vector3;
  /** Label height above the ground. */
  labelY: number;
  /** Rough radius, for effects like rising rings. */
  radius: number;
}

function spot(id: Building, x: number, z: number, halfDepth: number, labelY: number, radius: number): Spot {
  const pos = new THREE.Vector3(x, 0, z);
  const toCenter = new THREE.Vector3(-x, 0, -z).normalize();
  const door = pos.clone().addScaledVector(toCenter, halfDepth + 1.4);
  const edge = toCenter.clone().multiplyScalar(-(CURB_R + 0.3));
  return { id, pos, rotY: Math.atan2(toCenter.x, toCenter.z), door, edge, labelY, radius };
}

export const SPOTS: Record<Building, Spot> = {
  townhall: spot("townhall", 0, -14.5, 2.9, 9.6, 4.5),
  library: spot("library", -13.5, -8.5, 2.1, 10.2, 3.2),
  vault: spot("vault", -15, 2.5, 2.1, 4.6, 3.4),
  workshop: spot("workshop", -10.5, 12, 1.9, 7.2, 3.2),
  lab: spot("lab", 10.5, 12, 1.9, 7.2, 3.2),
  home: spot("home", 15, 2.5, 1.9, 7.2, 3.2),
  // The harbor "building" is the checkpoint gate and the dock across the river.
  harbor: spot("harbor", 12.2, -16.8, 0, 4.4, 3.0),
};

// The harbor's rail branch: from the ring track, through the gate, along the dock.
export const HARBOR = {
  gate: new THREE.Vector3(13.6, 0, -18.4),
  dockStart: new THREE.Vector3(13.6, 0, -19.4),
  dockEnd: new THREE.Vector3(13.6, 0, -26.4),
  /** Where the cargo ship moors (the middle of the ship), stern-to the dock between two of its posts. */
  boat: new THREE.Vector3(17.15, 0, -23.7),
  /** The cart's route: ring track → bend → gate → end of the dock. */
  cartRoute: [] as THREE.Vector3[],
};
{
  const bend = new THREE.Vector3(13.6, 0, -14.6);
  const ringPoint = bend.clone().setY(0).normalize().multiplyScalar(TRACK_R);
  HARBOR.cartRoute = [ringPoint, bend, HARBOR.gate.clone(), HARBOR.dockEnd.clone().add(new THREE.Vector3(0, 0, 1.2))];
}

const angleOf = (v: THREE.Vector3) => Math.atan2(v.z, v.x);
const onCircle = (angle: number, r: number) => new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r);

/** Where robot number `slot` (of `count`) stands at a building. */
export function standPoint(building: Building, slot: number, count: number): THREE.Vector3 {
  const s = SPOTS[building];
  const out = s.pos.clone().sub(s.door).setY(0).normalize(); // from door toward the building
  const side = new THREE.Vector3(-out.z, 0, out.x);
  if (building === "home") {
    // Idle robots gather in a little crowd in front of home.
    const row = Math.floor(slot / 4);
    const col = slot % 4;
    return s.door
      .clone()
      .addScaledVector(side, (col - 1.5) * 0.85)
      .addScaledVector(out, -row * 0.9);
  }
  return s.door.clone().addScaledVector(side, (slot - (count - 1) / 2) * 0.8);
}

/**
 * A walking route: out along the current path to the plaza, around the
 * column, then up the path to the new building.
 */
export function route(from: THREE.Vector3, fromBuilding: Building | null, to: Building, dest: THREE.Vector3): THREE.Vector3[] {
  const points: THREE.Vector3[] = [from.clone()];
  const exit = fromBuilding ? SPOTS[fromBuilding].edge.clone() : null;
  const entry = SPOTS[to].edge.clone();
  if (exit) points.push(exit);

  const startAngle = angleOf(exit ?? from);
  let endAngle = angleOf(entry);
  let delta = endAngle - startAngle;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  endAngle = startAngle + delta;
  // Cross the plaza on the walking circle, taking the shorter way round.
  const steps = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 10)));
  for (let i = 0; i <= steps; i++) points.push(onCircle(startAngle + (delta * i) / steps, WALK_R));

  points.push(entry, dest.clone());
  return points;
}

/**
 * How far (x, z) is from the nearest path: the walks from the plaza to each door, and the
 * cart's rails out to the harbor. Things that grow or stand about (flower beds, villagers'
 * spots) keep clear of them by this.
 */
export function distanceToPaths(x: number, z: number): number {
  const segment = (ax: number, az: number, bx: number, bz: number) => {
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
  };
  let best = Infinity;
  for (const s of Object.values(SPOTS)) best = Math.min(best, segment(s.edge.x, s.edge.z, s.door.x, s.door.z));
  const route = HARBOR.cartRoute;
  for (let i = 0; i < route.length - 1; i++) best = Math.min(best, segment(route[i]!.x, route[i]!.z, route[i + 1]!.x, route[i + 1]!.z));
  return best;
}

/** The directions (radians, atan2(z, x)) in which paths leave the plaza, sorted. */
export function pathAngles(): number[] {
  const angles = Object.values(SPOTS).map((s) => Math.atan2(s.door.z, s.door.x));
  const route = HARBOR.cartRoute;
  if (route.length > 1) angles.push(Math.atan2(route[1]!.z, route[1]!.x));
  return angles.sort((a, b) => a - b);
}

/** Props and spots that aren't buildings or paths: x, z and how much room they take. */
export const PROP_SPOTS: readonly (readonly [number, number, number])[] = [
  [0, 10.6, 1.7], // well
  [3.2, -9.6, 1.4], // notice board
  [-13.1, 14.2, 1.3], // barrels by the workshop
  [10.9, -17.5, 1.1], // barrels by the harbor
  [11.2, -15.5, 1.1], // crates at the harbor
];

/** How much room (x, z) has before it reaches a prop (negative: inside one). */
export function roomFromProps(x: number, z: number): number {
  let best = Infinity;
  for (const [px, pz, r] of PROP_SPOTS) best = Math.min(best, Math.hypot(x - px, z - pz) - r);
  return best;
}
