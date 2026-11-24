// The river's surface, drawn by the graphics card.
//
// It's three.js's standard (physically based) material, so the sun, the shadows and the
// lamps light it like everything else, with four additions:
//   - Waves: a few sine waves moving with the current, added up in the vertex shader. Their
//     slopes are exact derivatives (not finite differences), so the lighting follows them.
//   - Ripples: two layers of noise scrolling at different speeds tilt the surface per pixel,
//     which breaks the sun's reflection into glints.
//   - Sky reflection: Schlick's fresnel term mixes in the sky colour, more at grazing angles,
//     the way water looks darker straight down and brighter towards the horizon.
//   - Shallows and foam: the river gets lighter towards the banks, and a broken line of foam
//     drifts along each bank, from the distance to the bank (no textures, no depth reads).

import * as THREE from "three";

export interface Water {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  uniforms: {
    time: THREE.IUniform<number>;
    skyHorizon: THREE.IUniform<THREE.Color>;
    skyZenith: THREE.IUniform<THREE.Color>;
    /** How strongly the sky is reflected: lower at night, so the river doesn't glow. */
    skyReflect: THREE.IUniform<number>;
    /** How bright the sun's or moon's glints are, 0–1: softer for the moon, so they glitter, not glare. */
    glint: THREE.IUniform<number>;
  };
}

const noise = /* glsl */ `
  float wHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  // Value noise with its gradient (xy) and value (z), for ripples that tilt the normal.
  vec3 wNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    vec2 du = 6.0 * f * (1.0 - f);
    float a = wHash(i);
    float b = wHash(i + vec2(1.0, 0.0));
    float c = wHash(i + vec2(0.0, 1.0));
    float d = wHash(i + vec2(1.0, 1.0));
    float v = a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
    vec2 g = du * vec2(b - a + (a - b - c + d) * u.y, c - a + (a - b - c + d) * u.x);
    return vec3(g, v);
  }
`;

/** Waves: direction (x, z), wavelength, amplitude, speed. They all run roughly downstream (+x). */
const WAVES = [
  [1.0, 0.18, 7.0, 0.035, 1.1],
  [0.92, -0.38, 3.6, 0.022, 1.5],
  [0.7, 0.71, 2.1, 0.012, 1.9],
] as const;

const waveCode = /* glsl */ `
  uniform float time;
  // Height of the surface and its slope (dh/dx, dh/dz) at p (river coordinates).
  vec3 riverWaves(vec2 p) {
    vec3 sum = vec3(0.0);
    ${WAVES.map(([dx, dz, length, amplitude, speed]) => {
      const len = Math.hypot(dx, dz);
      const k = (2 * Math.PI) / length;
      const f = (n: number) => n.toFixed(5);
      return `{
      vec2 d = vec2(${f(dx / len)}, ${f(dz / len)});
      float phase = dot(d, p) * ${f(k)} - time * ${f(speed)};
      sum.x += ${f(amplitude)} * sin(phase);
      sum.yz += ${f(amplitude * k)} * cos(phase) * d;
    }`;
    }).join("\n    ")}
    return sum;
  }
`;

export function createWater(width: number, depth: number, color: THREE.ColorRepresentation): Water {
  const geometry = new THREE.PlaneGeometry(width, depth, 220, 10).rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.14, metalness: 0 });
  // The sky reflection is computed here, so the scene's environment map doesn't add a second one.
  material.envMapIntensity = 0;
  material.name = "river";
  const uniforms: Water["uniforms"] = {
    time: { value: 0 },
    skyHorizon: { value: new THREE.Color(0xdbe6e6) },
    skyZenith: { value: new THREE.Color(0x5f93c6) },
    skyReflect: { value: 1 },
    glint: { value: 1 },
  };
  const halfDepth = (depth / 2).toFixed(3);

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        ${waveCode}
        varying vec3 vRiver;
        varying vec2 vSlope;`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        `vec3 waves = riverWaves(position.xz);
        vec3 objectNormal = normalize(vec3(-waves.y, 1.0, -waves.z));
        vSlope = waves.yz;
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`,
      )
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = vec3(position);
        transformed.y += waves.x;
        vRiver = vec3(position.x, waves.x, position.z);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float time;
        uniform vec3 skyHorizon;
        uniform vec3 skyZenith;
        uniform float skyReflect;
        uniform float glint;
        varying vec3 vRiver;
        varying vec2 vSlope;
        ${noise}
        // 0 in the middle of the river, 1 at the banks.
        float toBank() { return clamp(abs(vRiver.z) / ${halfDepth}, 0.0, 1.0); }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float bank = toBank();
        // Deeper colour in the middle, lighter and a little greener over the shallows.
        vec3 deep = diffuseColor.rgb * vec3(0.78, 0.86, 0.95);
        vec3 shallow = diffuseColor.rgb * vec3(1.18, 1.22, 1.08);
        diffuseColor.rgb = mix(deep, shallow, smoothstep(0.35, 0.95, bank));
        // Foam: a line along each bank, broken up by noise that drifts with the current.
        float drift = wNoise(vRiver.xz * vec2(0.9, 2.4) - vec2(time * 0.55, 0.0)).z;
        float fine = wNoise(vRiver.xz * vec2(3.1, 5.0) - vec2(time * 0.9, time * 0.1)).z;
        float foamLine = smoothstep(0.78 + drift * 0.12, 0.95, bank);
        float foam = foamLine * smoothstep(0.35, 0.7, fine * 0.6 + drift * 0.6);
        // A few flecks out in the stream, on the crests.
        foam = max(foam, smoothstep(0.82, 0.95, fine) * smoothstep(0.02, 0.05, vRiver.y) * 0.6);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 0.94), foam);`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.9, foam);`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        {
          // Ripples: two noise layers moving at different speeds and angles, plus the waves' slope.
          vec2 a = wNoise(vRiver.xz * vec2(1.6, 2.6) + vec2(-time * 0.7, time * 0.12)).xy;
          vec2 b = wNoise(vRiver.xz * vec2(3.4, 4.2) + vec2(-time * 1.15, -time * 0.2)).xy;
          vec2 slope = vSlope + (a * 0.05 + b * 0.035) * (1.0 - foam);
          vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
          normal = normalize((viewMatrix * vec4(n, 0.0)).xyz);
        }`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        {
          // Sky reflection with Schlick's fresnel (water reflects about 2% straight down).
          vec3 v = normalize(vViewPosition);
          float facing = clamp(dot(normal, v), 0.0, 1.0);
          float fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);
          vec3 r = reflect(-v, normal);
          vec3 rWorld = (vec4(r, 0.0) * viewMatrix).xyz;
          vec3 sky = mix(skyHorizon, skyZenith, pow(clamp(rWorld.y, 0.0, 1.0), 0.35));
          totalEmissiveRadiance += sky * (fresnel * 0.9 + 0.06) * skyReflect * (1.0 - foam);
        }`,
      )
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
        reflectedLight.directSpecular *= glint;`,
      );
  };
  // Every water material compiles to the same program.
  material.customProgramCacheKey = () => "cli-village-river";

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "river";
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return { mesh, uniforms };
}
