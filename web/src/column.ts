// The centerpiece: a glass column with a brass spiral coil. The glow inside
// shows the village's health: green → yellow → orange → red.

import * as THREE from "three";
import { glowMesh, materials, ModelBuilder } from "./lowpoly.js";
import { P } from "./palette.js";

const STOPS = [
  { at: 0, color: new THREE.Color(P.health[3]) },
  { at: 0.33, color: new THREE.Color(P.health[2]) },
  { at: 0.66, color: new THREE.Color(P.health[1]) },
  { at: 1, color: new THREE.Color(P.health[0]) },
];

/** The column's color for a health from 0 (bad) to 1 (good). */
export function healthColor(health: number, out = new THREE.Color()): THREE.Color {
  const h = Math.max(0, Math.min(1, health));
  for (let i = 1; i < STOPS.length; i++) {
    const a = STOPS[i - 1]!;
    const b = STOPS[i]!;
    if (h <= b.at) return out.copy(a.color).lerp(b.color, (h - a.at) / (b.at - a.at));
  }
  return out.copy(STOPS[STOPS.length - 1]!.color);
}

export class Column {
  readonly group = new THREE.Group();
  private readonly fill: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly light: THREE.PointLight;
  private target = 1;
  private shown = 1;
  private readonly height = 3.3;
  private readonly base = 0.75;

  constructor() {
    this.group.name = "column";
    const b = new ModelBuilder();
    const metal = materials.metal;
    b.add(new THREE.CylinderGeometry(1.45, 1.6, 0.35, 10), P.stone, { at: [0, 0.2, 0], jitter: 0.06 });
    b.add(new THREE.CylinderGeometry(1.0, 1.15, 0.3, 12), P.brassDark, { at: [0, 0.52, 0], material: metal });
    b.add(new THREE.CylinderGeometry(0.75, 0.85, 0.12, 12), P.brass, { at: [0, 0.71, 0], material: metal });
    // Top cap with a little finial.
    const top = this.base + this.height;
    b.add(new THREE.CylinderGeometry(0.82, 0.7, 0.22, 12), P.brass, { at: [0, top + 0.08, 0], material: metal });
    b.add(new THREE.ConeGeometry(0.5, 0.55, 12), P.brassDark, { at: [0, top + 0.46, 0], material: metal });
    b.add(new THREE.SphereGeometry(0.13, 8, 6), P.brass, { at: [0, top + 0.82, 0], material: metal });
    // Brass spiral coil around the glass.
    const turns = 5.5;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= 220; i++) {
      const k = i / 220;
      const a = k * turns * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(a) * 0.66, this.base + 0.05 + k * (this.height - 0.1), Math.sin(a) * 0.66));
    }
    b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 260, 0.05, 5), P.brass, { material: metal, jitter: 0.03 });
    // Four upright brass rods.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      b.add(new THREE.CylinderGeometry(0.035, 0.035, this.height, 5), P.brassDark, {
        at: [Math.cos(a) * 0.72, this.base + this.height / 2, Math.sin(a) * 0.72],
        material: metal,
      });
    }
    this.group.add(b.build("column-brass"));

    // Glass.
    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.58, 0.58, this.height, 16, 1, true),
      // (Reflects only a little sky, so the glow inside reads clearly.)
      new THREE.MeshStandardMaterial({ color: 0xd8f6f4, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 0.3 }),
    );
    glass.position.y = this.base + this.height / 2;
    this.group.add(glass);

    // The glowing fill.
    const fillGeo = new THREE.CylinderGeometry(0.46, 0.46, 1, 14);
    fillGeo.translate(0, 0.5, 0);
    this.fill = glowMesh(fillGeo, P.health[0], 1.6);
    this.fill.material.transparent = true;
    this.fill.material.opacity = 0.9;
    this.fill.position.y = this.base;
    this.group.add(this.fill);

    this.light = new THREE.PointLight(P.health[0], 6, 11, 1.6);
    this.light.position.y = this.base + 2;
    this.group.add(this.light);
  }

  setHealth(health: number): void {
    this.target = Math.max(0, Math.min(1, health));
  }

  update(dt: number, t: number): void {
    this.shown += (this.target - this.shown) * Math.min(1, dt * 1.5);
    const level = 0.18 + this.shown * 0.82;
    this.fill.scale.y = this.height * level * (1 + Math.sin(t * 2.4) * 0.015);
    const color = healthColor(this.shown);
    // A dark surface and a bright glow, so sunlight doesn't wash the colour out.
    this.fill.material.color.copy(color).multiplyScalar(0.3);
    this.fill.material.emissive.copy(color);
    this.fill.material.emissiveIntensity = 2.2 + Math.sin(t * 2) * 0.25 + (1 - this.shown) * Math.max(0, Math.sin(t * 6)) * 0.8;
    this.light.color.copy(color);
    this.light.intensity = 5 + Math.sin(t * 2) * 0.6;
  }
}
