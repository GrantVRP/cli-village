// Helpers for the low-poly look: flat shading, no textures, and a slightly
// different color on every face. Many small parts are merged into a few
// meshes so the scene stays fast.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Repeatable randomness, so the village looks the same every time. */
export function makeRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const random = makeRandom(20261028);
export const pick = <T>(list: readonly T[], rng = random): T => list[Math.floor(rng() * list.length)]!;
export const between = (min: number, max: number, rng = random) => min + (max - min) * rng();

export interface PaintOptions {
  /** How much each face's lightness may vary (0.06 = ±6%). */
  jitter?: number;
  /** Faces made of two triangles (boxes) share one color. */
  quads?: boolean;
  rng?: () => number;
}

/** Give a shape vertex colors: one slightly different shade per face. */
export function paint(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, options: PaintOptions = {}): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute("uv");
  const count = g.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  const base = new THREE.Color(color);
  const shade = new THREE.Color();
  const jitter = options.jitter ?? 0.05;
  const rng = options.rng ?? random;
  const group = options.quads ? 6 : 3;
  for (let i = 0; i < count; i += group) {
    shade.copy(base).offsetHSL((rng() - 0.5) * jitter * 0.15, (rng() - 0.5) * jitter * 0.5, (rng() - 0.5) * 2 * jitter);
    for (let k = 0; k < group && i + k < count; k++) colors.set([shade.r, shade.g, shade.b], (i + k) * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}

export const materials = {
  /** Most things: matte, faceted, colored per face. */
  matte: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, metalness: 0 }),
  /** Brass and iron. */
  metal: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.38, metalness: 0.65 }),
};

type Vec3 = readonly [number, number, number];

export interface PartOptions {
  at?: Vec3;
  rot?: Vec3;
  scale?: Vec3 | number;
  jitter?: number;
  quads?: boolean;
  material?: THREE.Material;
  /** Random numbers for the colour jitter (default: the shared ones). */
  rng?: () => number;
}

const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();

/** Collects parts, then merges them into one mesh per material. */
export class ModelBuilder {
  private readonly parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private readonly frames: THREE.Matrix4[] = [];

  /** Place the next parts relative to a spot (e.g. a wall), until pop(). */
  push(at: Vec3, rotY = 0): this {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...at),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)),
      new THREE.Vector3(1, 1, 1),
    );
    const parent = this.frames.at(-1);
    this.frames.push(parent ? parent.clone().multiply(m) : m);
    return this;
  }

  pop(): this {
    this.frames.pop();
    return this;
  }

  add(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, options: PartOptions = {}): this {
    const quads = options.quads ?? geometry.type === "BoxGeometry";
    const g = paint(geometry, color, { jitter: options.jitter, quads, rng: options.rng });
    const s = options.scale ?? 1;
    tmpMatrix.compose(
      tmpPos.set(...(options.at ?? [0, 0, 0])),
      tmpQuat.setFromEuler(tmpEuler.set(...(options.rot ?? [0, 0, 0]))),
      typeof s === "number" ? tmpScale.setScalar(s) : tmpScale.set(...s),
    );
    g.applyMatrix4(tmpMatrix);
    const frame = this.frames.at(-1);
    if (frame) g.applyMatrix4(frame);
    const material = options.material ?? materials.matte;
    const list = this.parts.get(material) ?? [];
    list.push(g);
    this.parts.set(material, list);
    return this;
  }

  box(size: Vec3, color: THREE.ColorRepresentation, options: PartOptions = {}): this {
    return this.add(new THREE.BoxGeometry(...size), color, options);
  }

  build(name = "model"): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    for (const [material, geometries] of this.parts) {
      const merged = mergeGeometries(geometries.map((g) => (g.index ? g.toNonIndexed() : g)));
      if (!merged) continue;
      merged.computeVertexNormals();
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.parts.clear();
    return group;
  }
}

/** A mesh that glows (windows, lanterns, robot heads). Its glow can be changed later. */
export function glowMesh(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, intensity = 1): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> {
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    flatShading: true,
    roughness: 0.5,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/**
 * Make every mesh in an object cast and receive shadows (except ones marked userData.noShadow,
 * which only receive, and userData.noShadowOnSelf, which only cast).
 */
export function shadows(object: THREE.Object3D, cast = true, receive = true): void {
  object.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      child.castShadow = cast && !child.userData.noShadow;
      child.receiveShadow = receive && !child.userData.noShadowOnSelf;
    }
  });
}
