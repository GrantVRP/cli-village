// Brings the 3D village in line with the shared village state: robots walk to
// where their work is, busy buildings send up rings and smoke, problems glow
// red, the column shows health, and the camera visits the key moment.

import * as THREE from "three";
import { WAITING } from "../../src/events/explain.js";
import { harborLoad, isWalking, type AgentState, type VillageState } from "../../src/events/state.js";
import { BUILDINGS, type Building } from "../../src/events/types.js";
import { createBuildingModels, type BuildingModel } from "./buildings.js";
import type { CameraRig } from "./camera.js";
import { Column } from "./column.js";
import type { Effects } from "./effects.js";
import { Harbor } from "./harbor.js";
import { HARBOR, route, SPOTS, standPoint } from "./layout.js";
import type { BubbleMode, Overlay } from "./overlay.js";
import { P } from "./palette.js";
import { Robot } from "./robot.js";

const BUBBLE_MS = 4500;
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const shorten = (s: string, max = 56) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

interface RobotInfo {
  robot: Robot;
  said: string;
  saidAt: number;
  slotKey: string;
}

export class Village {
  readonly group = new THREE.Group();
  readonly column = new Column();
  readonly harbor = new Harbor();
  private readonly models: Record<Exclude<Building, "harbor">, BuildingModel>;
  private readonly anchors = {} as Record<Building, THREE.Object3D>;
  private readonly alarms = {} as Record<Building, THREE.PointLight>;
  private readonly timers = new Map<string, number>();
  private readonly robots = new Map<string, RobotInfo>();
  private state: VillageState | null = null;
  private lastHeadline = -1;
  private lastFocusAt = 0;
  /** After you click a building, the camera stays there for a while. */
  private pinnedUntil = 0;
  /** Still mode (--no-animation or reduced motion): robots appear where they're going, and the camera only moves when you ask. */
  still = false;
  /** What the caption suggests before any work arrives (the desktop app says where its terminal is). */
  waitingHint = WAITING;
  private fresh = false;
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly overlay: Overlay,
    private readonly effects: Effects,
    private readonly rig: CameraRig,
  ) {
    this.group.name = "village";
    this.models = createBuildingModels();
    for (const id of BUILDINGS) {
      const spot = SPOTS[id];
      if (id !== "harbor") {
        const model = this.models[id];
        model.group.position.copy(spot.pos);
        model.group.rotation.y = spot.rotY;
        model.group.userData.building = id;
        this.group.add(model.group);
      }
      // Label anchor above the building.
      const anchor = new THREE.Object3D();
      anchor.position.copy(id === "harbor" ? HARBOR.gate : spot.pos).setY(spot.labelY);
      this.group.add(anchor);
      this.anchors[id] = anchor;
      overlay.addLabel(id, anchor, (b) => this.select(b));
      // A red light that pulses when something here fails.
      const alarm = new THREE.PointLight(P.red, 0, 10, 1.3);
      alarm.position.copy(spot.pos).setY(3);
      this.alarms[id] = alarm;
      this.group.add(alarm);
    }
    this.harbor.group.userData.building = "harbor";
    this.group.add(this.harbor.group, this.column.group);
  }

  /** The page is about to catch up with everything that happened so far (it opened, or reconnected). */
  resync(): void {
    this.fresh = true;
  }

  /** Called whenever the village state changes. */
  sync(state: VillageState): void {
    this.state = state;
    const now = Date.now();
    // Catching up: put robots and the cart where they are now, instead of acting out the past.
    const fresh = this.fresh;
    this.fresh = false;
    const snap = this.still || fresh;

    // Group robots by where they're going, so each gets its own spot.
    const byBuilding = new Map<Building, AgentState[]>();
    for (const agent of Object.values(state.agents)) {
      const list = byBuilding.get(agent.location) ?? [];
      list.push(agent);
      byBuilding.set(agent.location, list);
    }

    let index = this.robots.size;
    for (const agent of Object.values(state.agents)) {
      let info = this.robots.get(agent.name);
      const group = byBuilding.get(agent.location)!;
      const slot = group.indexOf(agent);
      const dest = standPoint(agent.location, slot, group.length);
      const lookAt = agent.location === "home" ? new THREE.Vector3(0, 0, 0) : SPOTS[agent.location].pos;
      if (!info) {
        const robot = new Robot(agent.name, index++);
        robot.building = "home";
        robot.place(standPoint("home", slot >= 0 ? slot : 0, 5), new THREE.Vector3(0, 0, 0));
        this.group.add(robot.group);
        this.overlay.addBubble(agent.name, robot.bubbleAnchor);
        info = { robot, said: "", saidAt: 0, slotKey: "" };
        this.robots.set(agent.name, info);
      }
      const { robot } = info;
      const slotKey = `${agent.location}:${slot}:${group.length}`;
      if (snap && (robot.building !== agent.location || info.slotKey !== slotKey)) {
        robot.place(dest, lookAt);
        robot.building = agent.location;
      } else if (robot.building !== agent.location) {
        // Walk out along the path, around the column, and up to the new building.
        robot.walk(route(robot.group.position, robot.walking ? null : robot.building, agent.location, dest), lookAt);
        robot.building = agent.location;
      } else if (info.slotKey !== slotKey && !robot.walking) {
        robot.walk([robot.group.position.clone(), dest], lookAt);
      }
      info.slotKey = slotKey;
      robot.status = agent.status;

      // What the speech bubble says.
      const said =
        agent.status === "working" && agent.task
          ? `${lowerFirst(agent.task.title)}…`
          : agent.status === "failed"
            ? `✖ ${agent.say ?? "something went wrong"}`
            : (agent.say ?? "");
      if (said !== info.said) {
        info.said = said;
        info.saidAt = now;
      }
    }

    for (const id of BUILDINGS) {
      const b = state.buildings[id];
      this.overlay.setLabel(id, b.problem ? "problem" : b.working.length ? "active" : "idle");
    }

    this.column.setHealth(state.health);
    this.harbor.sync(harborLoad(state), state.stats.pushes, state.lastPush, fresh);
    const mode = document.body.dataset.mode ?? "";
    this.overlay.setStatus(state, mode);
    // Live, and nothing has happened yet: suggest something to try.
    const waiting = state.headline.seq === 0 && mode !== "" && mode !== "demo";
    this.overlay.setCaption(waiting ? { ...state.headline, ...this.waitingHint } : state.headline, waiting);
    this.overlay.updatePanel(state);

    // Camera: visit where the key message is happening.
    const h = state.headline;
    if (h.seq !== this.lastHeadline) {
      this.lastHeadline = h.seq;
      if (state.stopped) this.rig.reset();
      else if (h.building && now >= this.pinnedUntil && !this.still) {
        const since = now - this.lastFocusAt;
        if (h.level === "attention") {
          this.focusOn(h.building, 7000, 24);
          this.lastFocusAt = now;
        } else if (h.level === "active" && since > 2500) {
          this.focusOn(h.building, 4200, 30);
          this.lastFocusAt = now;
        }
      }
    }
  }

  /** Point the camera at a building's front. Tall ones (the Library, the Town Hall) need it further back to fit. */
  private focusOn(id: Building, holdMs: number, radius: number): void {
    const spot = SPOTS[id];
    const point = id === "harbor" ? HARBOR.gate : spot.pos;
    this.rig.focus(point, holdMs, Math.max(radius, spot.labelY * 3.3), spot.labelY * 0.33);
  }

  /** Back to the whole village (the h key). */
  unpin(): void {
    this.pinnedUntil = 0;
  }

  /** Click on a building: glide to it and show its log. */
  select(id: Building): void {
    this.look(id);
    if (this.state) this.overlay.openPanel(id, this.state);
  }

  /** Glide to a building and stay a while, without opening its log. */
  look(id: Building): void {
    this.focusOn(id, 12000, 24);
    this.pinnedUntil = Date.now() + 12000;
  }

  /** Which building (if any) is under the mouse. */
  pick(raycaster: THREE.Raycaster): Building | null {
    const hits = raycaster.intersectObjects([...Object.values(this.models).map((m) => m.group), this.harbor.group], true);
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object;
      while (node) {
        if (node.userData.building) return node.userData.building as Building;
        node = node.parent;
      }
    }
    return null;
  }

  /** Roughly where a robot's bubble lands on screen, in pixels. */
  private bubbleBox(robot: Robot, text: string): Box | null {
    const p = robot.bubbleAnchor.getWorldPosition(this.tmp).project(this.rig.camera);
    if (p.z > 1) return null; // behind the camera
    const x = (p.x * 0.5 + 0.5) * innerWidth;
    const y = (-p.y * 0.5 + 0.5) * innerHeight;
    const width = 40 + (robot.name.length + text.length) * 6.6;
    return { left: x - width / 2, right: x + width / 2, top: y - 28, bottom: y };
  }

  private every(key: string, seconds: number, dt: number): boolean {
    const left = (this.timers.get(key) ?? Math.random() * seconds) - dt;
    if (left <= 0) {
      this.timers.set(key, seconds * (0.8 + Math.random() * 0.4));
      return true;
    }
    this.timers.set(key, left);
    return false;
  }

  update(dt: number, t: number): void {
    const state = this.state;
    const now = Date.now();
    for (const id of BUILDINGS) {
      const b = state?.buildings[id];
      const active = Boolean(b?.working.length);
      const problem = Boolean(b?.problem);
      const spot = SPOTS[id];
      const center = id === "harbor" ? HARBOR.gate : spot.pos;
      if (id !== "harbor") {
        const model = this.models[id];
        model.update(dt, t, active, this.still);
        // Chimney smoke: always a little, more when busy.
        model.chimneys.forEach((c, i) => {
          if (this.every(`smoke-${id}-${i}`, active ? (id === "workshop" ? 0.18 : 0.3) : 0.8, dt)) {
            this.effects.puff(model.group.localToWorld(c.clone()), active);
          }
        });
        if (active && id === "lab") {
          for (const [i, f] of (model.extras.flasks ?? []).entries()) {
            if (this.every(`bubble-${i}`, 0.18, dt)) this.effects.bubble(model.group.localToWorld(f.clone()));
          }
        }
        if (active && id === "workshop" && this.every("sparks", 0.7, dt)) {
          const s = model.extras.sparks?.[0];
          if (s) this.effects.sparkBurst(model.group.localToWorld(s.clone()));
        }
      }
      // Rings rise from busy buildings; red ones where there's a problem.
      if (problem && this.every(`alarm-ring-${id}`, 0.9, dt)) this.effects.ring(center, spot.radius, P.red);
      else if (active && this.every(`ring-${id}`, 1.1, dt)) this.effects.ring(center, spot.radius);
      this.alarms[id].intensity = problem && id !== "harbor" ? 32 + Math.sin(t * 5) * 12 : 0; // the harbor has its own alarm
    }

    // Robots and their speech bubbles.
    const headlineAgent = state?.headline.agent;
    const wanted: { name: string; text: string; mode: BubbleMode; failed: boolean; saidAt: number; box: Box | null }[] = [];
    for (const [name, info] of this.robots) {
      info.robot.update(dt, t, this.effects.trailSink);
      const agent = state?.agents[name];
      let mode: BubbleMode = "hidden";
      if (info.said && agent) {
        if (name === headlineAgent && !state?.stopped) mode = "primary";
        else if (now - info.saidAt < BUBBLE_MS || (agent.status === "working" && !isWalking(agent, now))) mode = "secondary";
      }
      const text = shorten(info.said);
      wanted.push({ name, text, mode, failed: agent?.status === "failed", saidAt: info.saidAt, box: mode === "hidden" ? null : this.bubbleBox(info.robot, text) });
    }
    // Never let bubbles pile on top of each other: the key one wins, then the newest.
    wanted.sort((a, b) => (a.mode === "primary" ? -1 : b.mode === "primary" ? 1 : b.saidAt - a.saidAt));
    const placed: Box[] = [];
    for (const bubble of wanted) {
      let mode = bubble.mode;
      if (bubble.box) {
        if (mode === "secondary" && placed.some((p) => overlaps(p, bubble.box!))) mode = "hidden";
        else placed.push(bubble.box);
      }
      this.overlay.setBubble(bubble.name, bubble.text, mode, bubble.failed);
    }

    // Still mode: one big time step, so the column fills at once and the cart and boat go straight to where they end up.
    this.column.update(this.still ? 60 : dt, t);
    this.harbor.update(this.still ? 60 : dt, t);
  }
}
