// The 3D village page. Sets up the scene and the keys, then follows the events from the
// terminal. How it's drawn (light, sky, shadows, depth of field) lives in render/.

import * as THREE from "three";
import { glowMaterials } from "./buildings.js";
import { CameraRig } from "./camera.js";
import { connect } from "./connection.js";
import { Effects } from "./effects.js";
import { shadows } from "./lowpoly.js";
import { showNoWebGL } from "./no-webgl.js";
import { Overlay } from "./overlay.js";
import { Pipeline } from "./render/pipeline.js";
import { SETTINGS, tierFromQuery } from "./render/quality.js";
import { Village } from "./village.js";
import { createWorld, railGlow } from "./world.js";
import { WAITING } from "../../src/events/explain.js";
import { BUILDINGS, type Building } from "../../src/events/types.js";
import { CSS_NAMES, shadeAt, type Shade } from "../../src/views/colors.js";
import "./style.css";

const params = new URLSearchParams(location.search);
const token = params.get("token") ?? "";
// Inside the desktop app: the app draws the bars, panels and logs itself, so this page
// shows only the village and its caption, and hands building clicks to the app.
const embedded = params.get("embed") === "1";
document.body.classList.toggle("embed", embedded);
// Still mode: nothing moves on its own. On when your system asks for reduced
// motion, or when the terminal was started with --no-animation.
const prefersStill = matchMedia("(prefers-reduced-motion: reduce)").matches;
let still = prefersStill;
/** The moment time stands still at in still mode (one where blinking warning lights are on). */
const STILL_TIME = Math.PI / 18;
const root = document.getElementById("app")!;

// --- Renderer ---------------------------------------------------------------------

// (No antialiasing on the canvas itself: the scene is multisampled in its own render target.)
// Without WebGL 2 this throws: the page says so (no-webgl.ts), and the rest of this file doesn't run.
let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
} catch (err) {
  showNoWebGL();
  throw err;
}
renderer.domElement.className = "scene";
root.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const rig = new CameraRig(renderer.domElement, still);
const overlay = new Overlay(root);
const effects = new Effects(rig.camera);
effects.still = still;

// The light, the sky and the post-processing. ?quality=low|medium|high picks the tier;
// ?debug=fog|dof|ao shows one effect on its own; ?tonemap=aces|agx|neutral.
const pipeline = new Pipeline(renderer, scene, rig.camera, {
  tier: tierFromQuery(params.get("quality")),
  debug: params.get("debug"),
  toneMapping: params.get("tonemap"),
  // ?budget=1 makes every frame count as slow: for testing the automatic step-down.
  budgetMs: Number(params.get("budget")) || undefined,
});

// --- The village -------------------------------------------------------------------

const world = createWorld();
const village = new Village(overlay, effects, rig);
shadows(world.group, true, true);
shadows(village.group, true, true);
village.still = still;
document.body.classList.toggle("still", still);

function setStill(value: boolean): void {
  still = value;
  rig.still = value;
  effects.still = value;
  village.still = value;
  document.body.classList.toggle("still", value);
}
scene.add(world.group, village.group, effects.group);

function resize(): void {
  const width = root.clientWidth;
  const height = root.clientHeight;
  pipeline.resize(width, height);
  overlay.labelRenderer.setSize(width, height);
  overlay.measurePanel();
  rig.resize(width, height);
}
addEventListener("resize", resize);
resize();

// --- Day and night ------------------------------------------------------------------

// 0 is day, 1 is night; anything between is dusk. The desktop app opens at dusk (?night=0.85).
const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
let nightTarget = clamp01(Number(params.get("night") ?? 0));
let night = nightTarget;
/** A full day and night, in seconds, when the cycle is on (0 = off). */
let cycleLength = 0;
let cycleStart = 0;
/** The light level the window around us last heard about. */
let reportedNight = -1;
function applyNight(k: number): void {
  const light = pipeline.setLight(k);
  world.setSky(light);
  // The lamps come on as the light goes. (lamps: 0 at midday, 1 at night.)
  glowMaterials.window.emissiveIntensity = 0.04 + light.lamps * 1.9;
  glowMaterials.lantern.emissiveIntensity = 0.4 + light.lamps * 2.2;
  // As bright as before the new renderer, after exposure: the cyan rails are the theme.
  railGlow.emissiveIntensity = ((0.9 + light.lamps * 1.4) * 1.05) / light.exposure;
  effects.night = k;
  document.body.classList.toggle("night", k > 0.5);
  // The page's colours, and the desktop app's around it, follow the village's light.
  if (Math.abs(k - reportedNight) > 0.004) {
    reportedNight = k;
    const root = document.documentElement.style;
    const shade = shadeAt(k);
    for (const key of Object.keys(shade) as (keyof Shade)[]) root.setProperty(`--${CSS_NAMES[key]}`, shade[key]);
    for (const key of ["bg", "text", "accent"] as const) root.setProperty(`--${key}-rgb`, [1, 3, 5].map((i) => parseInt(shade[key].slice(i, i + 2), 16)).join(" "));
    if (embedded) parent.postMessage({ type: "cli-village", action: "light", night: k }, location.origin);
  }
}

// --- Keys and clicks ----------------------------------------------------------------

addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "?") overlay.toggleHelp();
  else if (e.key === "Escape") {
    if (overlay.helpOpen) overlay.toggleHelp(false);
    else {
      overlay.closePanel();
      village.unpin();
    }
  } else if (e.key === "n" || e.key === "N") {
    cycleLength = 0;
    nightTarget = nightTarget > 0.5 ? 0 : 1;
  }
  else if (e.key === "l" || e.key === "L") overlay.toggleSide();
  else if (e.key === "d" || e.key === "D") overlay.toggleDetails();
  else if (e.key === "h" || e.key === "H") {
    overlay.closePanel();
    village.unpin();
    rig.reset();
  }
});

// --- Inside the desktop app: messages to and from the window around us ------------------

/** False while the desktop app shows another tab over the village. */
let shown = true;

if (embedded) {
  overlay.toggleSide(false);
  // In the app, the terminal is right below the village, not somewhere else.
  village.waitingHint = { ...WAITING, subtitle: "Waiting for work. In the terminal below, try:" };
  overlay.onSelect = (id) => parent.postMessage({ type: "cli-village", action: "selected", building: id }, location.origin);
  addEventListener("message", (e: MessageEvent<{ type?: string; action?: string; building?: string; night?: number; seconds?: number; visible?: boolean }>) => {
    // Only the page around us, from our own server, may steer the village.
    if (e.origin !== location.origin || e.source !== parent) return;
    const m = e.data;
    if (!m || m.type !== "cli-village") return;
    if (m.action === "night" || m.action === "day" || m.action === "light") {
      cycleLength = 0;
      nightTarget = m.action === "light" ? clamp01(Number(m.night)) : m.action === "night" ? 1 : 0;
    } else if (m.action === "cycle") {
      // A whole day and night, over and over, starting from the current light.
      cycleLength = Math.max(10, Number(m.seconds) || 600);
      cycleStart = performance.now() / 1000 - (Math.acos(1 - 2 * night) / (2 * Math.PI)) * cycleLength;
    } else if (m.action === "visible") {
      shown = m.visible !== false;
    } else if (m.action === "home") {
      village.unpin();
      rig.reset();
    } else if (m.action === "focus" && (BUILDINGS as readonly string[]).includes(m.building ?? "")) village.look(m.building as Building);
  });
}

const raycaster = new THREE.Raycaster();
let downAt: { x: number; y: number } | null = null;
renderer.domElement.addEventListener("pointerdown", (e) => (downAt = { x: e.clientX, y: e.clientY }));
renderer.domElement.addEventListener("pointerup", (e) => {
  // A click, not a drag: open that building's log.
  if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, rig.camera);
  const building = village.pick(raycaster);
  if (building) village.select(building);
});
renderer.domElement.addEventListener("pointermove", (e) => {
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, rig.camera);
  renderer.domElement.style.cursor = village.pick(raycaster) ? "pointer" : "";
});

// --- Events from the terminal ----------------------------------------------------------

const source = connect(token, {
  onHello: (mode, _version, view) => {
    document.body.dataset.mode = mode;
    // --compact hides the beginner explanations and key hints.
    document.body.classList.toggle("compact", view.compact);
    setStill(prefersStill || !view.animation);
    // What happened before the page opened is shown as it is now, not played again.
    village.resync();
  },
  onStatus: (message) => overlay.setConnection(message),
});
source.subscribe(() => village.sync(source.getState()));
village.sync(source.getState());

// --- The loop ---------------------------------------------------------------------------

const timer = new THREE.Timer();
let exposure = 1;
renderer.setAnimationLoop((time) => {
  timer.update(time);
  const dt = Math.min(timer.getDelta(), 0.1);
  // In still mode the clock stops, so nothing bobs, sways or pulses, and changes happen at once.
  const t = still ? STILL_TIME : timer.getElapsed();
  if (cycleLength) nightTarget = 0.5 - 0.5 * Math.cos(((performance.now() / 1000 - cycleStart) / cycleLength) * 2 * Math.PI);
  night += (nightTarget - night) * (still ? 1 : Math.min(1, dt * 1.6));
  applyNight(night);
  // When the run has stopped, the village dims a little.
  const wanted = source.getState().stopped ? 0.6 : 1;
  exposure += (wanted - exposure) * (still ? 1 : Math.min(1, dt * 1.5));

  world.setDenseGrass(SETTINGS[pipeline.tier].denseGrass);
  world.update(dt, t);
  village.update(dt, t);
  effects.update(dt, t);
  // With a building's log open on the right, center the picture in the space that's left.
  rig.setInset(overlay.panelInset);
  rig.update(dt);
  // With no room (in the desktop app, while the bottom panel is maximized) the page has no
  // height: keep the village up to date, but don't draw it. Drawing into nothing only fills
  // the log with WebGL errors. Behind another tab in the app, nobody sees it: don't draw either.
  if (!shown || root.clientWidth === 0 || root.clientHeight === 0) return;
  // Focus where the camera looks: the village, or the building it's visiting.
  pipeline.render(dt, t, rig.camera.position.distanceTo(rig.controls.target), exposure);
  overlay.labelRenderer.render(scene, rig.camera);
});

