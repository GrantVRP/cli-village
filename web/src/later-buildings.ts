// The four buildings added after the first seven: the Post office (reviews), the Launch tower
// (deploys), the Watchtower (monitoring) and the Archive well (data). Made from simple shapes in
// code, like the others (buildings.ts). Each faces +z in its own space; the village turns it to
// face the plaza.
//
// Each one takes its colour jitter and its details from random numbers of its own, so adding them
// moves nothing that was there before.

import * as THREE from "three";
import { attic, BASE, type BuildingModel, doorOn, glowMaterials, lanternOn, roof, steps, windowOn } from "./buildings.js";
import { wavingFlag } from "./flag.js";
import { addWindowBox } from "./flora.js";
import { makeRandom, materials, ModelBuilder, pick } from "./lowpoly.js";
import { P } from "./palette.js";

export type LaterBuilding = "postoffice" | "launchtower" | "watchtower" | "archive";

/** Warm colours for the new buildings, from the village's own palette family (nothing neon). */
const C = {
  plaster: 0xe6d3ab,
  plasterUpper: 0xd9bf94,
  postRed: 0x9c4a3c,
  postRedDark: 0x7a382e,
  paper: 0xf2eadb,
  paperShade: 0xd8cab0,
  towerCream: 0xebe2cf,
  towerBand: 0xb86a4e,
  copper: 0x5d968f,
  timber: 0x6b4a2f,
  timberLight: 0x8a6646,
  shingle: 0x7d6a4a,
  water: 0x29404c,
} as const;

/** A round log (or post) from one point to another. */
function log(b: ModelBuilder, from: THREE.Vector3, to: THREE.Vector3, radius: number, color: number, sides = 6): void {
  const dir = to.clone().sub(from);
  const length = dir.length();
  const mid = from.clone().add(to).multiplyScalar(0.5);
  const turn = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  b.add(new THREE.CylinderGeometry(radius * 0.88, radius, length, sides), color, { at: [mid.x, mid.y, mid.z], rot: [turn.x, turn.y, turn.z], jitter: 0.06 });
}

/** A lamp material of its own (so it can flare or flash alone), lit like the village's lanterns. */
function ownLantern(): THREE.MeshStandardMaterial {
  return glowMaterials.lantern.clone();
}

const smooth = (k: number) => k * k * (3 - 2 * k);
const clamp01 = (k: number) => Math.max(0, Math.min(1, k));

// ---------------------------------------------------------------------------
// Post office: reviews and messages. Letters fly in and out of the loft on its roof.
// ---------------------------------------------------------------------------

/** An envelope, about the size of a robot's hand: cream paper, a folded flap and a red seal. */
function envelope(): THREE.Group {
  const b = new ModelBuilder().useRandom(makeRandom(7301));
  b.box([0.34, 0.22, 0.025], C.paper, { jitter: 0.03 });
  for (const side of [-1, 1]) b.box([0.2, 0.016, 0.03], C.paperShade, { at: [side * 0.08, 0.045, 0.004], rot: [0, 0, side * 0.6] });
  b.box([0.05, 0.05, 0.035], C.postRed, { at: [0, -0.005, 0.01], rot: [0, 0, Math.PI / 4] });
  return b.build("letter");
}

function postoffice(): BuildingModel {
  const rng = makeRandom(7701);
  const b = new ModelBuilder().useRandom(rng);
  const w = 4.0;
  const d = 3.4;
  const h = 1.75;
  const front = d / 2;

  // Stone base, plastered ground floor, timber trim band, upper floor with timber corners.
  b.box([w + 0.3, BASE, d + 0.3], P.stoneDark, { at: [0, BASE / 2, 0], jitter: 0.07 });
  b.box([w, h, d], C.plaster, { at: [0, BASE + h / 2, 0], jitter: 0.03 });
  const trimY = BASE + h;
  b.box([w + 0.18, 0.16, d + 0.18], P.wood, { at: [0, trimY, 0] });
  const h2 = 1.15;
  const upperY = trimY + 0.08;
  const wallTop = upperY + h2;
  b.box([w, h2, d], C.plasterUpper, { at: [0, upperY + h2 / 2, 0], jitter: 0.03 });
  for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) b.box([0.15, h2, 0.15], P.wood, { at: [x, upperY + h2 / 2, z] });
  // Corner stones on the ground floor.
  for (const x of [-w / 2, w / 2]) {
    for (const z of [-d / 2, d / 2]) {
      for (let y = BASE + 0.12, k = 0; y < trimY - 0.2; y += 0.38, k++) {
        const long = k % 2 === 0;
        b.box([long ? 0.36 : 0.22, 0.26, long ? 0.22 : 0.36], pick([0xcdbf9f, 0xc2b392, 0xd6c9ab], rng), { at: [x + Math.sign(x) * 0.015, y + 0.15, z + Math.sign(z) * 0.015], jitter: 0.04 });
      }
    }
  }

  // Roof, with a little loft on the ridge where the letters come and go.
  const rise = d * 0.5;
  attic(b, w, d, rise, wallTop, C.plasterUpper);
  roof(b, { width: w + 0.55, depth: d, y: wallTop, rise, overhang: 0.45, rng });
  const ridge = wallTop + rise;
  const loftY = ridge + 0.05;
  b.box([0.95, 0.85, 0.95], C.plaster, { at: [0, loftY + 0.42, 0], jitter: 0.04 });
  for (const x of [-0.475, 0.475]) for (const z of [-0.475, 0.475]) b.box([0.09, 0.85, 0.09], P.wood, { at: [x, loftY + 0.42, z] });
  b.box([0.5, 0.55, 0.04], 0x2a241e, { at: [0, loftY + 0.42, 0.48] }); // the opening
  b.box([0.62, 0.06, 0.2], P.wood, { at: [0, loftY + 0.14, 0.55] }); // a ledge for landing
  b.add(new THREE.ConeGeometry(0.88, 0.62, 4), P.roof2, { at: [0, loftY + 1.16, 0], rot: [0, Math.PI / 4, 0], jitter: 0.08 });
  b.add(new THREE.SphereGeometry(0.07, 6, 4), P.brass, { at: [0, loftY + 1.52, 0], material: materials.metal });

  // Front: the door in the middle (where the path arrives), the counter window to its right, a
  // post box and a lantern to its left.
  b.push([0, BASE, front]);
  doorOn(b, C.postRed, 0.9, 1.55);
  b.pop();
  steps(b, front + 0.15, 1.3);
  const winX = 1.24;
  const winY = BASE + 0.95;
  const ww = 0.9;
  const wh = 0.95;
  b.box([ww, wh, 0.04], 0xffffff, { at: [winX, winY, front], material: glowMaterials.window });
  for (const y of [winY - wh / 2 - 0.04, winY + wh / 2 + 0.04]) b.box([ww + 0.16, 0.08, 0.12], P.wood, { at: [winX, y, front + 0.05] });
  for (const x of [winX - ww / 2 - 0.04, winX, winX + ww / 2 + 0.04]) b.box([x === winX ? 0.05 : 0.08, wh, 0.12], P.wood, { at: [x, winY, front + 0.05] });
  b.box([ww + 0.05, 0.03, 0.06], P.wood, { at: [winX, winY + 0.12, front + 0.04] });
  b.box([ww + 0.34, 0.07, 0.22], P.stone, { at: [winX, winY - wh / 2 - 0.11, front + 0.1] });
  // A striped awning over it.
  for (let i = 0; i < 5; i++) {
    const x = winX - 0.42 + i * 0.21;
    b.box([0.212, 0.04, 0.6], i % 2 ? C.paper : C.postRed, { at: [x, winY + wh / 2 + 0.3, front + 0.28], rot: [0.42, 0, 0], jitter: 0.03 });
  }
  b.box([1.08, 0.12, 0.04], C.postRed, { at: [winX, winY + wh / 2 + 0.11, front + 0.56], jitter: 0.03 });
  addWindowBox(b, winX, winY - wh / 2 - 0.02, front + 0.2, 0.85, makeRandom(7171));
  b.push([-0.9, BASE + 1.95, front]);
  lanternOn(b);
  b.pop();
  // The post box: a red pillar with a domed cap and a slot.
  const boxAt: [number, number, number] = [-1.5, 0, front + 0.45];
  b.add(new THREE.CylinderGeometry(0.2, 0.22, 0.12, 10), C.postRedDark, { at: [boxAt[0], 0.06, boxAt[2]] });
  b.add(new THREE.CylinderGeometry(0.19, 0.19, 0.82, 10), C.postRed, { at: [boxAt[0], 0.53, boxAt[2]], jitter: 0.03 });
  b.add(new THREE.CylinderGeometry(0.23, 0.23, 0.07, 10), C.postRedDark, { at: [boxAt[0], 0.96, boxAt[2]] });
  b.add(new THREE.SphereGeometry(0.2, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), C.postRed, { at: [boxAt[0], 0.99, boxAt[2]] });
  b.box([0.2, 0.035, 0.05], 0x231d18, { at: [boxAt[0], 0.78, boxAt[2] + 0.18] });

  // The sign on the upper floor: an envelope on a board.
  b.box([1.04, 0.66, 0.06], P.wood, { at: [0, upperY + h2 * 0.5, front + 0.03] });
  b.box([0.9, 0.52, 0.04], C.postRed, { at: [0, upperY + h2 * 0.5, front + 0.07] });
  b.box([0.6, 0.36, 0.03], C.paper, { at: [0, upperY + h2 * 0.5, front + 0.1] });
  for (const side of [-1, 1]) b.box([0.36, 0.035, 0.02], C.paperShade, { at: [side * 0.14, upperY + h2 * 0.5 + 0.08, front + 0.12], rot: [0, 0, side * 0.52] });
  // Upper windows either side of it, and on the back and the sides.
  for (const x of [-1.33, 1.33]) {
    b.push([x, upperY + h2 * 0.52, front]);
    windowOn(b, C.postRed);
    b.pop();
  }
  for (const x of [-1.0, 1.0]) {
    for (const y of [BASE + h * 0.56, upperY + h2 * 0.52]) {
      b.push([x, y, -front], Math.PI);
      windowOn(b, C.postRed);
      b.pop();
    }
  }
  b.push([w / 2, BASE + h * 0.56, 0], Math.PI / 2);
  windowOn(b, C.postRed);
  b.pop();
  for (const side of [-1, 1]) {
    b.push([side * (w / 2), upperY + h2 * 0.52, 0], (side * Math.PI) / 2);
    windowOn(b, C.postRed);
    b.pop();
  }
  // The village notice board (it used to stand on the plaza), on the left wall.
  b.push([-w / 2, 0, 0.1], -Math.PI / 2);
  b.box([1.7, 1.0, 0.06], P.wood, { at: [0, BASE + 0.95, 0.04] });
  b.box([1.56, 0.86, 0.04], P.woodLight, { at: [0, BASE + 0.95, 0.08] });
  b.box([1.9, 0.07, 0.34], P.roof2, { at: [0, BASE + 1.55, 0.15], rot: [0.25, 0, 0] });
  const notes: [number, number, number, number][] = [
    [-0.52, 0.18, 0.4, 0.3], [0.0, 0.14, 0.34, 0.4], [0.48, 0.2, 0.3, 0.28], [-0.3, -0.22, 0.44, 0.28], [0.36, -0.2, 0.32, 0.34],
  ];
  for (const [nx, ny, nw, nh] of notes) {
    b.box([nw, nh, 0.02], pick([C.paper, 0xf4f1ea, 0xe9d9a8], rng), { at: [nx, BASE + 0.95 + ny, 0.11], rot: [0, 0, (rng() - 0.5) * 0.2] });
  }
  b.pop();

  // Chimney on the back slope.
  const cx = w * 0.28;
  const cz = -d * 0.22;
  const ch = rise + 0.9;
  b.box([0.55, ch, 0.55], 0x9b6b52, { at: [cx, wallTop + ch / 2, cz], jitter: 0.1 });
  b.box([0.7, 0.15, 0.7], P.stoneDark, { at: [cx, wallTop + ch, cz] });
  const group = b.build("postoffice");

  // The letters: one flies out of the loft, or back in, every half second or so while there's a
  // review on, each on its own arc out over the village.
  const loft = new THREE.Vector3(0, loftY + 0.42, 0.55);
  const proto = envelope();
  const letters = Array.from({ length: 6 }, (_, i) => {
    const mesh = proto.clone();
    mesh.visible = false;
    group.add(mesh);
    return { mesh, k: -1, angle: 0, reach: 6, rise: 1.5, inbound: i % 2 === 1, spin: i * 1.7 };
  });
  let wait = 0;
  const FLIGHT = 2.8;
  return {
    id: "postoffice",
    group,
    chimneys: [new THREE.Vector3(cx, wallTop + ch + 0.22, cz)],
    extras: { loft: [loft.clone()] },
    update: (dt, t, active, still) => {
      wait -= dt;
      if (active && !still && wait <= 0) {
        const free = letters.find((l) => l.k < 0);
        if (free) {
          free.k = 0;
          // Mostly out to the front and the sides, where the village is.
          free.angle = (Math.random() - 0.5) * 2.6;
          free.reach = 5 + Math.random() * 3;
          free.rise = 1.1 + Math.random() * 0.9;
          free.inbound = !free.inbound;
          wait = 0.45 + Math.random() * 0.35;
        }
      }
      for (const l of letters) {
        if (l.k < 0 || still) {
          l.mesh.visible = false;
          if (still) l.k = -1;
          continue;
        }
        l.k += dt / FLIGHT;
        if (l.k >= 1) {
          l.k = -1;
          l.mesh.visible = false;
          continue;
        }
        const k = l.inbound ? 1 - l.k : l.k;
        const dx = Math.sin(l.angle);
        const dz = Math.cos(l.angle);
        l.mesh.visible = true;
        l.mesh.position.set(loft.x + dx * k * l.reach, loft.y + Math.sin(k * Math.PI * 0.85) * l.rise + k * 0.8, loft.z + dz * k * l.reach);
        // Small near the loft, full size in flight, gone far away.
        l.mesh.scale.setScalar(1.5 * (0.25 + 0.75 * smooth(clamp01(k * 5))) * smooth(clamp01((1 - k) * 4)) + 0.0001);
        l.mesh.rotation.set(0.35 + Math.sin(t * 7 + l.spin) * 0.25, l.angle + (l.inbound ? Math.PI : 0), Math.sin(t * 9 + l.spin) * 0.35);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Launch tower: deploys. Its beacon lights up, and a rocket goes up and bursts, when one ships.
// ---------------------------------------------------------------------------

function launchtower(): BuildingModel {
  const rng = makeRandom(8801);
  const b = new ModelBuilder().useRandom(rng);
  const foot = 0.45;
  const shaft = 7.0;
  const r0 = 1.2;
  const r1 = 0.92;
  const radiusAt = (y: number) => r0 + ((r1 - r0) * (y - foot)) / shaft;

  // A round stone plinth, then the shaft in bands of cream and terracotta, with stone courses.
  b.add(new THREE.CylinderGeometry(1.42, 1.5, foot, 12), P.stoneDark, { at: [0, foot / 2, 0], jitter: 0.07 });
  const bands = 4;
  for (let i = 0; i < bands; i++) {
    const y0 = foot + (i * shaft) / bands;
    const y1 = foot + ((i + 1) * shaft) / bands;
    b.add(new THREE.CylinderGeometry(radiusAt(y1), radiusAt(y0), y1 - y0, 12), i % 2 ? C.towerBand : C.towerCream, { at: [0, (y0 + y1) / 2, 0], jitter: 0.03 });
    if (i > 0) b.add(new THREE.CylinderGeometry(radiusAt(y0) + 0.05, radiusAt(y0) + 0.05, 0.1, 12), P.stone, { at: [0, y0, 0] });
  }
  // The door, its steps and a lantern beside it.
  const doorZ = radiusAt(foot + 0.8) - 0.02;
  b.push([0, foot, doorZ]);
  doorOn(b, P.teal, 0.78, 1.45);
  b.pop();
  steps(b, doorZ + 0.05, 1.2);
  b.push([0.72, foot + 1.75, radiusAt(foot + 1.75) - 0.18], 0.5);
  lanternOn(b);
  b.pop();
  // Small windows up the shaft, turning round it as the stairs inside climb.
  for (const [y, a] of [[3.2, 0], [4.6, 1.4], [5.9, -0.9], [3.9, -2.3], [5.3, 2.6]] as const) {
    const r = radiusAt(y) - 0.02;
    b.push([Math.sin(a) * r, y, Math.cos(a) * r], a);
    windowOn(b, P.teal, 0.3, 0.46);
    b.pop();
  }

  // The gallery: a stone ledge on corbels, with an iron railing round it.
  const top = foot + shaft;
  b.add(new THREE.CylinderGeometry(1.4, 1.22, 0.2, 14), P.stone, { at: [0, top + 0.1, 0], jitter: 0.05 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.box([0.14, 0.26, 0.26], P.stone, { at: [Math.sin(a) * (r1 + 0.1), top - 0.1, Math.cos(a) * (r1 + 0.1)], rot: [0, a, 0], jitter: 0.05 });
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    b.box([0.04, 0.55, 0.04], P.iron, { at: [Math.sin(a) * 1.3, top + 0.47, Math.cos(a) * 1.3], material: materials.metal });
  }
  b.add(new THREE.TorusGeometry(1.3, 0.03, 4, 24).rotateX(Math.PI / 2), P.iron, { at: [0, top + 0.74, 0], material: materials.metal });
  b.add(new THREE.TorusGeometry(1.3, 0.02, 4, 24).rotateX(Math.PI / 2), P.iron, { at: [0, top + 0.45, 0], material: materials.metal });

  // The lantern room: a low stone drum, glass all round with iron frames, a copper cap.
  b.add(new THREE.CylinderGeometry(0.78, 0.82, 0.4, 8), P.stone, { at: [0, top + 0.4, 0], jitter: 0.05 });
  const glassY = top + 0.6;
  const glassH = 1.0;
  b.add(new THREE.CylinderGeometry(0.66, 0.66, glassH, 8, 1, true), 0xffffff, { at: [0, glassY + glassH / 2, 0], material: glowMaterials.window });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    b.box([0.06, glassH, 0.06], P.iron, { at: [Math.sin(a) * 0.66, glassY + glassH / 2, Math.cos(a) * 0.66], material: materials.metal });
  }
  b.add(new THREE.CylinderGeometry(0.74, 0.74, 0.08, 8), P.iron, { at: [0, glassY + glassH + 0.04, 0], material: materials.metal });
  b.add(new THREE.ConeGeometry(0.86, 0.85, 8), C.copper, { at: [0, glassY + glassH + 0.5, 0], jitter: 0.07 });
  b.add(new THREE.SphereGeometry(0.1, 8, 6), P.brass, { at: [0, glassY + glassH + 0.98, 0], material: materials.metal });
  b.add(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 5), P.iron, { at: [0, glassY + glassH + 1.3, 0], material: materials.metal });
  b.box([0.5, 0.03, 0.03], P.iron, { at: [0, glassY + glassH + 1.45, 0], rot: [0, 0.6, 0], material: materials.metal });

  // The rocket's launch rail, on the gallery at the front right.
  const padX = 0.85;
  const padZ = 0.78;
  for (const dx of [-0.08, 0.08]) b.box([0.03, 0.95, 0.03], P.iron, { at: [padX + dx, top + 0.67, padZ], material: materials.metal });
  b.box([0.3, 0.05, 0.3], P.iron, { at: [padX, top + 0.22, padZ], material: materials.metal });
  const group = b.build("launchtower");

  // The beacon inside the lantern room.
  const beaconMat = ownLantern();
  const beacon = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), beaconMat);
  beacon.position.set(0, glassY + glassH * 0.5, 0);
  group.add(beacon);

  // The rocket: cream body, terracotta nose and fins.
  const rb = new ModelBuilder().useRandom(makeRandom(8802));
  rb.add(new THREE.CylinderGeometry(0.075, 0.085, 0.42, 8), C.towerCream, { at: [0, 0.21, 0] });
  rb.add(new THREE.ConeGeometry(0.075, 0.2, 8), C.towerBand, { at: [0, 0.52, 0] });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    rb.box([0.02, 0.16, 0.12], C.towerBand, { at: [Math.sin(a) * 0.1, 0.07, Math.cos(a) * 0.1], rot: [0, a, 0] });
  }
  const rocket = rb.build("rocket");
  const pad = new THREE.Vector3(padX, top + 0.27, padZ);
  rocket.position.copy(pad);
  group.add(rocket);

  // Sparks: the rocket's trail and its burst (one draw call).
  const SPARKS = 96;
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const sparks = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.13, 0), sparkMat, SPARKS);
  sparks.frustumCulled = false;
  const sp = Array.from({ length: SPARKS }, () => ({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), age: 99, life: 1, color: new THREE.Color() }));
  const burstColors = [0xffd27a, 0xffb27a, 0xf6b0a0, 0xfff1d0].map((c) => new THREE.Color(c));
  const trailColor = new THREE.Color(0xffc878);
  let nextSpark = 0;
  const spark = (at: THREE.Vector3, vel: THREE.Vector3, life: number, color: THREE.Color) => {
    const s = sp[nextSpark]!;
    nextSpark = (nextSpark + 1) % SPARKS;
    s.pos.copy(at);
    s.vel.copy(vel);
    s.age = 0;
    s.life = life;
    s.color.copy(color);
  };
  const m = new THREE.Matrix4();
  const shade = new THREE.Color();
  const hide = () => {
    for (let i = 0; i < SPARKS; i++) {
      m.makeScale(0, 0, 0);
      sparks.setMatrixAt(i, m);
      sparks.setColorAt(i, shade.setRGB(0, 0, 0));
    }
  };
  hide();
  group.add(sparks);

  // A soft flash where it bursts.
  const flash = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 1), new THREE.MeshBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  flash.visible = false;
  group.add(flash);
  let flashAge = 99;

  let flare = 0;
  let flight = -1;
  let still = false;
  let trailTimer = 0;
  const RISE = 1.15;
  const HEIGHT = 7;
  return {
    id: "launchtower",
    group,
    chimneys: [],
    extras: { beacon: [beacon.position.clone()] },
    cue: (what) => {
      if (what !== "done") return;
      flare = 1;
      if (!still && (flight < 0 || flight > 3.5)) flight = 0;
    },
    update: (dt, t, active, isStill) => {
      still = isStill;
      flare = Math.max(0, flare - dt / 7);
      // The beacon: lit like the lanterns, brighter while a deploy runs, and blazing when one ships.
      const busy = active ? (still ? 0.8 : 0.6 + 0.35 * Math.sin(t * 2.6)) : 0;
      beaconMat.emissiveIntensity = glowMaterials.lantern.emissiveIntensity * 0.9 + busy + smooth(flare) * 7;
      beacon.rotation.y = still ? 0 : t * 0.6;

      if (still && flight >= 0) flight = -1;
      if (flight >= 0) {
        flight += dt;
        if (flight < RISE) {
          const k = flight / RISE;
          const lift = 1 - Math.pow(1 - k, 2.2);
          rocket.visible = true;
          rocket.scale.setScalar(1);
          rocket.position.set(pad.x + Math.sin(flight * 13) * 0.03, pad.y + lift * HEIGHT, pad.z);
          trailTimer -= dt;
          if (trailTimer <= 0) {
            trailTimer = 0.025;
            spark(rocket.position, new THREE.Vector3((Math.random() - 0.5) * 0.3, -0.6, (Math.random() - 0.5) * 0.3), 0.55, trailColor);
          }
        } else if (rocket.visible && flight < RISE + 0.1) {
          // The burst: a ball of warm sparks that drift down and fade.
          rocket.visible = false;
          const at = rocket.position.clone();
          for (let i = 0; i < 64; i++) {
            const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.45, Math.random() - 0.5).normalize();
            spark(at, dir.multiplyScalar(3.6 + Math.random() * 1.4), 1.9 + Math.random() * 0.8, pick(burstColors, Math.random));
          }
          flash.position.copy(at);
          flashAge = 0;
        } else if (flight > 4) {
          // A new rocket on the rail, fading up into place.
          const k = clamp01((flight - 4) / 0.6);
          rocket.visible = true;
          rocket.position.copy(pad);
          rocket.scale.setScalar(Math.max(0.001, smooth(k)));
          if (k >= 1) flight = -1;
        }
      } else {
        rocket.visible = true;
        rocket.position.copy(pad);
        rocket.scale.setScalar(1);
      }

      flashAge += dt;
      flash.visible = flashAge < 0.45;
      if (flash.visible) {
        const k = flashAge / 0.45;
        flash.scale.setScalar(0.6 + k * 1.6);
        flash.material.opacity = (1 - k) * 0.85;
      }
      let any = false;
      for (let i = 0; i < SPARKS; i++) {
        const s = sp[i]!;
        if (s.age >= s.life) {
          m.makeScale(0, 0, 0);
          sparks.setMatrixAt(i, m);
          continue;
        }
        any = true;
        s.age += dt;
        s.vel.y -= dt * 2.2;
        s.vel.multiplyScalar(1 - dt * 1.1);
        s.pos.addScaledVector(s.vel, dt);
        const fade = clamp01(1 - s.age / s.life);
        const size = 0.5 + fade * 0.7;
        m.makeScale(size, size, size).setPosition(s.pos);
        sparks.setMatrixAt(i, m);
        sparks.setColorAt(i, shade.copy(s.color).multiplyScalar(fade * 1.4));
      }
      sparks.visible = any;
      sparks.instanceMatrix.needsUpdate = true;
      if (sparks.instanceColor) sparks.instanceColor.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------------------
// Watchtower: logs, alerts and monitoring. A timber lookout; its lantern flashes on a warning.
// ---------------------------------------------------------------------------

function watchtower(): BuildingModel {
  const rng = makeRandom(9901);
  const b = new ModelBuilder().useRandom(rng);
  const deck = 5.4;
  const foot = 1.0;
  const head = 0.78;
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  // Stone footings, then four splayed log legs.
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      b.box([0.5, 0.3, 0.5], P.stoneDark, { at: [x * foot, 0.15, z * foot], rot: [0, rng() * 0.3, 0], jitter: 0.08 });
      log(b, V(x * foot, 0.25, z * foot), V(x * head, deck + 0.05, z * head), 0.13, C.timber);
    }
  }
  // Cross braces on all four sides, at two heights, and a ring of beams under the deck.
  const legAt = (x: number, z: number, y: number) => {
    const k = (y - 0.25) / (deck - 0.2);
    const r = foot + (head - foot) * k;
    return V(x * r, y, z * r);
  };
  const sides: [number, number, number, number][] = [
    [-1, 1, 1, 1],
    [1, 1, 1, -1],
    [1, -1, -1, -1],
    [-1, -1, -1, 1],
  ];
  for (const [ax, az, bx, bz] of sides) {
    for (const [y0, y1] of [[0.6, 2.9], [2.9, 5.0]] as const) {
      // (Not across the front's top half: the ladder climbs there.)
      const frontSide = az === 1 && bz === 1;
      if (frontSide && y0 > 1) continue;
      log(b, legAt(ax, az, y0), legAt(bx, bz, y1), 0.06, C.timberLight, 5);
      log(b, legAt(bx, bz, y0), legAt(ax, az, y1), 0.06, C.timberLight, 5);
    }
    log(b, legAt(ax, az, 2.9), legAt(bx, bz, 2.9), 0.065, C.timber, 5);
  }
  // The ladder, up the front.
  const ladderFoot = 1.55;
  const ladderTop = head + 0.1;
  for (const x of [-0.26, 0.26]) log(b, V(x, 0, ladderFoot), V(x, deck + 0.9, ladderTop - 0.05), 0.04, C.timberLight, 5);
  for (let y = 0.3; y < deck + 0.5; y += 0.36) {
    const z = ladderFoot + ((ladderTop - ladderFoot) * y) / (deck + 0.9);
    b.box([0.56, 0.04, 0.05], C.timberLight, { at: [0, y, z] });
  }
  // The deck, with low plank walls round it (open where the ladder comes up) and posts to the roof.
  const half = 1.05;
  b.box([half * 2 + 0.1, 0.14, half * 2 + 0.1], P.woodLight, { at: [0, deck + 0.07, 0] });
  for (const z of [-0.6, 0, 0.6]) b.box([half * 2 + 0.2, 0.12, 0.14], C.timber, { at: [0, deck - 0.06, z] });
  const wallH = 0.72;
  for (const [x, z, rotY, len] of [
    [0, -half, 0, half * 2],
    [-half, 0, Math.PI / 2, half * 2],
    [half, 0, Math.PI / 2, half * 2],
  ] as const) {
    b.push([x, deck + 0.14, z], rotY);
    for (let p = -len / 2 + 0.09; p < len / 2; p += 0.19) b.box([0.17, wallH, 0.05], pick([P.woodLight, C.timberLight, 0x76603f], rng), { at: [p, wallH / 2, 0] });
    b.box([len + 0.1, 0.07, 0.12], C.timber, { at: [0, wallH + 0.03, 0] });
    b.pop();
  }
  for (const x of [-1, 1]) {
    b.push([x * 0.68, deck + 0.14, half], 0);
    for (let p = -0.29; p < 0.32; p += 0.19) b.box([0.17, wallH, 0.05], pick([P.woodLight, C.timberLight], rng), { at: [p, wallH / 2, 0] });
    b.box([0.72, 0.07, 0.12], C.timber, { at: [0, wallH + 0.03, 0] });
    b.pop();
  }
  const roofY = deck + 2.0;
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.box([0.12, roofY - deck, 0.12], C.timber, { at: [x * (half - 0.04), deck + (roofY - deck) / 2, z * (half - 0.04)] });
  for (const z of [-1, 1]) b.box([half * 2 + 0.1, 0.1, 0.12], C.timber, { at: [0, roofY, z * (half - 0.04)] });
  for (const x of [-1, 1]) b.box([0.12, 0.1, half * 2 + 0.1], C.timber, { at: [x * (half - 0.04), roofY, 0] });
  // A shingled pyramid roof in two layers, a finial and a pennant.
  b.add(new THREE.ConeGeometry(1.75, 0.5, 4, 1, true), C.shingle, { at: [0, roofY + 0.28, 0], rot: [0, Math.PI / 4, 0], jitter: 0.08 });
  b.add(new THREE.ConeGeometry(1.4, 1.2, 4), P.roof2, { at: [0, roofY + 0.85, 0], rot: [0, Math.PI / 4, 0], jitter: 0.08 });
  b.add(new THREE.CylinderGeometry(0.03, 0.035, 1.1, 5), P.iron, { at: [0, roofY + 1.9, 0], material: materials.metal });
  // A few logs stacked at its foot.
  for (const [lx, ly, lz] of [[-1.15, 0.13, -0.1], [-1.15, 0.13, 0.18], [-1.15, 0.36, 0.04]] as const) {
    b.add(new THREE.CylinderGeometry(0.13, 0.13, 1.0, 7), C.timberLight, { at: [lx - 0.35, ly, lz - 0.55], rot: [Math.PI / 2, 0, 0.1], jitter: 0.08 });
  }
  const group = b.build("watchtower");

  const pennant = wavingFlag(0.62, 0.3, P.teal);
  pennant.mesh.position.set(0.03, roofY + 2.3, 0);
  group.add(pennant.mesh);

  // The lantern, hung under the roof at the front.
  const lampMat = ownLantern();
  const lamp = new THREE.Group();
  lamp.position.set(0, roofY - 0.08, half - 0.15);
  const lb = new ModelBuilder().useRandom(makeRandom(9902));
  lb.box([0.03, 0.3, 0.03], P.iron, { at: [0, -0.15, 0], material: materials.metal });
  lb.box([0.24, 0.05, 0.24], P.iron, { at: [0, -0.32, 0], material: materials.metal });
  lb.add(new THREE.ConeGeometry(0.16, 0.12, 4), P.iron, { at: [0, -0.28, 0], rot: [0, Math.PI / 4, 0], material: materials.metal });
  lb.box([0.24, 0.04, 0.24], P.iron, { at: [0, -0.62, 0], material: materials.metal });
  for (const x of [-0.11, 0.11]) for (const z of [-0.11, 0.11]) lb.box([0.025, 0.28, 0.025], P.iron, { at: [x, -0.48, z], material: materials.metal });
  lamp.add(lb.build("watch-lantern"));
  const flame = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.24, 0.17), lampMat);
  flame.position.set(0, -0.47, 0);
  lamp.add(flame);
  group.add(lamp);

  // The lookout's spyglass on a stand, at the back of the deck: it sweeps the land while watching.
  const glass = new THREE.Group();
  glass.position.set(0, deck + 0.14, -0.55);
  const gb = new ModelBuilder().useRandom(makeRandom(9903));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    gb.add(new THREE.CylinderGeometry(0.02, 0.025, 1.0, 5), C.timber, { at: [Math.sin(a) * 0.14, 0.46, Math.cos(a) * 0.14], rot: [Math.cos(a) * 0.28, 0, -Math.sin(a) * 0.28] });
  }
  glass.add(gb.build("spyglass-stand"));
  const tube = new ModelBuilder()
    .useRandom(makeRandom(9904))
    .add(new THREE.CylinderGeometry(0.06, 0.08, 0.7, 8), P.brass, { at: [0, 0, 0], rot: [Math.PI / 2, 0, 0], material: materials.metal })
    .add(new THREE.CylinderGeometry(0.085, 0.085, 0.08, 8), P.brassDark, { at: [0, 0, 0.3], rot: [Math.PI / 2, 0, 0], material: materials.metal })
    .build("spyglass");
  tube.position.set(0, 0.98, 0);
  tube.rotation.x = -0.12;
  glass.add(tube);
  group.add(glass);

  const calm = new THREE.Color(P.warmLight);
  const warn = new THREE.Color(0xffa24a);
  let look = 0;
  return {
    id: "watchtower",
    group,
    chimneys: [],
    extras: { lantern: [lamp.position.clone().setY(lamp.position.y - 0.47)] },
    update: (dt, t, active, still, problem) => {
      pennant.update(dt, still, active);
      // The lantern: a warm light at night; on a warning it flashes amber (steady in still mode).
      const base = glowMaterials.lantern.emissiveIntensity;
      const flash = problem ? (still ? 3 : 1.2 + 4.5 * Math.pow(0.5 + 0.5 * Math.sin(t * 5.5), 3)) : 0;
      lampMat.emissiveIntensity = base + flash;
      lampMat.emissive.copy(problem ? warn : calm);
      lampMat.color.copy(problem ? warn : calm);
      lamp.rotation.z = still ? 0 : Math.sin(t * 1.3) * (problem ? 0.05 : 0.025);
      // The spyglass sweeps the land while there's watching to do, and rests when not.
      const target = active && !still ? Math.sin(t * 0.45) * 1.1 : 0;
      look += (target - look) * (still ? 1 : Math.min(1, dt * 1.5));
      glass.rotation.y = look;
    },
  };
}

// ---------------------------------------------------------------------------
// Archive well: data. Robots wind a bucket down into the well, and records come up in it.
// ---------------------------------------------------------------------------

function archive(): BuildingModel {
  const rng = makeRandom(1101);
  const b = new ModelBuilder().useRandom(rng);
  // A paved round step, the well's stone ring (its inside turned inward, so it shows), coping
  // stones round the rim, and dark water far down.
  b.add(new THREE.CylinderGeometry(1.55, 1.62, 0.14, 16), P.stone, { at: [0, 0.07, 0], jitter: 0.06 });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.1;
    b.box([0.5, 0.03, 0.3], pick([P.stone, P.stoneDark, 0xb3ad9f], rng), { at: [Math.sin(a) * 1.34, 0.15, Math.cos(a) * 1.34], rot: [0, a, 0] });
  }
  const R = 1.0;
  const rimY = 0.92;
  b.add(new THREE.CylinderGeometry(R, R + 0.06, rimY, 16, 1, true), P.stone, { at: [0, rimY / 2, 0], jitter: 0.08 });
  b.add(new THREE.CylinderGeometry(R - 0.22, R - 0.22, rimY + 0.6, 16, 1, true).scale(-1, 1, 1), P.stoneDark, { at: [0, rimY / 2 - 0.3, 0], jitter: 0.06 });
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 10; i++) {
      const a = ((i + (row % 2) * 0.5) / 10) * Math.PI * 2;
      b.box([0.5, 0.24, 0.12], pick([P.stone, P.stoneDark, 0xb2ab9c, 0x958f82], rng), { at: [Math.sin(a) * (R + 0.04), 0.17 + row * 0.27, Math.cos(a) * (R + 0.04)], rot: [0, a, 0], jitter: 0.05 });
    }
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.box([0.5, 0.14, 0.3], pick([P.stone, 0xb3ad9f], rng), { at: [Math.sin(a) * (R - 0.08), rimY + 0.06, Math.cos(a) * (R - 0.08)], rot: [0, a, 0], jitter: 0.05 });
  }
  b.add(new THREE.CircleGeometry(R - 0.22, 16).rotateX(-Math.PI / 2), C.water, { at: [0, -0.2, 0], jitter: 0.02 });

  // The well-house: two stout posts on stone feet, a beam, and a shingled roof.
  const postX = 1.12;
  const beamY = 2.25;
  for (const x of [-postX, postX]) {
    b.box([0.34, 0.3, 0.34], P.stoneDark, { at: [x, 0.3, 0], jitter: 0.08 });
    b.box([0.18, beamY - 0.3, 0.18], P.wood, { at: [x, 0.3 + (beamY - 0.3) / 2, 0] });
    for (const side of [-1, 1]) log(b, new THREE.Vector3(x, beamY - 0.55, 0), new THREE.Vector3(x, beamY - 0.06, side * 0.42), 0.045, P.wood, 5);
  }
  b.box([postX * 2 + 0.4, 0.16, 0.18], P.wood, { at: [0, beamY + 0.02, 0] });
  b.box([postX * 2 + 0.2, 0.08, 0.95], P.wood, { at: [0, beamY + 0.12, 0] });
  const roofRise = 0.75;
  attic(b, postX * 2 + 0.2, 0.95, roofRise * 0.55, beamY + 0.16, P.woodLight);
  roof(b, { width: postX * 2 + 0.75, depth: 1.5, y: beamY + 0.1, rise: roofRise, overhang: 0.25, rng });
  // The crank on the left post (seen from the plaza it's on the right, where the villager who
  // draws water stands).
  const axleY = 1.45;
  b.add(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6), P.iron, { at: [-(postX + 0.2), axleY, 0], rot: [0, 0, Math.PI / 2], material: materials.metal });
  // Record chests by the other post: the archive's ledgers, kept dry under a lid.
  for (const [x, z, s, turn] of [[1.55, -0.45, 1, -0.3], [1.6, 0.35, 0.85, 0.2]] as const) {
    b.push([x, 0, z], turn);
    b.box([0.62 * s, 0.4 * s, 0.42 * s], P.woodLight, { at: [0, 0.2 * s + 0.14, 0], jitter: 0.06 });
    b.box([0.66 * s, 0.08 * s, 0.46 * s], P.wood, { at: [0, 0.42 * s + 0.14, 0] });
    for (const bx of [-0.22, 0.22]) b.box([0.05, 0.42 * s, 0.44 * s], P.iron, { at: [bx * s, 0.21 * s + 0.14, 0], material: materials.metal });
    b.box([0.1, 0.08, 0.03], P.brass, { at: [0, 0.32 * s + 0.14, 0.22 * s], material: materials.metal });
    b.pop();
  }
  // A small stack of ledgers on the bigger chest.
  for (let i = 0; i < 3; i++) {
    b.box([0.3, 0.07, 0.22], pick([0x7a3e32, 0x3f5a4e, 0x5b4a7a, 0x8a6a3a], rng), { at: [1.55 + (rng() - 0.5) * 0.04, 0.61 + i * 0.07, -0.45], rot: [0, -0.3 + (rng() - 0.5) * 0.4, 0] });
  }
  const group = b.build("archive");

  // The windlass (it turns), its crank, the rope and the bucket.
  const drum = new THREE.Group();
  drum.position.set(0, axleY, 0);
  const db = new ModelBuilder().useRandom(makeRandom(1102));
  db.add(new THREE.CylinderGeometry(0.13, 0.13, postX * 2 - 0.1, 8), P.woodLight, { rot: [0, 0, Math.PI / 2], jitter: 0.05 });
  for (const x of [-0.2, 0, 0.2]) db.add(new THREE.CylinderGeometry(0.15, 0.15, 0.08, 8), 0xd8c8a0, { at: [x, 0, 0], rot: [0, 0, Math.PI / 2] });
  db.box([0.05, 0.42, 0.06], P.iron, { at: [-(postX + 0.34), -0.18, 0], material: materials.metal });
  db.add(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 6), P.wood, { at: [-(postX + 0.42), -0.36, 0], rot: [0, 0, Math.PI / 2] });
  drum.add(db.build("windlass"));
  group.add(drum);

  const rope = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1, 0.03).translate(0, -0.5, 0), new THREE.MeshStandardMaterial({ color: 0xd8c8a0, flatShading: true, roughness: 1 }));
  rope.position.set(0, axleY - 0.13, 0.13);
  group.add(rope);
  const bucket = new THREE.Group();
  const bb = new ModelBuilder().useRandom(makeRandom(1103));
  bb.add(new THREE.CylinderGeometry(0.2, 0.15, 0.3, 8), P.woodLight, { at: [0, 0.15, 0], jitter: 0.06 });
  for (const y of [0.05, 0.25]) bb.add(new THREE.TorusGeometry(0.18 - y * 0.12, 0.016, 3, 8).rotateX(Math.PI / 2), P.iron, { at: [0, y, 0], material: materials.metal });
  bb.add(new THREE.TorusGeometry(0.2, 0.012, 3, 10, Math.PI), P.iron, { at: [0, 0.3, 0], material: materials.metal });
  // What comes up: a rolled record, tied with a ribbon.
  bb.add(new THREE.CylinderGeometry(0.05, 0.05, 0.34, 7), C.paper, { at: [0.02, 0.34, 0], rot: [0.3, 0, 0.9] });
  bb.add(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 7), C.postRed, { at: [0.02, 0.34, 0], rot: [0.3, 0, 0.9] });
  bucket.add(bb.build("bucket"));
  group.add(bucket);

  const TOP = 1.02; // the bucket's bottom, resting just above the rim
  const DEEP = -1.3; // and down out of sight
  const CYCLE = 5.2;
  let run = 0;
  let depth = 0; // 0 = at the top, 1 = at the bottom
  return {
    id: "archive",
    group,
    chimneys: [],
    extras: { well: [new THREE.Vector3(0, rimY, 0)] },
    update: (dt, _t, active, still) => {
      // While there's data work: down, wait, up, wait. Otherwise the bucket finishes its trip
      // and rests at the top.
      let want = 0;
      if (active && !still) {
        run = (run + dt) % CYCLE;
        const k = run / CYCLE;
        want = k < 0.36 ? smooth(k / 0.36) : k < 0.48 ? 1 : k < 0.86 ? 1 - smooth((k - 0.48) / 0.38) : 0;
      } else if (still) {
        run = 0;
      } else if (depth > 0.001) {
        run = 0;
        want = Math.max(0, depth - dt / 1.6);
      }
      const before = depth;
      depth = still ? 0 : want;
      const y = TOP + (DEEP - TOP) * depth;
      bucket.position.set(0, y, 0.13);
      bucket.rotation.y = still ? 0 : Math.sin(y * 3) * 0.3;
      rope.scale.y = Math.max(0.01, axleY - 0.13 - (y + 0.3));
      // The drum turns with the rope (0.15 is its radius).
      drum.rotation.x += ((depth - before) * (TOP - DEEP)) / 0.15;
    },
  };
}

export function createLaterModels(): Record<LaterBuilding, BuildingModel> {
  return {
    postoffice: postoffice(),
    launchtower: launchtower(),
    watchtower: watchtower(),
    archive: archive(),
  };
}

