// A cloth flag (or a pennant) that waves in the village's wind (render/wind.ts): faster and
// wider in a storm, gentler on a still day. The town hall flies one, the windmill a pennant.

import * as THREE from "three";
import { windUniforms } from "./render/wind.js";

export interface Flag {
  mesh: THREE.Mesh;
  /** `busy`: flap faster (the town hall's flag while the village is at work). */
  update(dt: number, still: boolean, busy?: boolean): void;
}

/** A flag `width` × `height`, held at its left edge (x = 0). A pennant narrows to a point. */
export function wavingFlag(width: number, height: number, color: number, pennant = false): Flag {
  const geometry = new THREE.PlaneGeometry(width, height, 10, 4);
  geometry.translate(width / 2, 0, 0);
  const pos = geometry.getAttribute("position");
  if (pennant) for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) * (1 - (pos.getX(i) / width) * 0.92));
  const base = (pos.array as Float32Array).slice();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, flatShading: true, side: THREE.DoubleSide, roughness: 0.8 }));
  mesh.castShadow = true;
  // The wave's phase adds up over time, so a change in the wind never makes it jump.
  let phase = 0;
  const waves = 4.5 / width;
  const reach = 0.12 * (1.5 / width) ** 0.5;
  return {
    mesh,
    update(dt, still, busy = false) {
      const wind = windUniforms.strength.value;
      if (!still) phase += dt * (busy ? 6 : 3.5) * (0.6 + 0.4 * wind);
      const swing = reach * (0.5 + 0.5 * wind);
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3]!;
        pos.setZ(i, Math.sin(x * waves - phase) * swing * x);
      }
      pos.needsUpdate = true;
      geometry.computeVertexNormals();
    },
  };
}
