// How the village is drawn, start to finish. One object owns the light, the sky, the
// shadows and the chain of post-processing passes, and picks how much of it this computer
// can afford (see quality.ts).
//
//   sky + scene (multisampled, HDR, depth kept)  ScenePass
//   → ambient occlusion in creases (top tier)     GTAOPass
//   → haze and ground mist                         AtmospherePass
//   → tilt-shift depth of field                    DepthOfFieldPass
//   → glow around lights                           UnrealBloomPass
//   → tone mapping to the screen's range           OutputPass
//   → grade, vignette, grain, dither               FinishPass

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { AtmospherePass, DepthOfFieldPass, FinishPass, ScenePass } from "./passes.js";
import { FrameBudget, lower, SETTINGS, tierForRenderer, type Tier } from "./quality.js";
import { installSoftShadows, MARKER as SOFT_SHADOWS, sunSizeToRadius } from "./shadows.js";
import { Sky } from "./sky.js";
import { lightingAt, sunDirection, type Lighting } from "./timeline.js";

export interface PipelineOptions {
  /** A tier asked for in the page address: used as is, and never stepped down. */
  tier?: Tier | null;
  /** Frame time (ms) above which frames count as slow (for testing the step-down; default 22). */
  budgetMs?: number;
  /** Show one effect on its own: "fog", "dof" or "ao". */
  debug?: string | null;
  /** "aces" (the default: warm and saturated, like the village has always looked), "agx" or "neutral". */
  toneMapping?: string | null;
}

/** The point the sun circles: the middle of the village, a little towards the river. */
const CENTER = new THREE.Vector3(0, 0, -3);
/** The sun's apparent size in degrees, for the soft shadows. (The real sun is 0.53°; a bigger
 * one gives the softer shadows of a hazy day, which suit a miniature.) */
const SUN_SIZE = 2.6;
/** Rebuild the sky's reflection after the light changes this much, and at most this often (ms). */
const ENVIRONMENT_STEP = 0.02;
const ENVIRONMENT_EVERY = 400;

const TONE_MAPPING: Record<string, THREE.ToneMapping> = {
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
};

/** The graphics card's name, if the browser tells us. */
function rendererName(renderer: THREE.WebGLRenderer): string {
  const gl = renderer.getContext();
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  return typeof name === "string" ? name : "";
}

export class Pipeline {
  readonly sun = new THREE.DirectionalLight(0xffffff, 2.7);
  readonly fill = new THREE.HemisphereLight(0xffffff, 0x666666, 1);
  readonly sky = new Sky();
  /** The graphics card's name, and the tier in use. */
  readonly gpu: string;
  tier: Tier;
  lighting: Lighting = lightingAt(0);

  private readonly skyScene = new THREE.Scene();
  private readonly budget: FrameBudget;
  /** Average frame time (ms), shown in the page's data-frame-ms for tests and diagnostics. */
  private frameMs = 0;
  private frames = 0;
  /** True for the frame after work that isn't drawing (rebuilding the sky's reflection). */
  private skipBudget = false;
  private readonly forced: boolean;
  private readonly debug: string;
  private composer: EffectComposer | null = null;
  private atmosphere: AtmospherePass | null = null;
  private dof: DepthOfFieldPass | null = null;
  private finish: FinishPass | null = null;
  private size = { width: 1, height: 1 };
  private readonly pmrem: THREE.PMREMGenerator;
  private environment: THREE.WebGLRenderTarget | null = null;
  /** The light level the sky's reflection was made for (-1: none yet). */
  private environmentFor = -1;
  private environmentAt = -Infinity;
  private night = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    options: PipelineOptions = {},
  ) {
    this.gpu = rendererName(renderer);
    this.forced = Boolean(options.tier);
    this.tier = options.tier ?? tierForRenderer(this.gpu);
    this.debug = options.debug ?? "";
    this.budget = new FrameBudget(options.budgetMs ?? 22);
    // Time spent hidden says nothing about how fast the village draws.
    document.addEventListener("visibilitychange", () => this.budget.reset());
    renderer.toneMapping = this.debug ? THREE.NoToneMapping : (TONE_MAPPING[options.toneMapping ?? ""] ?? THREE.ACESFilmicToneMapping);
    renderer.shadowMap.enabled = true;
    this.pmrem = new THREE.PMREMGenerator(renderer);

    // The soft-shadow shader is decided once, before anything is compiled: changing it
    // later would mean recompiling every material.
    const samples = SETTINGS[this.tier].shadowSamples;
    if (samples > 0) installSoftShadows(samples);

    // The sun. Its shadow covers the village and the river, and moves with the sun.
    const shadow = this.sun.shadow;
    shadow.camera.left = -38;
    shadow.camera.right = 38;
    shadow.camera.top = 38;
    shadow.camera.bottom = -38;
    shadow.camera.near = 1;
    shadow.camera.far = 170;
    shadow.bias = -0.00025;
    shadow.normalBias = 0.045;
    this.sun.castShadow = true;
    this.sun.target.position.copy(CENTER);
    scene.add(this.sun, this.sun.target, this.fill);
    this.skyScene.add(this.sky.mesh);

    this.applyTier();
  }

  /** Set up everything that depends on the tier. Called at the start and after stepping down. */
  private applyTier(): void {
    const s = SETTINGS[this.tier];
    document.documentElement.dataset.quality = this.tier;
    document.documentElement.dataset.gpu = this.gpu;
    console.info(`[village] graphics: ${this.tier} quality on "${this.gpu || "an unknown graphics card"}"`);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, s.maxPixelRatio));
    // Soft shadows read the shadow map as plain depth ("basic"); otherwise three.js's own filter.
    const soft = s.shadowSamples > 0 && THREE.ShaderChunk.shadowmap_pars_fragment.includes(SOFT_SHADOWS);
    this.renderer.shadowMap.type = soft ? THREE.BasicShadowMap : THREE.PCFShadowMap;
    const shadow = this.sun.shadow;
    shadow.camera.updateProjectionMatrix();
    shadow.radius = soft ? sunSizeToRadius(SUN_SIZE, shadow.camera) : 2.5;
    if (shadow.mapSize.x !== s.shadowMap) {
      shadow.mapSize.set(s.shadowMap, s.shadowMap);
      shadow.map?.dispose();
      shadow.map = null;
    }
    if (!s.environment) this.setEnvironment(null);
    this.environmentFor = -1;
    this.environmentAt = -Infinity;
    this.buildComposer();
    this.setLight(this.night);
  }

  private buildComposer(): void {
    // (The composer frees only its own two targets: each pass frees its own.)
    for (const pass of this.composer?.passes ?? []) pass.dispose();
    this.composer?.dispose();
    const s = SETTINGS[this.tier];
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    const composer = new EffectComposer(this.renderer, target);
    const scenePass = new ScenePass(this.scene, this.skyScene, this.camera, s.msaa);
    composer.addPass(scenePass);
    if (s.ambientOcclusion || this.debug === "ao") {
      const ao = new GTAOPass(this.scene, this.camera, 1, 1);
      // Read the scene's own depth (normals come from it: exact for flat-shaded faces), so the
      // occlusion follows the swaying trees and the scene isn't drawn a second time. (Set
      // after construction: passing it to the constructor leaves GTAOPass without the target
      // it sizes and frees later.)
      ao.setGBuffer(scenePass.depthTexture);
      ao.updateGtaoMaterial({ radius: 1.8, distanceExponent: 2, thickness: 1.5, scale: 1.25, samples: 16 });
      ao.updatePdMaterial({ radius: 6, samples: 16, rings: 2 });
      ao.blendIntensity = 1;
      if (this.debug === "ao") ao.output = GTAOPass.OUTPUT.Denoise;
      composer.addPass(ao);
    }
    this.atmosphere = new AtmospherePass(this.camera, scenePass.depthTexture);
    this.atmosphere.uniforms.debug.value = this.debug === "fog" ? 1 : 0;
    composer.addPass(this.atmosphere);
    this.dof = new DepthOfFieldPass(this.camera, scenePass.depthTexture, s.bokehSamples);
    this.dof.uniforms.debug.value = ({ dof: 1, "dof-blend": 2, "dof-coc": 3 } as Record<string, number>)[this.debug] ?? 0;
    composer.addPass(this.dof);
    // Glow around anything brighter than white (the composer sizes it to half resolution).
    if (s.bloom && !this.debug) composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.6, 0.9));
    composer.addPass(new OutputPass());
    this.finish = new FinishPass();
    // Debug views show their values as they are: no glow, tone mapping or grade on top.
    if (!this.debug) composer.addPass(this.finish);
    this.composer = composer;
    this.resize(this.size.width, this.size.height);
  }

  resize(width: number, height: number): void {
    this.size = { width: Math.max(1, width), height: Math.max(1, height) };
    this.renderer.setSize(this.size.width, this.size.height);
    if (!this.composer) return;
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(this.size.width, this.size.height);
  }

  /** Set the time of day: 0 = midday, 1 = night. Returns the light, for the lamps and windows. */
  setLight(k: number): Lighting {
    this.night = k;
    const L = (this.lighting = lightingAt(k));
    const [x, y, z] = sunDirection(L);
    const dir = new THREE.Vector3(x, y, z);
    this.sun.position.copy(CENTER).addScaledVector(dir, 90);
    this.sun.color.set(L.sunColor);
    this.sun.intensity = L.sunIntensity;
    const environment = SETTINGS[this.tier].environment;
    this.fill.color.set(L.skyFill);
    this.fill.groundColor.set(L.groundFill);
    // With the sky's reflection lighting the scene too, the fill light gives way to it.
    this.fill.intensity = L.fillIntensity * (environment ? 0.65 : 1);
    this.scene.environmentIntensity = 0.32;

    const u = this.sky.uniforms;
    u.zenith.value.set(L.zenith);
    u.horizon.value.set(L.horizon);
    u.ground.value.set(L.fog);
    u.sunDir.value.copy(dir);
    u.sunColor.value.set(L.sunColor);
    u.sunGlow.value.set(L.sunGlow);
    u.cloudColor.value.set(L.cloudColor);
    u.cloudCover.value = L.cloudCover;
    u.stars.value = L.stars;

    if (this.atmosphere) {
      const a = this.atmosphere.uniforms;
      a.sunDir.value.copy(dir);
      a.fogColor.value.set(L.fog);
      a.sunColor.value.set(L.sunGlow);
      a.haze.value = 0.0075 * L.fogDensity;
      a.hazeStart.value = 75;
      a.mist.value = 0.011 * L.fogDensity;
    }
    return L;
  }

  private setEnvironment(target: THREE.WebGLRenderTarget | null): void {
    this.environment?.dispose();
    this.environment = target;
    this.scene.environment = target?.texture ?? null;
  }

  /** Draw one frame. `focus` is the distance the lens focuses at; `t` drives clouds and grain. */
  render(dt: number, t: number, focus: number, exposure: number): void {
    if (!this.composer || !this.dof || !this.finish) return;
    const ms = dt * 1000;
    this.frameMs = this.frames++ === 0 ? ms : this.frameMs + (ms - this.frameMs) * 0.05;
    if (this.frames % 30 === 0) document.documentElement.dataset.frameMs = this.frameMs.toFixed(1);
    // Too slow here? Step down a tier (unless the page address asked for one).
    const slow = !this.skipBudget && this.budget.add(ms);
    this.skipBudget = false;
    if (!this.forced && this.tier !== "low" && slow) {
      this.tier = lower(this.tier);
      this.budget.reset();
      this.applyTier();
      return;
    }
    // The sky's reflection follows the time of day: rebuilt when it changed enough, and not
    // every frame while the light fades (pressing n, or the day-night cycle).
    const now = performance.now();
    if (SETTINGS[this.tier].environment && Math.abs(this.night - this.environmentFor) > ENVIRONMENT_STEP && now - this.environmentAt > ENVIRONMENT_EVERY) {
      this.environmentFor = this.night;
      this.environmentAt = now;
      this.sky.uniforms.stars.value = 0; // no stars in the reflections
      this.setEnvironment(this.pmrem.fromScene(this.skyScene, 0.02, 0.1, 200));
      this.sky.uniforms.stars.value = this.lighting.stars;
      this.skipBudget = true;
    }
    this.renderer.toneMappingExposure = this.lighting.exposure * exposure;
    this.sky.uniforms.time.value = t;
    this.dof.uniforms.focus.value = focus;
    // Close up, the blur eases off, so the neighbours of the building in view stay readable.
    this.dof.uniforms.strength.value = 0.032 * THREE.MathUtils.clamp(focus / 72, 0.4, 1);
    this.finish.uniforms.time.value = t;
    this.finish.uniforms.saturation.value = this.lighting.saturation;
    this.composer.render(dt);
  }
}
