// Dynamic layer: survivors, infected, routes, target rings, fog of war and world-anchored labels.
// Reads the simulation state; never writes to it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GameState, NodeId, Survivor } from '../sim/types';
import { NODE, NODES, EDGES } from '../sim/world';
import { stockTotal, survivorPos, threatPos, zoneOf } from '../sim/core';
import { fmtTime, MODE_LABEL, ORDER_COLOR } from '../sim/text';
import { objectiveStatus } from '../sim/missions';
import type { Stage } from './scene';
import type { City } from './city';
import { GROUND, makeDash } from './textures';

export interface UiView {
  selected: string | null;
  targets: NodeId[];
  chosen: NodeId | null;
  /** Order being composed, and the selected survivor's current order: they set the colours. */
  orderType?: string | null;
  activeType?: string | null;
  /** Polyline of the order being previewed. */
  route: [number, number][] | null;
  /** Polyline of the selected survivor's current order. */
  activeRoute: [number, number][] | null;
}

function colored(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex);
  const n = ng.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  ng.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return ng;
}

interface Look {
  jacket: number;
  pants?: number;
  skin?: number;
  pack?: number | null;
  hunched?: boolean;
  hair?: number;
  ponytail?: boolean;
  hat?: number;
  hood?: number;
  /** Shoulder width multiplier. */
  wide?: number;
  stripes?: boolean;
  tool?: boolean;
  satchel?: number;
  scale?: number;
}

interface FigureParts {
  core: THREE.BufferGeometry;
  /** Limbs are modelled hanging from their pivot (hip or shoulder) at the origin. */
  leg: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;
  hipX: number;
  hipY: number;
  shoulderX: number;
  shoulderY: number;
}

/** Rounded low-poly character, split so limbs can swing. Readable from far, holds up when zoomed in. */
function figureParts(l: Look): FigureParts {
  const pants = l.pants ?? 0x2a2e33;
  const skin = l.skin ?? 0xd0a988;
  const w = l.wide ?? 1;
  const hz = l.hunched ? 0.1 : 0;
  const box = (bw: number, bh: number, bd: number, x: number, y: number, z: number, c: number) => colored(new THREE.BoxGeometry(bw, bh, bd).translate(x, y, z), c);
  const cap = (r: number, len: number, x: number, y: number, z: number, c: number, sx = 1, sz = 1) => colored(new THREE.CapsuleGeometry(r, len, 3, 8).scale(sx, 1, sz).translate(x, y, z), c);
  const ball = (r: number, x: number, y: number, z: number, c: number) => colored(new THREE.SphereGeometry(r, 10, 8).translate(x, y, z), c);
  const headZ = l.hunched ? 0.18 : 0;
  const dark = new THREE.Color(l.jacket).multiplyScalar(0.7).getHex();
  const core = [
    cap(0.27, 0.34, 0, 1.24, hz, l.jacket, 1.18 * w, 0.78), // torso
    cap(0.24, 0.05, 0, 0.9, 0, pants, 1.1 * w, 0.8), // hips
    box(0.4 * w, 0.07, 0.3, 0, 0.98, 0.02, 0x1c1c1e), // belt
    box(0.3, 0.1, 0.06, 0, 1.56, 0.2 + hz, dark), // collar
    colored(new THREE.CylinderGeometry(0.085, 0.1, 0.14, 8).translate(0, 1.64, headZ * 0.6), skin), // neck
    ball(0.235, 0, 1.87, headZ, skin),
    ball(0.032, -0.085, 1.9, headZ + 0.215, 0x1b1410), // eyes
    ball(0.032, 0.085, 1.9, headZ + 0.215, 0x1b1410),
    box(0.05, 0.07, 0.05, 0, 1.84, headZ + 0.225, new THREE.Color(skin).multiplyScalar(0.88).getHex()), // nose
  ];
  if (l.hair !== undefined) core.push(colored(new THREE.SphereGeometry(0.25, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 1.89, headZ - 0.02), l.hair), box(0.44, 0.3, 0.12, 0, 1.84, headZ - 0.19, l.hair));
  if (l.ponytail) core.push(cap(0.07, 0.3, 0, 1.68, -0.3, l.hair ?? 0x2b1d16));
  if (l.hat !== undefined) core.push(colored(new THREE.SphereGeometry(0.265, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5).translate(0, 1.9, headZ), l.hat), colored(new THREE.CylinderGeometry(0.27, 0.27, 0.09, 12).translate(0, 1.93, headZ), 0x1c2227));
  if (l.hood !== undefined) core.push(colored(new THREE.SphereGeometry(0.3, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62).rotateX(-0.35).translate(0, 1.88, headZ - 0.05), l.hood), box(0.46, 0.2, 0.3, 0, 1.6, -0.14, l.hood));
  if (l.pack !== undefined && l.pack !== null) core.push(cap(0.17, 0.32, 0, 1.28, -0.34, l.pack, 1.4 * w, 0.8), box(0.3 * w, 0.14, 0.1, 0, 1.2, -0.5, new THREE.Color(l.pack).multiplyScalar(0.75).getHex()));
  if (l.stripes) core.push(colored(new THREE.CylinderGeometry(0.3, 0.3, 0.07, 10).scale(1.2 * w, 1, 0.8).translate(0, 1.42, hz), 0xe8e6d8), colored(new THREE.CylinderGeometry(0.3, 0.3, 0.07, 10).scale(1.2 * w, 1, 0.8).translate(0, 1.12, hz), 0xe8e6d8));
  if (l.tool) core.push(colored(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6).rotateZ(0.6).translate(0.05, 1.45, -0.54), 0x8d9296), box(0.16, 0.05, 0.05, 0.4, 1.9, -0.54, 0x8d9296));
  if (l.satchel !== undefined) core.push(box(0.14, 0.32, 0.38, 0.4 * w, 0.95, 0, l.satchel), box(0.02, 0.14, 0.05, 0.475 * w, 0.97, 0, 0x2fae90), box(0.02, 0.05, 0.14, 0.475 * w, 0.97, 0, 0x2fae90));
  const leg = mergeGeometries([cap(0.115, 0.5, 0, -0.38, 0, pants), box(0.2, 0.13, 0.36, 0, -0.79, 0.05, 0x17181a)])!;
  const arm = mergeGeometries([cap(0.095, 0.4, 0, -0.27, 0, l.jacket), ball(0.085, 0, -0.6, 0, skin)])!;
  return { core: mergeGeometries(core)!, leg, arm, hipX: 0.15 * w, hipY: 0.86, shoulderX: 0.4 * w, shoulderY: 1.5 };
}

/** Single-mesh version (civilians and the instanced horde): limbs baked in a rest pose. */
function figureGeo(l: Look): THREE.BufferGeometry {
  const p = figureParts(l);
  const armPose = l.hunched ? -1.15 : -0.06;
  const parts = [p.core];
  for (const side of [-1, 1]) {
    parts.push(p.leg.clone().translate(side * p.hipX, p.hipY, 0));
    parts.push(p.arm.clone().rotateX(armPose + (l.hunched ? side * 0.12 : 0)).translate(side * p.shoulderX, p.shoulderY, l.hunched ? 0.1 : 0));
  }
  const g = mergeGeometries(parts)!;
  const sc = 1.3 * (l.scale ?? 1);
  g.scale(sc, sc, sc);
  return g;
}

function survivorLook(id: string, jacket: number): Look {
  const dark = new THREE.Color(jacket).multiplyScalar(0.62).getHex();
  if (id === 'mara') return { jacket, hair: 0x2b1d16, ponytail: true, satchel: 0xe9e4d8, skin: 0xc48d69 };
  if (id === 'jo') return { jacket, wide: 1.22, hat: 0x37424c, pack: 0x7a6a3a, stripes: true, tool: true, pants: 0x3a3f36, scale: 1.04 };
  if (id === 'lena') return { jacket, hood: dark, pack: 0x3d4a3a, scale: 0.9, skin: 0xe8c6aa, pants: 0x30343c };
  return { jacket, pack: 0x3d4a3a };
}

const NPC_LOOKS: Look[] = [
  { jacket: 0x4fa89a, pants: 0x3f8a7e, hair: 0x241a14 }, // Inès, scrubs
  { jacket: 0xb9c2c4, pants: 0x8f9aa0, hunched: true, hair: 0x6a6258 }, // the patient
  { jacket: 0x6b5540, hat: 0x3a2f28, pack: 0x4a3f33 }, // Sacha
  { jacket: 0xb5483a, hood: 0x8a3429, scale: 0.6 }, // his daughter
  { jacket: 0x5d5a6e, pants: 0x34323c, hair: 0xb9b4ac, pack: 0x1c1f24 }, // Vogel and his tape recorder
  { jacket: 0x7d8a6a, pants: 0x3b3a34, hair: 0x4a3526, hunched: false }, // the stranger
];

interface SurvivorView {
  group: THREE.Group;
  body: THREE.Group;
  mat: THREE.MeshStandardMaterial;
  limbs: { legL: THREE.Mesh; legR: THREE.Mesh; armL: THREE.Mesh; armR: THREE.Mesh };
  size: number;
  ring: THREE.Mesh;
  crate: THREE.Mesh;
  followers: THREE.Mesh[];
  tag: HTMLDivElement;
  x: number;
  z: number;
  heading: number;
  walk: number;
  hit: number;
  fall: number;
  phase: number;
}

const hash = (n: number) => {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
};

export class Actors {
  root = new THREE.Group();
  private views = new Map<string, SurvivorView>();
  private infected!: THREE.InstancedMesh;
  private hordeLegs!: THREE.InstancedMesh;
  private hordeArms!: THREE.InstancedMesh;
  private hordeParts!: FigureParts;
  private limb = new THREE.Object3D();
  private base = new THREE.Matrix4();
  private threatPosCache = new Map<number, { x: number; z: number }>();
  private rings: THREE.Mesh[] = [];
  private routeMesh: THREE.Mesh;
  private activeMesh: THREE.Mesh;
  private dash = makeDash();
  private fogCanvas = document.createElement('canvas');
  private fogTex: THREE.CanvasTexture;
  private fogTimer = 0;
  private nodeTags = new Map<NodeId, HTMLDivElement>();
  private pulses: { mesh: THREE.Mesh; t: number }[] = [];
  private dummy = new THREE.Object3D();
  private selRing: THREE.Mesh;
  private npcGeos = NPC_LOOKS.map((l) => figureGeo(l));

  constructor(private stage: Stage, private city: City, private labels: HTMLElement, s: GameState) {
    const scene = this.root;
    stage.scene.add(this.root);
    // infected: three draw calls for the whole horde (bodies, legs, arms), limbs animated per instance
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    this.hordeParts = figureParts({ jacket: 0x4f5a4a, pants: 0x2c2f2c, skin: 0x8f9a86, hunched: true });
    const inst = (g: THREE.BufferGeometry, n: number) => {
      const m = new THREE.InstancedMesh(g, mat, n);
      m.castShadow = stage.q.shadows;
      m.frustumCulled = false;
      m.count = 0;
      scene.add(m);
      return m;
    };
    this.infected = inst(this.hordeParts.core, 48);
    this.hordeLegs = inst(this.hordeParts.leg, 96);
    this.hordeArms = inst(this.hordeParts.arm, 96);

    // target rings
    const ringGeo = new THREE.RingGeometry(2.1, 2.7, 28).rotateX(-Math.PI / 2);
    for (let i = 0; i < NODES.length; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x3fe0c5, transparent: true, opacity: 0.8, depthTest: false, toneMapped: false }));
      m.renderOrder = 6;
      m.visible = false;
      scene.add(m);
      this.rings.push(m);
    }
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.5, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }));
    this.selRing.renderOrder = 6;
    this.selRing.visible = false;
    scene.add(this.selRing);

    const ribbon = (color: number, opacity: number) => {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color, map: this.dash, transparent: true, opacity, depthTest: false, toneMapped: false, side: THREE.DoubleSide, alphaTest: 0.05 }));
      m.renderOrder = 5;
      m.frustumCulled = false;
      m.visible = false;
      scene.add(m);
      return m;
    };
    this.routeMesh = ribbon(0x3fe0c5, 0.95);
    this.activeMesh = ribbon(0xb9a6ff, 0.5);

    // fog of war
    this.fogCanvas.width = 192;
    this.fogCanvas.height = 144;
    this.fogTex = new THREE.CanvasTexture(this.fogCanvas);
    this.fogTex.minFilter = THREE.LinearFilter;
    this.fogTex.generateMipmaps = false;
    // Much larger than the block: the texture's dark border clamps outward to the horizon.
    const fogGeo = new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2);
    const fuv = fogGeo.attributes.uv;
    const fpos = fogGeo.attributes.position;
    for (let i = 0; i < fuv.count; i++) fuv.setXY(i, (fpos.getX(i) - GROUND.x0) / (GROUND.x1 - GROUND.x0), 1 - (fpos.getZ(i) - GROUND.z0) / (GROUND.z1 - GROUND.z0));
    const fog = new THREE.Mesh(fogGeo, new THREE.MeshBasicMaterial({ map: this.fogTex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    fog.position.y = 0.05;
    fog.renderOrder = 4;
    scene.add(fog);

    for (const n of NODES) {
      const d = document.createElement('div');
      d.className = 'tag node';
      d.style.display = 'none';
      labels.appendChild(d);
      this.nodeTags.set(n.id, d);
    }
    for (const sv of s.survivors) this.addSurvivor(sv);
  }

  private addSurvivor(sv: Survivor) {
    const col = new THREE.Color(sv.color).getHex();
    const look = survivorLook(sv.id, col);
    const parts = figureParts(look);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, transparent: true });
    const shadows = this.stage.q.shadows;
    const mk = (g: THREE.BufferGeometry, x = 0, y = 0) => {
      const m = new THREE.Mesh(g, mat);
      m.position.set(x, y, 0);
      m.castShadow = shadows;
      return m;
    };
    const body = new THREE.Group();
    const limbs = {
      legL: mk(parts.leg, -parts.hipX, parts.hipY),
      legR: mk(parts.leg, parts.hipX, parts.hipY),
      armL: mk(parts.arm, -parts.shoulderX, parts.shoulderY),
      armR: mk(parts.arm, parts.shoulderX, parts.shoulderY),
    };
    body.add(mk(parts.core), limbs.legL, limbs.legR, limbs.armL, limbs.armR);
    const size = 1.3 * (look.scale ?? 1);
    body.scale.setScalar(size);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.78, 1.0, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }));
    ring.position.y = 0.12;
    ring.renderOrder = 6;
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0x8a7446, roughness: 0.9 }));
    crate.position.set(0, 2.9, -0.1);
    crate.visible = false;
    const group = new THREE.Group();
    group.add(body, ring, crate);
    if (!shadows) {
      // cheap contact shadow on the low tier
      const blob = new THREE.Mesh(new THREE.CircleGeometry(0.8, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }));
      blob.position.y = 0.06;
      group.add(blob);
    }
    const followers: THREE.Mesh[] = [];
    for (let i = 0; i < this.npcGeos.length; i++) {
      const f = new THREE.Mesh(this.npcGeos[i], new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
      f.visible = false;
      this.root.add(f);
      followers.push(f);
    }
    this.root.add(group);
    const tag = document.createElement('div');
    tag.className = 'tag sv';
    tag.style.setProperty('--c', sv.color);
    this.labels.appendChild(tag);
    const p = survivorPos(sv);
    this.views.set(sv.id, { group, body, mat, limbs, size, ring, crate, followers, tag, x: p.x, z: p.z, heading: 0, walk: 0, hit: 0, fall: 0, phase: this.views.size * 2.1 });
  }

  /** Where the operator believes the survivor is. */
  shownPos(sv: Survivor): { x: number; z: number; node: NodeId; moving: boolean } {
    if (sv.linked) {
      const p = survivorPos(sv);
      return { x: p.x, z: p.z, node: zoneOf(sv), moving: !!sv.to };
    }
    return { x: sv.lastReport.x, z: sv.lastReport.z, node: sv.lastReport.node, moving: false };
  }

  onHit(id: string) {
    const v = this.views.get(id);
    if (v) v.hit = 1;
  }

  pulse(node: NodeId, color = 0xffb060) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthTest: false, toneMapped: false }));
    m.position.set(NODE[node].x, 0.2, NODE[node].z);
    m.renderOrder = 6;
    this.root.add(m);
    this.pulses.push({ mesh: m, t: 0 });
  }

  private setRibbon(mesh: THREE.Mesh, pts: [number, number][] | null) {
    if (!pts || pts.length < 2) {
      mesh.visible = false;
      return;
    }
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    let len = 0;
    const W = 0.55;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      const nx = (-dz / l) * W;
      const nz = (dx / l) * W;
      if (i > 0) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      pos.push(pts[i][0] + nx, 0.3, pts[i][1] + nz, pts[i][0] - nx, 0.3, pts[i][1] - nz);
      uv.push(len / 2.4, 0, len / 2.4, 1);
      if (i > 0) {
        const k = i * 2;
        idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
      }
    }
    const g = mesh.geometry;
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    mesh.visible = true;
  }

  setRoutes(ui: UiView) {
    (this.routeMesh.material as THREE.MeshBasicMaterial).color.set(ORDER_COLOR[ui.orderType ?? 'scout'] ?? '#3fe0c5');
    (this.activeMesh.material as THREE.MeshBasicMaterial).color.set(ORDER_COLOR[ui.activeType ?? 'retreat'] ?? '#b9a6ff');
    this.setRibbon(this.routeMesh, ui.route);
    this.setRibbon(this.activeMesh, ui.route ? null : ui.activeRoute);
  }

  private drawFog(s: GameState) {
    const c = this.fogCanvas;
    const g = c.getContext('2d')!;
    const sx = c.width / (GROUND.x1 - GROUND.x0);
    const X = (x: number) => (x - GROUND.x0) * sx;
    const Z = (z: number) => (z - GROUND.z0) * sx;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(7,10,20,0.42)';
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-out';
    const clear = (id: NodeId) => {
      const it = s.intel[id];
      if (it.seenAt < 0) return 0;
      return Math.max(0.5, 1 - ((s.time - it.seenAt) / 180) * 0.5);
    };
    const hole = (x: number, z: number, rad: number, a: number) => {
      if (a <= 0) return;
      const grad = g.createRadialGradient(X(x), Z(z), 0, X(x), Z(z), rad * sx);
      grad.addColorStop(0, `rgba(0,0,0,${a})`);
      grad.addColorStop(0.55, `rgba(0,0,0,${a * 0.85})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(X(x - rad), Z(z - rad), rad * 2 * sx, rad * 2 * sx);
    };
    for (const n of NODES) hole(n.x, n.z, n.kind === 'interior' ? 20 : 27, clear(n.id));
    for (const e of EDGES) {
      const a = Math.min(clear(e.a), clear(e.b));
      if (a > 0) hole((NODE[e.a].x + NODE[e.b].x) / 2, (NODE[e.a].z + NODE[e.b].z) / 2, 22, a);
    }
    this.fogTex.needsUpdate = true;
  }

  sync(s: GameState, ui: UiView, dt: number, t: number) {
    const stage = this.stage;
    this.dash.offset.x = -t * 0.8;
    this.fogTimer -= dt;
    if (this.fogTimer <= 0) {
      this.fogTimer = 0.35;
      this.drawFog(s);
    }

    // ---------------- survivors
    const occupied: Record<string, string[]> = {};
    const atNode: Record<string, number> = {};
    for (const sv of s.survivors) {
      const v = this.views.get(sv.id);
      if (!v) continue;
      if (!sv.alive) {
        v.group.visible = false;
        v.tag.style.display = 'none';
        v.followers.forEach((f) => (f.visible = false));
        continue;
      }
      const p = this.shownPos(sv);
      const slot = !p.moving ? (atNode[p.node] = (atNode[p.node] ?? 0) + 1) - 1 : 0;
      const ox = !p.moving ? Math.cos(slot * 2.1 + 0.6) * (slot ? 3.4 : 0) : 0;
      const oz = !p.moving ? Math.sin(slot * 2.1 + 0.6) * (slot ? 3.4 : 0) : 0;
      const tx = p.x + ox;
      const tz = p.z + oz;
      const dx = tx - v.x;
      const dz = tz - v.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 30) {
        v.x = tx;
        v.z = tz;
      } else {
        const k = 1 - Math.pow(0.002, dt);
        v.x += dx * k;
        v.z += dz * k;
      }
      const moving = dist > 0.08 && sv.linked;
      if (moving) {
        // turn toward the direction of travel instead of snapping
        let d = Math.atan2(dx, dz) - v.heading;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        v.heading += d * Math.min(1, dt * 9);
      }
      v.walk += dt * (moving ? (sv.mode === 'flee' ? 13 : 8.5) : 0);
      const inside = NODE[p.node].kind === 'interior' && !p.moving && dist < 1.5;
      if (inside) (occupied[p.node] ??= []).push(sv.short);
      v.group.visible = !inside;
      v.group.position.set(v.x, 0, v.z);
      const down = sv.mode === 'down';
      const carried = down && !!sv.carriedBy;
      const working = sv.mode === 'order' && sv.order?.stage === 'work' && !sv.to;
      const observing = working && sv.order?.type === 'scout';
      const searching = working && sv.order?.type !== 'scout';
      const fighting = sv.mode === 'fight' && sv.linked;
      const resting = sv.mode === 'rest';
      const crouch = sv.mode === 'hide' || (sv.mode === 'order' && sv.order?.type === 'hold' && !sv.to);
      if (observing) v.heading += dt * 1.1; // sweeping the street
      if (carried) {
        const c = this.views.get(sv.carriedBy!);
        if (c) v.heading = c.heading + Math.PI / 2;
      }
      const lunge = fighting ? Math.max(0, Math.sin(t * 13 + v.walk)) : 0;
      // falling and getting up are eased; a hit makes the body recoil
      v.fall += ((down ? 1 : 0) - v.fall) * Math.min(1, dt * (down ? 5 : 3));
      const idle = !moving && !down && !fighting && !searching;
      if (idle && !observing && !carried) v.heading += Math.sin(t * 0.45 + v.phase) * dt * 0.25; // looking around
      v.body.rotation.set(
        -1.45 * v.fall + (down ? 0 : searching ? 0.55 + Math.sin(t * 6) * 0.12 : fighting ? 0.2 + lunge * 0.3 : moving ? 0.12 : 0) - v.hit * 0.4,
        v.heading,
        moving ? Math.sin(v.walk) * 0.07 : fighting ? Math.sin(t * 9) * 0.12 : 0,
        'YXZ',
      );
      v.body.position.set(Math.sin(v.heading) * (lunge * 0.35 - v.hit * 0.3), carried ? 2.25 : 0.35 * v.fall + (moving ? Math.abs(Math.sin(v.walk)) * 0.14 : 0), Math.cos(v.heading) * (lunge * 0.35 - v.hit * 0.3));
      const breath = idle ? 1 + Math.sin(t * 2.1 + v.phase) * 0.014 : 1;
      v.body.scale.set(v.size, v.size * breath * (crouch ? 0.7 : resting ? 0.62 : searching ? 0.86 : 1), v.size);
      // limbs: stride, reach, guard
      const stride = moving ? Math.sin(v.walk) * (sv.mode === 'flee' ? 0.95 : 0.65) : 0;
      const carrying = stockTotal(sv.carrying) > 0 || !!(sv.helping && s.survivors.some((o) => o.carriedBy === sv.id));
      const L = v.limbs;
      L.legL.rotation.x = down ? 0 : crouch || resting ? -1.0 : stride;
      L.legR.rotation.x = down ? 0 : crouch || resting ? -1.0 : -stride;
      let aL = -stride * 0.8;
      let aR = stride * 0.8;
      if (down) aL = aR = -2.8;
      else if (carrying) aL = aR = -2.75;
      else if (fighting) {
        aR = -1.5 - lunge * 0.9;
        aL = -0.9;
      } else if (searching) {
        aL = -1.1 + Math.sin(t * 7) * 0.35;
        aR = -1.1 - Math.sin(t * 7) * 0.35;
      } else if (observing) aL = aR = -2.2; // binoculars up
      else if (crouch) aL = aR = -0.5;
      L.armL.rotation.x += (aL - L.armL.rotation.x) * Math.min(1, dt * 14);
      L.armR.rotation.x += (aR - L.armR.rotation.x) * Math.min(1, dt * 14);
      L.armL.rotation.z = observing ? -0.5 : -0.08;
      L.armR.rotation.z = observing ? 0.5 : 0.08;
      v.ring.visible = !carried;
      const mat = v.mat;
      mat.opacity = sv.linked ? 1 : 0.38;
      v.hit = Math.max(0, v.hit - dt * 2.5);
      mat.emissive.setRGB(v.hit * 0.9, 0, 0);
      const ringMat = v.ring.material as THREE.MeshBasicMaterial;
      ringMat.opacity = sv.linked ? 0.9 : 0.35 + Math.sin(t * 4) * 0.15;
      ringMat.color.set(fighting || (sv.mode === 'flee' && sv.linked) ? (Math.sin(t * 10) > 0 ? '#ff5a45' : sv.color) : sv.color);
      // markers shrink as the camera closes in, so they never bury the character
      const near = Math.min(1, Math.max(0.5, stage.view.zoom / 26));
      v.ring.scale.setScalar(near * (1 + (ui.selected === sv.id ? Math.sin(t * 5) * 0.06 : 0)));
      v.crate.visible = stockTotal(sv.carrying) > 0 && !down;
      v.crate.rotation.y = v.heading;

      // escorted civilians trail behind
      const flags = [sv.escort.ines, sv.escort.patient, sv.escort.sacha, sv.escort.sacha, sv.escort.vogel, sv.escort.stranger];
      let rank = 0;
      v.followers.forEach((f, i) => {
        f.visible = flags[i] && !inside && sv.linked;
        if (!f.visible) return;
        // the patient leans on Inès; the child keeps close to her father
        const back = 1.5 + rank * 1.2;
        const side = i === 1 ? 0.55 : i === 3 ? -0.6 : 0;
        if (i !== 1 && i !== 3) rank++;
        f.position.set(v.x - Math.sin(v.heading) * back + Math.cos(v.heading) * side, 0, v.z - Math.cos(v.heading) * back - Math.sin(v.heading) * side);
        f.rotation.set(i === 1 ? 0.25 : 0, v.heading, i === 1 ? 0.2 : 0, 'YXZ');
        f.position.y = moving ? Math.abs(Math.sin(v.walk * (i === 3 ? 1.5 : 1) + i)) * 0.1 : 0;
      });

      // tag
      const sp = stage.project(v.x, inside ? 0 : 3.6, v.z);
      const tag = v.tag;
      if (inside) tag.style.display = 'none';
      else {
        tag.style.display = '';
        tag.style.transform = `translate3d(${sp.x.toFixed(1)}px,${(sp.y - slot * 15).toFixed(1)}px,0) translate(-50%,-100%)`;
        const state = !sv.linked ? `signal perdu · ${fmtTime(s.time - sv.lastReport.time)}` : sv.mode === 'order' && sv.order ? orderWord(sv) : MODE_LABEL[sv.mode];
        const cls = 'tag sv' + (ui.selected === sv.id ? ' sel' : '') + (!sv.linked ? ' lost' : '') + (sv.mode === 'flee' || sv.mode === 'down' || sv.mode === 'fight' ? ' danger' : '');
        if (tag.className !== cls) tag.className = cls;
        const oc = sv.linked && sv.mode === 'order' && sv.order ? ORDER_COLOR[sv.order.stage === 'return' ? 'retreat' : sv.order.type] : '';
        const html = `<b>${sv.short}</b>${ui.selected === sv.id || sv.mode !== 'idle' || !sv.linked ? `<i${oc ? ` style="color:${oc}"` : ''}>${state}</i>` : ''}`;
        if (tag.dataset.h !== html) {
          tag.dataset.h = html;
          tag.innerHTML = html;
        }
      }
    }
    const sel = ui.selected ? this.views.get(ui.selected) : null;
    this.selRing.visible = !!sel && sel.group.visible;
    if (sel) {
      this.selRing.position.set(sel.x, 0.14, sel.z);
      this.selRing.scale.setScalar(Math.min(1, Math.max(0.5, stage.view.zoom / 26)));
      this.selRing.rotation.y = t * 0.8;
    }

    // ---------------- interiors (abstract): the roof outline glows when occupied or targeted
    for (const [id, mesh] of Object.entries(this.city.interiors)) {
      const occ = occupied[id];
      const targeted = ui.targets.includes(id) || ui.chosen === id;
      const m = mesh.material as THREE.MeshBasicMaterial;
      const want = occ ? 0.75 + Math.sin(t * 3) * 0.15 : targeted ? 0.45 : 0;
      m.opacity += (want - m.opacity) * Math.min(1, dt * 6);
      mesh.visible = m.opacity > 0.02;
    }

    // ---------------- infected: only what a linked survivor is watching right now
    let n = 0;
    const live = new Set<NodeId>();
    for (const th of s.threats) {
      if (!th.seen) {
        this.threatPosCache.delete(th.id);
        continue;
      }
      live.add(zoneOf(th));
      const p = threatPos(th);
      let c = this.threatPosCache.get(th.id);
      if (!c) this.threatPosCache.set(th.id, (c = { x: p.x, z: p.z }));
      const k = 1 - Math.pow(0.01, dt);
      c.x += (p.x - c.x) * k;
      c.z += (p.z - c.z) * k;
      for (let i = 0; i < th.size && n < 48; i++) {
        const a = hash(th.id * 13 + i) * 6.283;
        const rad = 0.9 + hash(th.id * 7 + i * 3) * 2.2;
        const sway = Math.sin(t * (1.2 + hash(i + th.id) * 1.5) + i);
        const hunting = th.state === 'hunt';
        const pace = (hunting ? 7 : 3.2) * (0.8 + hash(i * 3 + th.id) * 0.5);
        const stepA = Math.sin(t * pace + i * 1.7) * (th.to || hunting ? 0.6 : 0.12);
        this.dummy.position.set(c.x + Math.cos(a) * rad + sway * 0.15, Math.abs(stepA) * 0.08, c.z + Math.sin(a) * rad);
        this.dummy.rotation.set(0.24 + sway * 0.06 + (hunting ? 0.12 : 0), th.to ? p.heading + sway * 0.15 : a + sway * 0.4, sway * 0.1, 'YXZ');
        this.dummy.scale.setScalar(1.3 * (0.92 + hash(i * 5 + th.id) * 0.18));
        this.dummy.updateMatrix();
        this.infected.setMatrixAt(n, this.dummy.matrix);
        const P = this.hordeParts;
        for (const side of [-1, 1]) {
          const k2 = n * 2 + (side < 0 ? 0 : 1);
          this.limb.position.set(side * P.hipX, P.hipY, 0);
          this.limb.rotation.set(side * stepA - 0.2, 0, 0); // dragging gait
          this.limb.updateMatrix();
          this.hordeLegs.setMatrixAt(k2, this.base.multiplyMatrices(this.dummy.matrix, this.limb.matrix));
          this.limb.position.set(side * P.shoulderX, P.shoulderY, 0.1);
          this.limb.rotation.set(-1.15 - (hunting ? 0.45 : 0) + Math.sin(t * pace * 0.5 + i + side) * 0.18, 0, side * 0.12);
          this.limb.updateMatrix();
          this.hordeArms.setMatrixAt(k2, this.base.multiplyMatrices(this.dummy.matrix, this.limb.matrix));
        }
        n++;
      }
    }
    this.infected.count = n;
    this.hordeLegs.count = this.hordeArms.count = n * 2;
    this.infected.instanceMatrix.needsUpdate = true;
    this.hordeLegs.instanceMatrix.needsUpdate = true;
    this.hordeArms.instanceMatrix.needsUpdate = true;

    // ---------------- node rings + tags
    const goals = objectiveStatus(s).nodes;
    const orderColor = ORDER_COLOR[ui.orderType ?? ''] ?? '#3fe0c5';
    if (this.labels.dataset.oc !== orderColor) {
      this.labels.dataset.oc = orderColor;
      this.labels.style.setProperty('--oc', orderColor);
    }
    NODES.forEach((node, i) => {
      const ring = this.rings[i];
      const isTarget = ui.targets.includes(node.id);
      const chosen = ui.chosen === node.id;
      ring.visible = isTarget || chosen;
      if (ring.visible) {
        const y = node.kind === 'interior' ? 0.2 : 0.2;
        ring.position.set(node.x, y, node.z);
        const pulse = chosen ? 1.25 : 1 + Math.sin(t * 3.2 + i) * 0.1;
        ring.scale.setScalar(pulse);
        (ring.material as THREE.MeshBasicMaterial).opacity = chosen ? 1 : 0.7;
        (ring.material as THREE.MeshBasicMaterial).color.set(chosen ? '#ffffff' : orderColor);
      }
      const tag = this.nodeTags.get(node.id)!;
      const it = s.intel[node.id];
      const stale = it.threat > 0 && !live.has(node.id) && it.seenAt !== -1;
      const occ = occupied[node.id];
      const signalSite = node.id === 'apts' && s.flags.unknownState === 'answered';
      const objective = goals.includes(node.id);
      const loot = it.lootKnown && s.loot[node.id] && stockTotal(s.loot[node.id]) > 0;
      let html = '';
      if (isTarget || chosen) html += `<b>${node.name}</b>`;
      if (occ) html += `<span class="in">⌂ ${occ.join(', ')}</span>`;
      if (objective && !isTarget && !occ) html += `<span class="obj">◆ ${node.name}</span>`;
      if (signalSite) html += `<span class="obj">◉ Signal inconnu</span>`;
      if (loot && (isTarget || chosen)) html += `<span class="loot">▣ butin repéré</span>`;
      if (stale) html += `<span class="threat">☣ ${it.threat} · ${it.seenAt < 0 ? 'hier' : 'il y a ' + fmtTime(s.time - it.seenAt)}</span>`;
      else if (live.has(node.id) && (isTarget || chosen)) html += `<span class="threat live">☣ contact</span>`;
      if (!html) {
        if (tag.style.display !== 'none') tag.style.display = 'none';
        return;
      }
      if (tag.dataset.h !== html) {
        tag.dataset.h = html;
        tag.innerHTML = html;
      }
      tag.style.display = '';
      const h = node.kind === 'interior' ? (node.id === 'apts' ? 17 : node.id === 'hosp_in' ? 13 : 7.5) : 0;
      const off = node.kind === 'interior' ? interiorCenter(node.id) : { x: node.x, z: node.z };
      const sp = stage.project(isTarget || chosen || !h ? node.x : off.x, isTarget || chosen ? 0 : h, isTarget || chosen || !h ? node.z : off.z);
      tag.style.transform = `translate3d(${sp.x.toFixed(1)}px,${(sp.y - (isTarget || chosen ? 26 : 8)).toFixed(1)}px,0) translate(-50%,-100%)`;
      const cls = 'tag node' + (chosen ? ' chosen' : isTarget ? ' target' : '');
      if (tag.className !== cls) tag.className = cls;
    });

    // ---------------- noise pulses
    for (const p of this.pulses) {
      p.t += dt;
      p.mesh.scale.setScalar(1 + p.t * 14);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.8 - p.t * 0.7);
    }
    this.pulses = this.pulses.filter((p) => {
      if (p.t < 1.2) return true;
      this.root.remove(p.mesh);
      p.mesh.geometry.dispose();
      return false;
    });
  }

  /** Nearest survivor / node to a screen point, for tap handling. */
  pick(s: GameState, x: number, y: number, nodes: NodeId[]): { survivor?: string; node?: NodeId } {
    let best: { survivor?: string; node?: NodeId } = {};
    let bestD = 44;
    for (const id of nodes) {
      const p = this.stage.project(NODE[id].x, 0, NODE[id].z);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) {
        bestD = d;
        best = { node: id };
      }
    }
    if (best.node) return best;
    bestD = 40;
    for (const sv of s.survivors) {
      if (!sv.alive) continue;
      const v = this.views.get(sv.id)!;
      const p = this.stage.project(v.x, 1.5, v.z);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) {
        bestD = d;
        best = { survivor: sv.id };
      }
    }
    return best;
  }
}

function interiorCenter(id: NodeId): { x: number; z: number } {
  if (id === 'apts') return { x: -42, z: -29 };
  if (id === 'hosp_in') return { x: 58, z: -26 };
  return { x: 56, z: 34 };
}

function orderWord(sv: Survivor): string {
  const o = sv.order!;
  if (o.stage === 'return') return 'Retour';
  if (o.type === 'hold') return 'Tient la position';
  if (o.type === 'retreat') return 'Repli';
  if (o.stage === 'work') return o.type === 'scout' ? 'Observe' : o.type === 'retrieve' ? 'Fouille' : 'Sur place';
  return o.type === 'scout' ? 'Reconnaissance' : o.type === 'retrieve' ? 'Récupération' : 'Secours';
}
