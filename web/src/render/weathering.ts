// Weather and seasons on the village's surfaces, done in the shaders of the materials it
// already has (so nothing is rebuilt and no extra draw calls are made):
//   - cloud shadows: soft patches of shade drifting over the land on part-cloudy days;
//   - rain: wet things go darker and glossier, and puddles form on flat ground;
//   - snow: white on the faces that look up (roofs, fields, the tops of trees and rocks),
//     with ragged edges, and trodden off the plaza and the paths;
//   - seasons: autumn turns the trees gold, orange and red and the grass golden; spring
//     brings fresher greens and blossom; in winter the grass is straw coming out of the snow.
//
// Every effect is zero in a clear summer, and then the shaders work out exactly the colours
// they did before. The world position each effect uses is taken before the wind moves the
// leaves, so the patterns stay put on a swaying tree.

import * as THREE from "three";

/** Shared by every weathered material: set them once a frame. */
export const weatherUniforms = {
  cvTime: { value: 0 },
  /** Cloud cover over the sun (0–1): the more, the more of the land is in cloud shadow. */
  cvCloud: { value: 0 },
  /** How dark a cloud shadow is (less at night: the moon's light is weak anyway). */
  cvCloudShade: { value: 0.75 },
  cvWet: { value: 0 },
  cvSnow: { value: 0 },
  cvSpring: { value: 0 },
  cvAutumn: { value: 0 },
  cvWinter: { value: 0 },
  /** The paths, as segments (x1, z1, x2, z2), and the plaza's radius: snow is trodden off them. */
  cvPaths: { value: Array.from({ length: 10 }, () => new THREE.Vector4()) },
  cvPlaza: { value: 8.4 },
  cvSnowColor: { value: new THREE.Color(0xeef2f7) },
  cvGold: { value: new THREE.Color(0xd9a13a) },
  cvOrange: { value: new THREE.Color(0xd2692a) },
  cvRed: { value: new THREE.Color(0xb23f2a) },
  cvBlossom: { value: new THREE.Color(0xeea3bb) },
  cvStraw: { value: new THREE.Color(0xb9a874) },
};

/** Set the paths snow is trodden off: segments on the ground (only x and z are used). */
export function setPaths(segments: readonly (readonly [THREE.Vector3, THREE.Vector3])[], plaza: number): void {
  const slots = weatherUniforms.cvPaths.value;
  slots.forEach((slot, i) => {
    const s = segments[i];
    // Unused slots: a zero-length segment far away.
    if (s) slot.set(s[0].x, s[0].z, s[1].x, s[1].z);
    else slot.set(1e4, 1e4, 1e4, 1e4);
  });
  weatherUniforms.cvPlaza.value = plaza;
}

const commonCode = /* glsl */ `
  varying vec3 vCvWorld;
  uniform float cvTime;
  uniform float cvCloud;
  uniform float cvCloudShade;
  uniform float cvWet;
  uniform float cvSnow;
  uniform float cvSpring;
  uniform float cvAutumn;
  uniform float cvWinter;
  uniform vec4 cvPaths[10];
  uniform float cvPlaza;
  uniform vec3 cvSnowColor;
  uniform vec3 cvGold;
  uniform vec3 cvOrange;
  uniform vec3 cvRed;
  uniform vec3 cvBlossom;
  uniform vec3 cvStraw;

  float cvHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float cvNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = cvHash(i);
    float b = cvHash(i + vec2(1.0, 0.0));
    float c = cvHash(i + vec2(0.0, 1.0));
    float d = cvHash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float cvLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  /** A colour with another's brightness, so a tint keeps each face's shade. */
  vec3 cvTint(vec3 base, vec3 hue) { return hue * (cvLuma(base) / max(cvLuma(hue), 1e-3)); }
  /** 0 on the plaza and the paths, 1 well away from them. */
  float cvTrodden(vec2 p) {
    float d = length(p) - cvPlaza;
    for (int i = 0; i < 10; i++) {
      vec2 a = cvPaths[i].xy;
      vec2 ab = cvPaths[i].zw - a;
      float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
      d = min(d, length(p - a - ab * t) - 1.0);
    }
    return smoothstep(0.0, 0.35, d);
  }
`;

const surfaceCode = (kind: Kind) => /* glsl */ `
  {
    vec3 cvN = inverseTransformDirection(normal, viewMatrix);
    float cvUp = cvN.y;
    vec2 cvP = vCvWorld.xz;
    float cvGreen = smoothstep(0.015, 0.07, diffuseColor.g - max(diffuseColor.r, diffuseColor.b));
    #if ${kind === "foliage" ? 1 : 0}
      cvGreen = 1.0;
    #endif

    // Seasons, on green things: leaves, bushes, the meadows.
    if (cvSpring > 0.0) {
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.06, 1.14, 0.88), cvSpring * cvGreen);
      #if ${kind === "foliage" ? 1 : 0}
        // Blossom: some trees (a slow pattern across the land) dotted pink and white.
        float cvTree = smoothstep(0.5, 0.6, cvNoise(cvP * 0.16 + 11.0));
        float cvDots = step(0.5, cvNoise(vCvWorld.xz * 3.4 + vCvWorld.y * 2.9));
        vec3 cvPetal = mix(cvBlossom, cvBlossom * vec3(1.05, 1.12, 1.08), cvNoise(cvP * 5.3));
        diffuseColor.rgb = mix(diffuseColor.rgb, cvPetal, cvSpring * cvTree * cvDots * smoothstep(-0.3, 0.3, cvUp));
      #endif
    }
    if (cvAutumn > 0.0) {
      #if ${kind === "foliage" ? 1 : 0}
        // Stands of trees turn together: gold, orange or red, picked by a slow pattern.
        float cvPick = cvNoise(cvP * 0.11 + 7.0);
        vec3 cvLeaf = mix(cvGold, cvOrange, smoothstep(0.32, 0.48, cvPick));
        cvLeaf = mix(cvLeaf, cvRed, smoothstep(0.62, 0.76, cvPick));
        float cvTurn = smoothstep(0.18, 0.34, cvNoise(cvP * 0.23 + 3.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, cvTint(diffuseColor.rgb, cvLeaf) * 1.22, cvAutumn * cvTurn);
      #elif ${kind === "grass" ? 1 : 0}
        diffuseColor.rgb = mix(diffuseColor.rgb, cvTint(diffuseColor.rgb, cvGold) * 1.1, cvAutumn * 0.5);
      #else
        diffuseColor.rgb = mix(diffuseColor.rgb, cvTint(diffuseColor.rgb, mix(diffuseColor.rgb, cvGold, 0.5)), cvAutumn * cvGreen * 0.35);
      #endif
    }
    if (cvWinter > 0.0) {
      #if ${kind === "grass" ? 1 : 0}
        diffuseColor.rgb = mix(diffuseColor.rgb, cvTint(diffuseColor.rgb, cvStraw) * 1.25, cvWinter * 0.75);
      #else
        #if ${kind === "foliage" ? 1 : 0}
          // Evergreen: darker, duller greens.
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(cvLuma(diffuseColor.rgb)) * vec3(0.78, 1.0, 0.86), cvWinter * 0.45);
        #else
          // Grass in winter: dull straw where it shows.
          diffuseColor.rgb = mix(diffuseColor.rgb, cvTint(diffuseColor.rgb, cvStraw) * 0.9, cvWinter * cvGreen * 0.7);
        #endif
      #endif
    }

    // Snow on everything that looks up, with ragged edges; trodden off the plaza and paths.
    if (cvSnow > 0.0) {
      float cvLow = 1.0 - smoothstep(0.35, 0.9, vCvWorld.y);
      float cvClear = mix(1.0, cvTrodden(cvP), cvLow);
      #if ${kind === "grass" ? 1 : 0}
        // Blades come up out of the snow: white near the ground only.
        float cvCover = cvSnow * cvClear * (1.0 - smoothstep(0.04, 0.04 + 0.2 * cvSnow, vCvWorld.y));
      #else
        float cvRag = cvNoise(cvP * 1.3 + vCvWorld.y) - 0.5;
        float cvCover = cvSnow * cvClear * smoothstep(0.42, 0.7, cvUp + cvRag * 0.35 - (1.0 - cvSnow) * 0.35);
      #endif
      diffuseColor.rgb = mix(diffuseColor.rgb, cvSnowColor, cvCover);
      roughnessFactor = mix(roughnessFactor, 0.8, cvCover);
      metalnessFactor = mix(metalnessFactor, 0.0, cvCover);
    }

    // Rain: wet things are darker and glossier, and puddles gather on flat ground.
    if (cvWet > 0.0) {
      float cvFlat = smoothstep(0.35, 0.9, cvUp);
      float cvDamp = cvWet * (0.4 + 0.6 * cvFlat);
      diffuseColor.rgb *= 1.0 - 0.3 * cvDamp;
      roughnessFactor = mix(roughnessFactor, 0.38, cvDamp * 0.7);
      #if ${kind === "default" ? 1 : 0}
        float cvPuddle = cvWet * smoothstep(0.92, 0.99, cvUp) * (1.0 - smoothstep(0.1, 0.4, vCvWorld.y)) * smoothstep(0.56, 0.7, cvNoise(cvP * 0.42 + 5.0));
        diffuseColor.rgb *= 1.0 - 0.35 * cvPuddle;
        roughnessFactor = mix(roughnessFactor, 0.12, cvPuddle);
      #endif
    }
  }
`;

const cloudCode = /* glsl */ `
  if (cvCloud > 0.0) {
    // Cloud shadows: a few octaves of noise drifting with the wind.
    vec2 cvC = vCvWorld.xz * 0.065 + vec2(cvTime * 0.06, cvTime * 0.025);
    float cvN = cvNoise(cvC) * 0.55 + cvNoise(cvC * 2.1 + 3.7) * 0.3 + cvNoise(cvC * 4.3 + 9.1) * 0.15;
    // Half cloud puts about half the land in shade; a few clouds, a few patches.
    float cvEdge = 0.5 + (0.5 - cvCloud) * 0.6;
    float cvShadow = smoothstep(cvEdge - 0.04, cvEdge + 0.04, cvN);
    float cvSun = 1.0 - cvCloudShade * cvShadow;
    reflectedLight.directDiffuse *= cvSun;
    // Under cloud there is no sharp sun (or moon) to see in wet things, only the sky.
    reflectedLight.directSpecular *= cvSun * (1.0 - 0.9 * smoothstep(0.3, 0.8, cvCloud));
  }
`;

type Kind = "default" | "foliage" | "grass";

const MARK = "cvWeathered";

/** Add weather to one material, keeping anything it already does (like the wind). */
function weather(material: THREE.MeshStandardMaterial, kind: Kind): void {
  const before = material.onBeforeCompile;
  const beforeKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    Object.assign(shader.uniforms, weatherUniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vCvWorld;`)
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          vec4 cvW = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            cvW = instanceMatrix * cvW;
          #endif
          vCvWorld = (modelMatrix * cvW).xyz;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${commonCode}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${surfaceCode(kind)}`)
      .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>\n${cloudCode}`);
  };
  material.customProgramCacheKey = () => `${beforeKey}|weather-${kind}`;
  material.userData[MARK] = true;
  material.needsUpdate = true;
}

/**
 * Weather every solid, lit material under `root` that isn't weathered yet. Call it again
 * now and then: robots and boats arrive later. The river and the glowing things are left
 * alone (the river has rain of its own).
 */
export function weatherAll(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const material = m as THREE.MeshStandardMaterial;
      if (!material.isMeshStandardMaterial || material.userData[MARK] || material.transparent) continue;
      if (material.name === "river" || material.emissiveIntensity > 0.01 && material.emissive.getHex() !== 0) {
        material.userData[MARK] = true;
        continue;
      }
      weather(material, material.name === "foliage" ? "foliage" : material.name === "grass" ? "grass" : "default");
    }
  });
}
