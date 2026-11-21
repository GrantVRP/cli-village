// The village's post-processing passes, in the order they run:
//
//   ScenePass        draws the sky, then the scene, into a multisampled HDR target that keeps
//                    its depth buffer as a texture, for the passes below.
//   AtmospherePass   haze that thickens with distance, mist that hugs the ground, both
//                    brightened towards the sun (forward scattering). Rebuilds each pixel's
//                    world position from the depth buffer, so it costs one pass, whatever is
//                    in the scene.
//   DepthOfFieldPass the tilt-shift look: a real depth of field focused on what the camera
//                    looks at, so the near and far parts of the village blur like a photo of
//                    a model. A circle of confusion per pixel, a bokeh gather at half
//                    resolution, then a blend back over the sharp picture.
//   FinishPass       after tone mapping: a colour grade (ASC CDL slope/offset/power,
//                    saturation, split toning), a vignette, film grain and dithering.

import * as THREE from "three";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";
import { CopyShader } from "three/addons/shaders/CopyShader.js";

const fullscreenVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** Rebuild a pixel's position from the depth buffer (shared by the depth passes). */
const depthHelpers = /* glsl */ `
  uniform sampler2D tDepth;
  uniform mat4 projectionInverse;
  uniform mat4 cameraWorld;
  vec3 viewPosition(vec2 uv, float depth) {
    vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 view = projectionInverse * ndc;
    return view.xyz / view.w;
  }
  vec3 worldPosition(vec2 uv, float depth) {
    return (cameraWorld * vec4(viewPosition(uv, depth), 1.0)).xyz;
  }
`;

/** Keep a depth pass's camera uniforms in step with the camera. */
function updateCameraUniforms(uniforms: Record<string, THREE.IUniform>, camera: THREE.PerspectiveCamera): void {
  uniforms.projectionInverse!.value.copy(camera.projectionMatrixInverse);
  uniforms.cameraWorld!.value.copy(camera.matrixWorld);
}

// --- Scene --------------------------------------------------------------------------------

export class ScenePass extends Pass {
  readonly target: THREE.WebGLRenderTarget;
  private readonly copy = new FullScreenQuad(
    new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(CopyShader.uniforms), vertexShader: CopyShader.vertexShader, fragmentShader: CopyShader.fragmentShader }),
  );

  constructor(
    private readonly scene: THREE.Scene,
    private readonly sky: THREE.Object3D,
    private readonly camera: THREE.Camera,
    msaa: number,
  ) {
    super();
    const depthTexture = new THREE.DepthTexture(1, 1);
    depthTexture.type = THREE.FloatType;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: msaa, depthTexture });
    this.target.texture.name = "scene";
    this.needsSwap = true;
  }

  get depthTexture(): THREE.DepthTexture {
    return this.target.depthTexture!;
  }

  override setSize(width: number, height: number): void {
    this.target.setSize(width, height);
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget): void {
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.target);
    renderer.clear();
    // The sky first, on its own (so passes that render the scene again, like the ambient
    // occlusion, don't see a giant sphere around the camera).
    renderer.render(this.sky, this.camera);
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
    const material = this.copy.material as THREE.ShaderMaterial;
    material.uniforms.tDiffuse!.value = this.target.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.copy.render(renderer);
  }

  override dispose(): void {
    this.target.dispose();
    this.copy.dispose();
  }
}

// --- Atmosphere ---------------------------------------------------------------------------

export class AtmospherePass extends Pass {
  readonly uniforms = {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    projectionInverse: { value: new THREE.Matrix4() },
    cameraWorld: { value: new THREE.Matrix4() },
    cameraPos: { value: new THREE.Vector3() },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    fogColor: { value: new THREE.Color() },
    sunColor: { value: new THREE.Color() },
    /** Haze per unit of distance past `hazeStart`. */
    haze: { value: 0.006 },
    hazeStart: { value: 40 },
    /** Mist: density at ground level, and how fast it thins with height. */
    mist: { value: 0.03 },
    mistFalloff: { value: 0.45 },
    mistBase: { value: -0.6 },
    debug: { value: 0 },
  };
  private readonly quad: FullScreenQuad;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    depth: THREE.Texture,
  ) {
    super();
    this.uniforms.tDepth.value = depth;
    this.quad = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: fullscreenVertex,
        fragmentShader: /* glsl */ `
          uniform sampler2D tDiffuse;
          uniform vec3 cameraPos;
          uniform vec3 sunDir;
          uniform vec3 fogColor;
          uniform vec3 sunColor;
          uniform float haze;
          uniform float hazeStart;
          uniform float mist;
          uniform float mistFalloff;
          uniform float mistBase;
          uniform int debug;
          varying vec2 vUv;
          ${depthHelpers}

          // Mist density falls off exponentially with height: mist * exp(-b * height).
          // Integrated along the view ray from the camera (height h0) to the pixel (height h1),
          // in closed form, so there's no ray marching: mist * dist * (e^-b*h0 - e^-b*h1) / (b * (h1 - h0)).
          // Written with both exponents <= 0, so it can't overflow however long the ray.
          float mistAlong(vec3 from, vec3 to, float dist) {
            float b = mistFalloff;
            float h0 = max(from.y - mistBase, 0.0);
            float h1 = max(to.y - mistBase, 0.0);
            float dh = h1 - h0;
            if (abs(dh) < 1e-3) return mist * exp(-b * h0) * dist;
            return mist * dist * (exp(-b * h0) - exp(-b * h1)) / (b * dh);
          }

          void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            float depth = texture2D(tDepth, vUv).r;
            if (depth >= 0.99999) { gl_FragColor = color; return; } // the sky has its own haze
            vec3 world = worldPosition(vUv, depth);
            vec3 ray = world - cameraPos;
            float dist = length(ray);
            vec3 dir = ray / dist;
            float amount = haze * max(dist - hazeStart, 0.0) + mistAlong(cameraPos, world, dist);
            // Past the edge of the land it's all haze, so the world never ends in a visible line.
            float fog = max(1.0 - exp(-amount), smoothstep(150.0, 230.0, dist));
            // Light scattered towards the viewer is brighter looking towards the sun.
            float scatter = pow(max(dot(dir, sunDir), 0.0), 5.0);
            vec3 tint = mix(fogColor, sunColor, scatter * 0.55);
            gl_FragColor = vec4(mix(color.rgb, tint, fog), color.a);
            if (debug == 1) gl_FragColor = vec4(vec3(fog), 1.0);
          }
        `,
      }),
    );
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    updateCameraUniforms(this.uniforms, this.camera);
    this.uniforms.cameraPos.value.setFromMatrixPosition(this.camera.matrixWorld);
    this.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.quad.dispose();
  }
}

/// --- Depth of field -----------------------------------------------------------------------

/**
 * Signed circle of confusion, in pixels: how blurred a point at a depth is when the lens
 * focuses at `focus` (thin-lens model, proportional to 1/focus - 1/z). Negative in front of
 * the focus, positive behind it, so the sign also says which of two pixels is nearer.
 * `strength` is the blur, as a fraction of the screen's height, of something infinitely far.
 */
const cocFunction = /* glsl */ `
  uniform float focus;
  uniform float strength;
  uniform float maxCoc;
  uniform float pixels;
  uniform float cameraNear;
  uniform float cameraFar;
  float viewDistance(float depth) {
    float ndc = depth * 2.0 - 1.0;
    return 2.0 * cameraNear * cameraFar / (cameraFar + cameraNear - ndc * (cameraFar - cameraNear));
  }
  float signedCoc(float depth) {
    float limit = maxCoc * pixels;
    if (depth >= 0.99999) return limit; // the sky: as far, and as blurred, as it gets
    float z = viewDistance(depth);
    return clamp((1.0 - focus / z) * strength * pixels, -limit, limit);
  }
`;

export class DepthOfFieldPass extends Pass {
  readonly uniforms = {
    focus: { value: 70 },
    strength: { value: 0.032 },
    maxCoc: { value: 0.022 },
    pixels: { value: 1000 },
    cameraNear: { value: 0.5 },
    cameraFar: { value: 400 },
    debug: { value: 0 },
  };
  private readonly half: THREE.WebGLRenderTarget;
  private readonly blurred: THREE.WebGLRenderTarget;
  private readonly prepare: FullScreenQuad;
  private readonly gather: FullScreenQuad;
  private readonly composite: FullScreenQuad;
  private readonly texel = new THREE.Vector2();
  private readonly camera: THREE.PerspectiveCamera;

  constructor(camera: THREE.PerspectiveCamera, depth: THREE.Texture, samples: number) {
    super();
    this.camera = camera;
    const options = { type: THREE.HalfFloatType, depthBuffer: false } as const;
    this.half = new THREE.WebGLRenderTarget(1, 1, options);
    this.blurred = new THREE.WebGLRenderTarget(1, 1, options);
    const shared = { ...this.uniforms, tDepth: { value: depth }, texel: { value: this.texel } };

    // 1. Half-resolution colour, with each pixel's signed circle of confusion in alpha.
    this.prepare = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: { ...shared, tDiffuse: { value: null } },
        vertexShader: fullscreenVertex,
        fragmentShader: /* glsl */ `
          uniform sampler2D tDiffuse;
          uniform sampler2D tDepth;
          uniform vec2 texel;
          varying vec2 vUv;
          ${cocFunction}
          void main() {
            // The nearest of the four full-resolution depths, so thin near things keep their blur.
            vec2 h = texel * 0.25;
            float d = min(min(texture2D(tDepth, vUv + vec2(-h.x, -h.y)).r, texture2D(tDepth, vUv + vec2(h.x, -h.y)).r),
                          min(texture2D(tDepth, vUv + vec2(-h.x, h.y)).r, texture2D(tDepth, vUv + vec2(h.x, h.y)).r));
            gl_FragColor = vec4(texture2D(tDiffuse, vUv).rgb, signedCoc(d));
          }
        `,
      }),
    );

    // 2. Bokeh gather over a golden-angle spiral out to the largest blur.
    //    A sample counts when its own blur reaches this pixel. Samples *behind* this pixel
    //    can't spread over it further than its own blur (a sharp object never gets a halo
    //    from the background), while blurred things *in front* spread freely, like a real lens.
    //    Bright samples weigh a little more, so lamps open into round bokeh discs.
    //    Alpha out: how much of the blurred picture to show here (this pixel's own blur, or
    //    the share of out-of-focus foreground covering it).
    this.gather = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: { ...shared, tHalf: { value: this.half.texture } },
        vertexShader: fullscreenVertex,
        fragmentShader: /* glsl */ `
          uniform sampler2D tHalf;
          uniform vec2 texel;
          uniform float maxCoc;
          uniform float pixels;
          varying vec2 vUv;
          const int SAMPLES = ${samples};
          void main() {
            vec4 center = texture2D(tHalf, vUv);
            float own = abs(center.a) * 0.5; // in half-resolution pixels
            float reach = maxCoc * pixels * 0.5;
            vec3 sum = center.rgb;
            float weight = 1.0;
            float front = 0.0;
            for (int i = 1; i < SAMPLES; i++) {
              float r = sqrt(float(i) / float(SAMPLES)) * reach;
              float theta = float(i) * 2.399963229728653;
              vec4 s = texture2D(tHalf, vUv + vec2(cos(theta), sin(theta)) * r * texel);
              float spread = abs(s.a) * 0.5;
              bool inFront = s.a < center.a - 0.5;
              if (!inFront) spread = min(spread, own + 1.0);
              float w = smoothstep(r - 1.0, r + 0.5, spread);
              w *= 1.0 + 0.6 * max(dot(s.rgb, vec3(0.2126, 0.7152, 0.0722)) - 1.0, 0.0);
              sum += s.rgb * w;
              weight += w;
              if (inFront && spread > 1.5) front += w;
            }
            float blend = max(smoothstep(0.5, 1.6, own), clamp(front / weight * 1.6, 0.0, 1.0));
            gl_FragColor = vec4(sum / weight, blend);
          }
        `,
      }),
    );

    // 3. Back to full resolution: the sharp picture where it's in focus, the blur elsewhere.
    this.composite = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: { ...shared, tDiffuse: { value: null }, tBlurred: { value: this.blurred.texture } },
        vertexShader: fullscreenVertex,
        fragmentShader: /* glsl */ `
          uniform sampler2D tDiffuse;
          uniform sampler2D tBlurred;
          uniform sampler2D tDepth;
          uniform int debug;
          varying vec2 vUv;
          ${cocFunction}
          void main() {
            vec4 sharp = texture2D(tDiffuse, vUv);
            vec4 blurred = texture2D(tBlurred, vUv);
            gl_FragColor = vec4(mix(sharp.rgb, blurred.rgb, blurred.a), sharp.a);
            // Debug views. 1: red in front of the focus, green behind it, blue how much blur is
            // shown. 2: how much blur is shown. 3: the blur size.
            float c = signedCoc(texture2D(tDepth, vUv).r) / (maxCoc * pixels);
            if (debug == 1) gl_FragColor = vec4(max(-c, 0.0), max(c, 0.0), blurred.a, 1.0);
            if (debug == 2) gl_FragColor = vec4(vec3(blurred.a), 1.0);
            if (debug == 3) gl_FragColor = vec4(vec3(abs(c)), 1.0);
          }
        `,
      }),
    );
  }

  override setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width / 2));
    const h = Math.max(1, Math.round(height / 2));
    this.half.setSize(w, h);
    this.blurred.setSize(w, h);
    this.texel.set(1 / w, 1 / h);
    this.uniforms.pixels.value = height;
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    this.uniforms.cameraNear.value = this.camera.near;
    this.uniforms.cameraFar.value = this.camera.far;
    const prepare = this.prepare.material as THREE.ShaderMaterial;
    prepare.uniforms.tDiffuse!.value = readBuffer.texture;
    renderer.setRenderTarget(this.half);
    this.prepare.render(renderer);
    renderer.setRenderTarget(this.blurred);
    this.gather.render(renderer);
    const composite = this.composite.material as THREE.ShaderMaterial;
    composite.uniforms.tDiffuse!.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.composite.render(renderer);
  }

  override dispose(): void {
    this.half.dispose();
    this.blurred.dispose();
    this.prepare.dispose();
    this.gather.dispose();
    this.composite.dispose();
  }
}

// --- Finish -------------------------------------------------------------------------------

export class FinishPass extends Pass {
  readonly uniforms = {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    resolution: { value: new THREE.Vector2(1, 1) },
    // ASC CDL: out = (in * slope + offset) ^ power, per channel.
    slope: { value: new THREE.Vector3(1.03, 1.0, 0.96) },
    offset: { value: new THREE.Vector3(0.004, 0.0, -0.004) },
    power: { value: new THREE.Vector3(1.0, 1.0, 1.02) },
    saturation: { value: 1.06 },
    /** Split toning: shadows lean cool, highlights lean warm. */
    shadowTint: { value: new THREE.Color(0x2d3c55) },
    highlightTint: { value: new THREE.Color(0xffe2b8) },
    splitAmount: { value: 0.07 },
    vignette: { value: 0.28 },
    grain: { value: 0.022 },
  };
  private readonly quad: FullScreenQuad;

  constructor() {
    super();
    this.quad = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: fullscreenVertex,
        fragmentShader: /* glsl */ `
          uniform sampler2D tDiffuse;
          uniform float time;
          uniform vec2 resolution;
          uniform vec3 slope;
          uniform vec3 offset;
          uniform vec3 power;
          uniform float saturation;
          uniform vec3 shadowTint;
          uniform vec3 highlightTint;
          uniform float splitAmount;
          uniform float vignette;
          uniform float grain;
          varying vec2 vUv;

          float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
          // Hash without sine (stable across GPUs), for grain and dithering.
          float hash(vec3 p) {
            p = fract(p * 0.1031);
            p += dot(p, p.zyx + 31.32);
            return fract((p.x + p.y) * p.z);
          }

          void main() {
            vec3 c = texture2D(tDiffuse, vUv).rgb;
            c = pow(max(c * slope + offset, 0.0), power);
            float y = luma(c);
            c = mix(vec3(y), c, saturation);
            // Split toning, as an overlay: cool in the shadows, warm in the highlights.
            // (The tint is normalised to brightness 1, so it shifts hue without darkening.)
            // Strong colours are left alone, so the cyan rails and the column keep their hue.
            vec3 tint = mix(shadowTint, highlightTint, smoothstep(0.15, 0.75, y));
            float chroma = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
            c = mix(c, c * tint / max(luma(tint), 1e-4), splitAmount * (1.0 - smoothstep(0.2, 0.6, chroma)));
            // Vignette: an ellipse that follows the window's shape, very soft.
            vec2 p = (vUv - 0.5) * vec2(resolution.x / resolution.y, 1.0);
            c *= 1.0 - vignette * smoothstep(0.35, 1.05, length(p));
            // Film grain: stronger in the mid-tones, where film shows it most.
            float n = hash(vec3(gl_FragCoord.xy, floor(time * 24.0))) - 0.5;
            c += n * grain * (1.0 - abs(y - 0.5) * 1.4);
            // Dither by half a step of 8-bit colour, so the sky's gradients never band.
            c += (hash(vec3(gl_FragCoord.yx, 7.0)) - 0.5) / 255.0;
            gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
          }
        `,
      }),
    );
  }

  override setSize(width: number, height: number): void {
    this.uniforms.resolution.value.set(width, height);
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.quad.dispose();
  }
}
