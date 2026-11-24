// Moving decorations: rings rising from busy buildings, chimney smoke,
// robot trails, wind streaks, lab bubbles and anvil sparks. (Fireflies are in life.ts.)
// Everything is pooled (made once, reused) so nothing piles up.

import * as THREE from "three";
import { P } from "./palette.js";

interface Particle {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial | THREE.MeshStandardMaterial>;
  age: number;
  life: number;
  velocity: THREE.Vector3;
  size: number;
  active: boolean;
  data: number;
}

class Pool {
  private readonly items: Particle[] = [];
  constructor(
    parent: THREE.Object3D,
    count: number,
    make: () => THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial | THREE.MeshStandardMaterial>,
  ) {
    for (let i = 0; i < count; i++) {
      const mesh = make();
      mesh.visible = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      parent.add(mesh);
      this.items.push({ mesh, age: 0, life: 1, velocity: new THREE.Vector3(), size: 1, active: false, data: 0 });
    }
  }
  spawn(): Particle | null {
    const p = this.items.find((item) => !item.active);
    if (!p) return null;
    p.active = true;
    p.age = 0;
    p.mesh.visible = true;
    return p;
  }
  each(fn: (p: Particle) => boolean): void {
    for (const p of this.items) {
      if (!p.active) continue;
      if (!fn(p)) {
        p.active = false;
        p.mesh.visible = false;
      }
    }
  }
}

const additive = (color: number) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });

export class Effects {
  readonly group = new THREE.Group();
  private readonly rings: Pool;
  private readonly smoke: Pool;
  private readonly trails: THREE.InstancedMesh;
  private readonly trailAges: Float32Array;
  private readonly trailPos: THREE.Vector3[];
  private trailNext = 0;
  private readonly wind: Pool;
  private readonly bubbles: Pool;
  private readonly sparks: Pool;
  private windTimer = 2;
  /** 0 = day, 1 = night. */
  night = 0;
  /** How windy it is (1 = a breeze; render/life-rules.ts). Chimney smoke leans with it. */
  breeze = 1;
  /** How many hearth fires are lit, 0 to 1: smoke lasts longer in the evening and the cold. */
  fires = 0;
  /** Still mode (--no-animation or reduced motion): nothing drifts, rises or puffs. */
  still = false;

  constructor(private readonly camera: THREE.Camera) {
    this.group.name = "effects";
    const ringGeo = new THREE.RingGeometry(0.94, 1, 48).rotateX(-Math.PI / 2);
    this.rings = new Pool(this.group, 28, () => new THREE.Mesh(ringGeo, additive(P.glow)));

    const puffGeo = new THREE.IcosahedronGeometry(0.32, 0);
    this.smoke = new Pool(
      this.group,
      90,
      () =>
        new THREE.Mesh(
          puffGeo,
          new THREE.MeshStandardMaterial({ color: 0xf1efe8, flatShading: true, transparent: true, opacity: 0, depthWrite: false, roughness: 1 }),
        ),
    );

    // Trails: many small glowing dots that fade out (one draw call).
    const dot = new THREE.CircleGeometry(0.09, 6).rotateX(-Math.PI / 2);
    const count = 360;
    this.trails = new THREE.InstancedMesh(
      dot,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      count,
    );
    this.trails.frustumCulled = false;
    this.trailAges = new Float32Array(count).fill(99);
    this.trailPos = Array.from({ length: count }, () => new THREE.Vector3(0, -10, 0));
    const black = new THREE.Color(0);
    for (let i = 0; i < count; i++) this.trails.setColorAt(i, black);
    this.group.add(this.trails);

    // A long thin ellipse: thick in the middle, fading to points at both ends.
    const streakGeo = new THREE.CircleGeometry(1, 20).scale(2.3, 0.04, 1);
    this.wind = new Pool(this.group, 10, () => new THREE.Mesh(streakGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })));

    const bubbleGeo = new THREE.IcosahedronGeometry(0.05, 0);
    this.bubbles = new Pool(this.group, 40, () => new THREE.Mesh(bubbleGeo, additive(0xbfffe0)));
    const sparkGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
    this.sparks = new Pool(this.group, 40, () => new THREE.Mesh(sparkGeo, additive(0xffb050)));
  }

  /** A ring rising from a building (cyan when busy, red when there's a problem). */
  ring(at: THREE.Vector3, radius: number, color: number = P.glow): void {
    if (this.still) return;
    const p = this.rings.spawn();
    if (!p) return;
    p.mesh.position.copy(at).setY(0.15);
    p.size = radius;
    p.life = 2.6;
    p.mesh.material.color.set(color);
  }

  puff(at: THREE.Vector3, strong: boolean): void {
    if (this.still) return;
    const p = this.smoke.spawn();
    if (!p) return;
    p.mesh.position.copy(at);
    p.life = (strong ? 3.4 : 2.8) * (1 + 0.35 * this.fires);
    p.size = (strong ? 1.25 : 0.9) * (1 + 0.2 * this.fires);
    p.velocity.set((0.2 + Math.random() * 0.15) * this.breeze, 0.75 + Math.random() * 0.3, (Math.random() - 0.5) * 0.15);
    p.mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
  }

  bubble(at: THREE.Vector3): void {
    if (this.still) return;
    const p = this.bubbles.spawn();
    if (!p) return;
    p.mesh.position.copy(at);
    p.life = 1.1 + Math.random() * 0.5;
    p.data = Math.random() * 6;
  }

  sparkBurst(at: THREE.Vector3): void {
    if (this.still) return;
    for (let i = 0; i < 8; i++) {
      const p = this.sparks.spawn();
      if (!p) return;
      p.mesh.position.copy(at);
      p.life = 0.5 + Math.random() * 0.4;
      p.velocity.set((Math.random() - 0.5) * 2.2, 1.5 + Math.random() * 1.6, (Math.random() - 0.5) * 2.2);
    }
  }

  readonly trailSink = {
    spawn: (position: THREE.Vector3) => {
      if (this.still) return;
      const i = this.trailNext;
      this.trailNext = (this.trailNext + 1) % this.trailAges.length;
      this.trailAges[i] = 0;
      this.trailPos[i]!.copy(position).setY(0.2);
    },
  };

  update(dt: number, t: number): void {
    this.rings.each((p) => {
      p.age += dt;
      const k = p.age / p.life;
      p.mesh.position.y = 0.15 + k * 3.6;
      p.mesh.scale.setScalar(p.size * (0.85 + k * 0.45));
      p.mesh.material.opacity = Math.sin(Math.min(1, k) * Math.PI) * 0.75;
      return p.age < p.life;
    });

    this.smoke.each((p) => {
      p.age += dt;
      const k = p.age / p.life;
      p.mesh.position.addScaledVector(p.velocity, dt);
      // The higher it rises, the more the wind bends it over.
      p.mesh.position.x += dt * k * 0.6 * this.breeze;
      p.mesh.scale.setScalar(p.size * (0.4 + k * 1.3));
      p.mesh.rotation.y += dt * 0.4;
      p.mesh.material.opacity = (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85) * 0.8;
      return p.age < p.life;
    });

    // Trails fade from cyan to nothing.
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const cyan = new THREE.Color(P.glow);
    for (let i = 0; i < this.trailAges.length; i++) {
      const age = (this.trailAges[i]! += dt);
      const fade = Math.max(0, 1 - age / 1.6);
      m.makeScale(0.6 + fade * 0.6, 1, 0.6 + fade * 0.6).setPosition(this.trailPos[i]!);
      this.trails.setMatrixAt(i, m);
      this.trails.setColorAt(i, c.copy(cyan).multiplyScalar(fade * 0.9));
    }
    this.trails.instanceMatrix.needsUpdate = true;
    if (this.trails.instanceColor) this.trails.instanceColor.needsUpdate = true;

    // Wind: every few seconds, a gust of white streaks drifts across.
    if (!this.still) {
      this.windTimer -= dt;
      if (this.windTimer <= 0) {
        this.windTimer = 4 + Math.random() * 5;
        const y = 4 + Math.random() * 5;
        const z = -12 + Math.random() * 20;
        for (let i = 0; i < 3; i++) {
          const p = this.wind.spawn();
          if (!p) break;
          p.mesh.position.set(-34 - i * 3 - Math.random() * 4, y + i * 0.45, z + i * 0.8);
          p.life = 6 + Math.random() * 1.5;
          p.velocity.set(10 + Math.random() * 3, 0, 0);
          p.mesh.scale.set(0.6 + Math.random() * 0.8, 1, 1);
        }
      }
    }
    this.wind.each((p) => {
      p.age += dt;
      const k = p.age / p.life;
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.mesh.position.y += Math.sin(p.age * 1.5) * dt * 0.3;
      p.mesh.quaternion.copy(this.camera.quaternion);
      p.mesh.material.opacity = Math.sin(Math.min(1, k) * Math.PI) * 0.38 * (1 - this.night * 0.6);
      return p.age < p.life;
    });

    this.bubbles.each((p) => {
      p.age += dt;
      p.mesh.position.y += dt * 0.55;
      p.mesh.position.x += Math.sin(t * 8 + p.data) * dt * 0.08;
      p.mesh.material.opacity = (1 - p.age / p.life) * 0.9;
      return p.age < p.life;
    });

    this.sparks.each((p) => {
      p.age += dt;
      p.velocity.y -= 6 * dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.mesh.material.opacity = 1 - p.age / p.life;
      return p.age < p.life;
    });
  }
}
