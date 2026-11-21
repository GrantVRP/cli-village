// Wind in the trees and bushes, done in the vertex shader.
//
// The leaves are merged into one big mesh with everything else that doesn't move (that's
// what keeps the village fast), so nothing can be rotated per tree. Instead each vertex is
// pushed by a smooth function of where it is: neighbouring vertices move almost together,
// so a crown sways as one piece, while slow gusts roll across the whole field. Higher
// vertices move more, and the ground and trunks don't move at all.
//
// The shadow pass uses the same displacement (a matching depth material), so the shadows
// sway with the trees. Flat shading takes its normals from screen-space derivatives, so the
// lighting follows the moved faces for free.

import * as THREE from "three";

export const windUniforms = {
  time: { value: 0 },
  /** 0 = still air, 1 = a breeze. */
  strength: { value: 1 },
};

const windCode = /* glsl */ `
  uniform float windTime;
  uniform float windStrength;
  vec3 windOffset(vec3 world) {
    float height = clamp((world.y - 0.35) / 3.2, 0.0, 1.0);
    height *= height;
    // A gust is a slow wave rolling across the village, from the front left.
    float gust = 0.55 + 0.45 * sin(dot(world.xz, vec2(0.07, 0.045)) - windTime * 0.55);
    // The sway: a crown leans with the wind and back, at its own pace.
    float phase = dot(world.xz, vec2(0.21, 0.17));
    vec2 sway = vec2(sin(windTime * 1.15 + phase), cos(windTime * 0.85 + phase * 1.3) * 0.6);
    // Flutter: small fast movements, different for each part of a crown.
    float flutter = sin(windTime * 4.3 + dot(world, vec3(1.7, 2.3, 1.1))) * 0.25;
    vec2 push = (sway * gust + vec2(gust * 0.6, 0.0) + flutter) * 0.085;
    return vec3(push.x, -abs(push.x) * 0.25, push.y) * height * windStrength;
  }
`;

function addWind(material: THREE.Material): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.windTime = windUniforms.time;
    shader.uniforms.windStrength = windUniforms.strength;
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>\n${windCode}`).replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      // (The mesh sits at the origin unrotated, so its own coordinates are world coordinates.)
      transformed += windOffset((modelMatrix * vec4(transformed, 1.0)).xyz);`,
    );
  };
  material.customProgramCacheKey = () => "cli-village-wind";
}

/** The material for leaves: the village's matte faceted look, plus wind. */
export function foliageMaterial(base: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const material = base.clone();
  material.name = "foliage";
  addWind(material);
  return material;
}

/** Give every mesh drawn with this material a shadow that sways along with it. */
export function swayShadows(root: THREE.Object3D, material: THREE.Material): void {
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  addWind(depth);
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && mesh.material === material) mesh.customDepthMaterial = depth;
  });
}
