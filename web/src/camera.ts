// The camera: a high, narrow (35°) view like looking down at a tabletop.
// It orbits slowly on its own, glides toward the building where the most
// important thing is happening, then eases back out. Drag to orbit and
// scroll to zoom at any time; it waits a few seconds before taking over again.
// In still mode (--no-animation, or "reduce motion" in your system settings)
// it never moves on its own: clicking a building or pressing h cuts straight there.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

interface View {
  target: THREE.Vector3;
  radius: number;
  polar: number;
  azimuth: number;
}

const HOME: View = { target: new THREE.Vector3(0, 0, -3), radius: 72, polar: 0.86, azimuth: 0 };
const USER_PAUSE_MS = 9000;

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private readonly current: View = { ...HOME, target: HOME.target.clone() };
  private focusUntil = 0;
  private focusView: View | null = null;
  private userUntil = 0;
  private dragging = false;
  private orbitClock = 0;
  private stillMode = false;

  constructor(dom: HTMLElement, still: boolean) {
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.5, 400);
    this.controls = new OrbitControls(this.camera, dom);
    this.still = still;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 14;
    this.controls.maxDistance = 110;
    this.controls.maxPolarAngle = 1.35;
    this.controls.minPolarAngle = 0.25;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = false;
    this.controls.addEventListener("start", () => {
      this.dragging = true;
      this.userUntil = Infinity;
    });
    this.controls.addEventListener("end", () => {
      this.dragging = false;
      this.userUntil = performance.now() + USER_PAUSE_MS;
    });
    dom.addEventListener("wheel", () => (this.userUntil = performance.now() + USER_PAUSE_MS), { passive: true });
    this.apply(this.current);
  }

  /** Still mode (--no-animation or reduced motion): no orbit, no gliding. The camera cuts instead. */
  get still(): boolean {
    return this.stillMode;
  }
  set still(value: boolean) {
    this.stillMode = value;
    this.controls.enableDamping = !value;
  }

  /** Glide toward a spot for a while, then come back out. (In still mode: cut to it and stay.) */
  focus(point: THREE.Vector3, holdMs: number, radius = 30): void {
    const dir = point.clone().setY(0);
    // Look at the spot from the plaza side, so the building's front is visible.
    const azimuth = dir.lengthSq() > 1 ? Math.atan2(dir.x, dir.z) * 0.35 : this.current.azimuth;
    this.focusView = { target: point.clone().setY(1.2), radius, polar: 0.82, azimuth };
    this.focusUntil = performance.now() + holdMs;
    if (this.stillMode) this.cut(this.focusView);
  }

  /** Back to the default view. */
  reset(): void {
    this.focusView = null;
    this.userUntil = 0;
    if (this.stillMode) this.cut(HOME);
  }

  /** Jump straight to a view, with no movement in between. */
  private cut(view: View): void {
    this.current.target.copy(view.target);
    this.current.radius = view.radius;
    this.current.polar = view.polar;
    this.current.azimuth = view.azimuth;
    this.apply(this.current);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    // Shift the picture down a little, so the caption at the top doesn't cover the buildings.
    this.camera.setViewOffset(width, height * 1.16, 0, 0, width, height);
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    const now = performance.now();
    if (this.dragging || now < this.userUntil) {
      // The user is in charge. Remember where they left the camera.
      this.controls.update();
      this.readBack();
      return;
    }
    // Still mode: the camera never moves by itself. It stays where you left it.
    if (this.stillMode) return;

    if (!this.stillMode) this.orbitClock += dt;
    const wanted: View =
      this.focusView && now < this.focusUntil
        ? this.focusView
        : {
            target: HOME.target,
            radius: HOME.radius,
            polar: HOME.polar,
            // A slow back-and-forth orbit keeps the river at the back.
            azimuth: Math.sin(this.orbitClock * 0.045) * 0.5,
          };
    const k = this.stillMode ? 1 : 1 - Math.exp(-dt * 1.4);
    this.current.target.lerp(wanted.target, k);
    this.current.radius += (wanted.radius - this.current.radius) * k;
    this.current.polar += (wanted.polar - this.current.polar) * k;
    let dAz = wanted.azimuth - this.current.azimuth;
    while (dAz > Math.PI) dAz -= Math.PI * 2;
    while (dAz < -Math.PI) dAz += Math.PI * 2;
    this.current.azimuth += dAz * k;
    this.apply(this.current);
  }

  private apply(view: View): void {
    const offset = new THREE.Vector3().setFromSphericalCoords(view.radius, view.polar, view.azimuth);
    this.camera.position.copy(view.target).add(offset);
    this.controls.target.copy(view.target);
    this.camera.lookAt(view.target);
  }

  private readBack(): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const s = new THREE.Spherical().setFromVector3(offset);
    this.current.target.copy(this.controls.target);
    this.current.radius = s.radius;
    this.current.polar = s.phi;
    this.current.azimuth = s.theta;
    this.focusView = null;
  }
}
