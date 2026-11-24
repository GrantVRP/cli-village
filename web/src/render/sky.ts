// The sky: a dome drawn behind everything, with a horizon-to-zenith gradient, a sun with a
// soft glow, slow drifting clouds and, at night, its own shape: a thin glow along the horizon
// under a deep slate-blue sky, stars of different brightness and colour, and a faint Milky Way. All of it is computed in
// the shader (no textures), in linear light, so the tone mapping treats it like the scene.
//
// The same dome, rendered on its own into a small cube map and prefiltered, also becomes the
// scene's environment light: everything picks up the sky's colour as soft ambient light, and
// the brass reflects it. (The river works out its own sky reflection, in water.ts.)

import * as THREE from "three";

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // Push the dome to the far plane, so it's behind everything whatever its size.
    gl_Position = p.xyww;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 zenith;
  uniform vec3 horizon;
  uniform vec3 ground;
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  uniform vec3 sunGlow;
  uniform vec3 cloudColor;
  uniform float cloudCover;
  uniform float stars;
  uniform vec3 skyMid;
  uniform float moon;
  uniform float time;
  varying vec3 vDir;

  // Hash and value noise (no textures), and a few octaves of it for soft cloud shapes.
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    mat2 turn = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 5; i++) {
      sum += amp * noise(p);
      p = turn * p * 2.03 + 17.0;
      amp *= 0.5;
    }
    return sum;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float up = dir.y;

    // The gradient: denser colour near the horizon, a quick fall-off below it.
    float h = clamp(up, 0.0, 1.0);
    vec3 sky = mix(horizon, zenith, pow(h, 0.55));
    if (moon > 0.0) {
      // The night sky (painters' and film's moonlight): a thin, slightly lighter glow along the
      // horizon, so roofs and trees stand out against it, a deep slate-blue middle, and the
      // darkest blue straight up. Never black.
      vec3 night = mix(horizon, skyMid, smoothstep(0.0, 0.16, h));
      night = mix(night, zenith, smoothstep(0.12, 0.9, h));
      sky = mix(sky, night, moon);
    }
    sky = mix(sky, ground, smoothstep(0.0, -0.12, up));

    // The sun: a small bright disc, a tight halo and a wide glow over that part of the sky.
    float toSun = max(dot(dir, sunDir), 0.0);
    float sunUp = smoothstep(-0.08, 0.04, sunDir.y);
    sky += sunGlow * (pow(toSun, 6.0) * 0.35 + pow(toSun, 48.0) * 0.6) * (0.4 + 0.6 * (1.0 - h));
    sky += sunColor * smoothstep(0.9993, 0.99965, toSun) * 22.0 * sunUp;

    // Clouds: flat layer seen in perspective, drifting slowly; lit on the sun's side.
    if (up > 0.0) {
      vec2 uv = dir.xz / (up + 0.18) * 1.6 + vec2(time * 0.006, time * 0.002);
      float n = fbm(uv);
      float cover = smoothstep(1.0 - cloudCover, 1.0 - cloudCover + 0.32, n);
      float lit = 0.75 + 0.35 * pow(toSun, 3.0);
      vec3 cloud = cloudColor * lit;
      // Thin out towards the horizon, so the edge of the layer never shows.
      cover *= smoothstep(0.0, 0.22, up);
      sky = mix(sky, cloud, cover * 0.85);

      // Stars: one per cell of a grid over the sky, twinkling, hidden behind clouds.
      if (stars > 0.0) {
        vec2 cell = floor(dir.xz / (up + 0.35) * 160.0);
        float star = hash12(cell);
        float twinkle = 0.65 + 0.35 * sin(time * (1.5 + star * 3.0) + star * 40.0);
        float bright = smoothstep(0.9965, 1.0, star) * twinkle * stars * (1.0 - cover) * smoothstep(0.05, 0.3, up);
        sky += vec3(0.85, 0.9, 1.0) * bright * 2.5 * (1.0 - moon);
      }
      if (moon > 0.0 && stars > 0.0) {
        // Night stars: round dots placed anywhere in their cell, a few bright ones among many
        // faint ones, pale blue to warm white. Big enough (a couple of pixels) not to shimmer.
        // They reach down towards the horizon, fainter there, as through more air.
        vec2 q = dir.xz / (up + 0.35) * 90.0;
        vec2 c = floor(q);
        float s = hash12(c + 71.0);
        vec2 spot = vec2(hash12(c + 3.1), hash12(c + 9.7)) * 0.5 + 0.25;
        float mag = smoothstep(0.93, 1.0, s);
        float d = length(fract(q) - spot);
        float disc = smoothstep(0.09 + 0.16 * mag, 0.0, d);
        vec3 tint = mix(vec3(1.0, 0.88, 0.74), vec3(0.8, 0.88, 1.0), hash12(c + 5.3));
        float twinkle = 0.75 + 0.25 * sin(time * (1.2 + s * 2.5) + s * 60.0);
        float air = smoothstep(0.0, 0.12, up);
        sky += tint * disc * mag * mag * 14.0 * twinkle * air * stars * moon * (1.0 - cover);

        // The Milky Way: a faint, uneven band of light across the sky, with darker dust in it.
        vec3 axis = normalize(vec3(0.62, 0.42, 0.66));
        float across = dot(dir, axis);
        float band = exp(-across * across * 30.0);
        vec2 mw = dir.xz / (up + 0.6) * 5.0;
        float glow = fbm(mw + fbm(mw * 1.7) * 0.8);
        float dust = smoothstep(0.45, 0.7, fbm(mw * 2.3 + 9.0));
        float milky = band * smoothstep(0.3, 0.75, glow) * (1.0 - dust * 0.6) * smoothstep(0.02, 0.25, up);
        sky += vec3(0.62, 0.66, 0.86) * milky * 0.07 * stars * moon * (1.0 - cover);
      }
    }
    gl_FragColor = vec4(sky, 1.0);
    #include <colorspace_fragment>
  }
`;

export class Sky {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly uniforms = {
    zenith: { value: new THREE.Color() },
    horizon: { value: new THREE.Color() },
    ground: { value: new THREE.Color() },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunColor: { value: new THREE.Color() },
    sunGlow: { value: new THREE.Color() },
    cloudColor: { value: new THREE.Color() },
    cloudCover: { value: 0.4 },
    stars: { value: 0 },
    skyMid: { value: new THREE.Color() },
    moon: { value: 0 },
    time: { value: 0 },
  };

  constructor() {
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material);
    this.mesh.name = "sky";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    // The dome follows the camera, so it's always around it.
    this.mesh.onBeforeRender = (_r, _s, camera) => this.mesh.position.copy(camera.position);
    this.mesh.scale.setScalar(100);
  }
}
