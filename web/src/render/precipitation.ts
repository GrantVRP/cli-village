// Things falling from the sky: rain, snow, and leaves in autumn.
//
// Each is made once, at start-up, with room for the most it will ever show, and moved
// entirely in the vertex shader from the time and a few random numbers per drop: nothing
// is updated per drop on the processor. How heavy it is decides how many drops draw (the
// others are moved off screen). Two layers each: one over the whole village, and one close
// to the camera, whose drops look bigger and are softly out of focus, like rain past a lens.
// With reduced motion nothing falls (the wet ground and the snow still show the weather).

import * as THREE from "three";

/** How many drops each layer has room for, per graphics setting. */
export const DROPS = {
  low: { rain: 2200, snow: 1400, leaves: 160 },
  medium: { rain: 5000, snow: 3000, leaves: 320 },
  high: { rain: 9000, snow: 5000, leaves: 480 },
} as const;
type Tier = keyof typeof DROPS;

const MAX = DROPS.high;

const LEAF_COLORS = [0xd9a13a, 0xd2692a, 0xb23f2a] as const;

/** The area over the village where things fall: centre, size across (x, z) and height. */
const FAR = { center: new THREE.Vector3(0, 0, -4), size: new THREE.Vector2(92, 80), height: 24 };
/** Close to the camera. */
const NEAR = { size: new THREE.Vector2(26, 26), height: 16 };

const shared = {
  time: { value: 0 },
  /** Wind push on falling things (x, z), units per second. */
  wind: { value: new THREE.Vector2(1.6, 0.7) },
  /** Pixels per unit at distance 1 (from the drawing size and the lens). */
  pixelsPerUnit: { value: 800 },
};

const rainVertex = /* glsl */ `
  attribute vec4 seed;
  attribute float tip;
  uniform float time;
  uniform float amount;
  uniform vec2 wind;
  uniform vec3 center;
  uniform vec2 size;
  uniform float height;
  uniform float len;
  varying float vAlpha;
  void main() {
    if (seed.w >= amount) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; return; }
    float speed = 15.0 + fract(seed.w * 91.7) * 6.0;
    float y = mod(seed.z * height - time * speed, height);
    vec3 dir = normalize(vec3(wind.x, -speed, wind.y));
    vec3 p = vec3(center.x + (seed.x - 0.5) * size.x, center.y + y, center.z + (seed.y - 0.5) * size.y);
    p -= dir * len * tip;
    vAlpha = (1.0 - tip * 0.85) * smoothstep(0.0, 1.0, y) * (1.0 - smoothstep(height - 2.0, height, y));
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;
const rainFragment = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(color, opacity * vAlpha);
  }
`;

const flakeVertex = /* glsl */ `
  attribute vec4 seed;
  uniform float time;
  uniform float amount;
  uniform vec2 wind;
  uniform vec3 center;
  uniform vec2 size;
  uniform float height;
  uniform float speed;
  uniform float sway;
  uniform float flake;
  uniform float pixelsPerUnit;
  varying float vAlpha;
  varying float vSeed;
  void main() {
    if (seed.w >= amount) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; return; }
    float fall = speed * (0.75 + fract(seed.w * 57.3) * 0.5);
    float y = mod(seed.z * height - time * fall, height);
    float drift = time * 0.7 + seed.x * 40.0;
    vec3 p = vec3(center.x + (seed.x - 0.5) * size.x, center.y + y, center.z + (seed.y - 0.5) * size.y);
    // Blown along by the wind (wrapping round the area), and swaying as it falls.
    p.xz += wind * 0.35 * (height - y) / fall;
    p.x += sin(drift) * sway;
    p.z += cos(drift * 0.8) * sway * 0.6;
    p.xz = center.xz + mod(p.xz - center.xz + size * 0.5, size) - size * 0.5;
    vec4 view = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = clamp(flake * (0.7 + fract(seed.w * 13.1) * 0.6) * pixelsPerUnit / max(0.1, -view.z), 1.0, 9.0);
    // Faded right in front of the lens, where a flake would be a big blur.
    vAlpha = smoothstep(0.0, 0.6, y) * (1.0 - smoothstep(height - 2.0, height, y)) * smoothstep(4.0, 8.0, -view.z);
    vSeed = fract(seed.w * 7.31);
  }
`;
const flakeFragment = /* glsl */ `
  uniform vec3 color;
  uniform vec3 color2;
  uniform vec3 color3;
  uniform float opacity;
  uniform float roundness;
  varying float vAlpha;
  varying float vSeed;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    // Snowflakes are soft dots; leaves are little diamonds.
    float d = mix(abs(c.x) + abs(c.y), length(c) * 1.414, roundness);
    float a = 1.0 - smoothstep(0.45, 0.7, d);
    if (a <= 0.0) discard;
    vec3 tint = vSeed < 0.4 ? color : vSeed < 0.75 ? color2 : color3;
    gl_FragColor = vec4(tint, opacity * vAlpha * a);
  }
`;

function seeds(count: number, perDrop: number, seed: number): Float32Array {
  // Repeatable random numbers, so the weather looks the same each time.
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = new Float32Array(count * perDrop * 4);
  for (let i = 0; i < count; i++) {
    const v = [next(), next(), next(), next()];
    for (let k = 0; k < perDrop; k++) out.set(v, (i * perDrop + k) * 4);
  }
  return out;
}

interface Layer {
  object: THREE.LineSegments | THREE.Points;
  material: THREE.ShaderMaterial;
  near: boolean;
}

function rainLayer(count: number, near: boolean, seed: number): Layer {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(count * 2 * 3), 3));
  geometry.setAttribute("seed", new THREE.Float32BufferAttribute(seeds(count, 2, seed), 4));
  const tips = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) tips[i * 2 + 1] = 1;
  geometry.setAttribute("tip", new THREE.Float32BufferAttribute(tips, 1));
  const area = near ? NEAR : FAR;
  const material = new THREE.ShaderMaterial({
    vertexShader: rainVertex,
    fragmentShader: rainFragment,
    uniforms: {
      time: shared.time,
      wind: shared.wind,
      amount: { value: 0 },
      center: { value: near ? new THREE.Vector3() : FAR.center.clone() },
      size: { value: area.size.clone() },
      height: { value: area.height },
      len: { value: near ? 0.9 : 1.2 },
      color: { value: new THREE.Color(0xc8d2dc) },
      opacity: { value: near ? 0.28 : 0.36 },
    },
    transparent: true,
    depthWrite: false,
  });
  const object = new THREE.LineSegments(geometry, material);
  return finish({ object, material, near });
}

function flakeLayer(count: number, near: boolean, seed: number, leaves: boolean): Layer {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute("seed", new THREE.Float32BufferAttribute(seeds(count, 1, seed), 4));
  const area = near ? NEAR : FAR;
  const material = new THREE.ShaderMaterial({
    vertexShader: flakeVertex,
    fragmentShader: flakeFragment,
    uniforms: {
      time: shared.time,
      wind: shared.wind,
      pixelsPerUnit: shared.pixelsPerUnit,
      amount: { value: 0 },
      center: { value: near ? new THREE.Vector3() : FAR.center.clone() },
      size: { value: area.size.clone() },
      height: { value: leaves ? 9 : area.height },
      speed: { value: leaves ? 0.9 : 1.5 },
      sway: { value: leaves ? 1.1 : 0.45 },
      flake: { value: leaves ? 0.22 : near ? 0.08 : 0.13 },
      roundness: { value: leaves ? 0 : 1 },
      color: { value: new THREE.Color(leaves ? 0xd9a13a : 0xf4f7fb) },
      color2: { value: new THREE.Color(leaves ? 0xd2692a : 0xf4f7fb) },
      color3: { value: new THREE.Color(leaves ? 0xb23f2a : 0xe6edf6) },
      opacity: { value: leaves ? 0.95 : 0.85 },
    },
    transparent: true,
    depthWrite: false,
  });
  const object = new THREE.Points(geometry, material);
  return finish({ object, material, near });
}

function finish(layer: Layer): Layer {
  const { object } = layer;
  object.frustumCulled = false;
  object.castShadow = false;
  object.receiveShadow = false;
  // Drawn after the solid things and the small nature (which doesn't write depth).
  object.renderOrder = 20;
  return layer;
}

/** Rain, snow and falling leaves, ready to be added to the scene. */
export class Precipitation {
  readonly group = new THREE.Group();
  private readonly rain: Layer[];
  private readonly snow: Layer[];
  private readonly leaves: Layer;
  private tier: Tier = "high";

  constructor() {
    this.group.name = "precipitation";
    this.rain = [rainLayer(MAX.rain, false, 11), rainLayer(Math.round(MAX.rain / 6), true, 12)];
    this.snow = [flakeLayer(MAX.snow, false, 21, false), flakeLayer(Math.round(MAX.snow / 5), true, 22, false)];
    this.leaves = flakeLayer(MAX.leaves, false, 31, true);
    for (const layer of [...this.rain, ...this.snow, this.leaves]) this.group.add(layer.object);
  }

  /** Fewer drops on slower graphics settings. */
  setTier(tier: Tier): void {
    if (tier === this.tier) return;
    this.tier = tier;
    const counts = DROPS[tier];
    const set = (layer: Layer, count: number) => layer.object.geometry.setDrawRange(0, (layer.near ? Math.round(count / (layer.object instanceof THREE.Points ? 5 : 6)) : count) * (layer.object instanceof THREE.LineSegments ? 2 : 1));
    for (const layer of this.rain) set(layer, counts.rain);
    for (const layer of this.snow) set(layer, counts.snow);
    set(this.leaves, counts.leaves);
  }

  /**
   * Set how much is falling (each 0–1), the light it's seen in, and the time. `camera` places
   * the near layers just in front of the lens. `drawHeight` is the drawing's height in pixels.
   */
  update(rain: number, snow: number, leaves: number, light: THREE.Color, camera: THREE.PerspectiveCamera, drawHeight: number, t: number): void {
    shared.time.value = t;
    shared.pixelsPerUnit.value = (drawHeight * 0.5) / Math.tan((camera.fov * Math.PI) / 360);
    const ahead = new THREE.Vector3();
    camera.getWorldDirection(ahead);
    const nearCenter = camera.position.clone().addScaledVector(ahead, 11).add(new THREE.Vector3(0, -NEAR.height / 2, 0));
    const show = (layer: Layer, amount: number) => {
      layer.material.uniforms.amount!.value = amount;
      layer.object.visible = amount > 0.001;
      if (layer.near) layer.material.uniforms.center!.value.copy(nearCenter);
    };
    for (const layer of this.rain) {
      show(layer, rain);
      (layer.material.uniforms.color!.value as THREE.Color).copy(light);
    }
    for (const layer of this.snow) {
      show(layer, snow);
      (layer.material.uniforms.color!.value as THREE.Color).copy(light).multiplyScalar(1.15);
      (layer.material.uniforms.color2!.value as THREE.Color).copy(light).multiplyScalar(1.15);
      (layer.material.uniforms.color3!.value as THREE.Color).copy(light).multiplyScalar(1.0);
    }
    show(this.leaves, leaves);
    // Leaves keep their colours, in the light there is.
    const level = Math.min(1, (light.r * 0.2126 + light.g * 0.7152 + light.b * 0.0722) * 1.6);
    LEAF_COLORS.forEach((hex, i) => (this.leaves.material.uniforms[i === 0 ? "color" : `color${i + 1}`]!.value as THREE.Color).set(hex).multiplyScalar(level));
  }
}
