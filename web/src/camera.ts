// The camera: a high, narrow (35°) view like looking down at a tabletop.
// It orbits slowly on its own, glides toward the building where the most
// important thing is happening, then eases back out. Drag to orbit and
// scroll to zoom at any time; it waits a few seconds before taking over again.

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

  constructor(
    dom: HTMLElement,
    private readonly reducedMotion: boolean,
  ) {
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.5, 400);
    this.controls = new OrbitControls(this.camera, dom);
    this.controls.enableDamping = true;
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

  /** Glide toward a spot for a while, then come back out. */
  focus(point: THREE.Vector3, holdMs: number, radius = 30): void {
    const dir = point.clone().setY(0);
    // Look at the spot from the plaza side, so the building's front is visible.
    const azimuth = dir.lengthSq() > 1 ? Math.atan2(dir.x, dir.z) * 0.35 : this.current.azimuth;
    this.focusView = { target: point.clone().setY(1.2), radius, polar: 0.82, azimuth };
    this.focusUntil = performance.now() + holdMs;
  }

  /** Jump to the default view right away. */
  reset(): void {
    this.focusView = null;
    this.userUntil = 0;
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

    if (!this.reducedMotion) this.orbitClock += dt;
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
    const k = 1 - Math.exp(-dt * (this.reducedMotion ? 6 : 1.4));
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
