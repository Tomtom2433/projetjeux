// Dynamic layer: survivors, infected, routes, target rings, fog of war and world-anchored labels.
// Reads the simulation state; never writes to it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GameState, NodeId, Survivor } from '../sim/types';
import { NODE, NODES, EDGES } from '../sim/world';
import { stockTotal, survivorPos, threatPos, zoneOf } from '../sim/core';
import { fmtTime, MODE_LABEL } from '../sim/text';
import type { Stage } from './scene';
import type { City } from './city';
import { GROUND, makeDash } from './textures';

export interface UiView {
  selected: string | null;
  targets: NodeId[];
  chosen: NodeId | null;
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

function figureGeo(jacket: number, pants: number, skin: number, pack: number | null, hunched = false): THREE.BufferGeometry {
  const parts = [
    colored(new THREE.BoxGeometry(0.22, 0.85, 0.3).translate(-0.15, 0.43, 0), pants),
    colored(new THREE.BoxGeometry(0.22, 0.85, 0.3).translate(0.15, 0.43, 0), pants),
    colored(new THREE.BoxGeometry(0.66, 0.78, 0.4).translate(0, 1.24, hunched ? 0.08 : 0), jacket),
    colored(new THREE.BoxGeometry(0.2, 0.7, 0.24).translate(-0.44, 1.24, hunched ? 0.25 : 0), jacket),
    colored(new THREE.BoxGeometry(0.2, 0.7, 0.24).translate(0.44, 1.24, hunched ? 0.25 : 0), jacket),
    colored(new THREE.SphereGeometry(0.25, 8, 6).translate(0, 1.86, hunched ? 0.16 : 0), skin),
  ];
  if (pack !== null) parts.push(colored(new THREE.BoxGeometry(0.5, 0.6, 0.26).translate(0, 1.3, -0.32), pack));
  const g = mergeGeometries(parts)!;
  g.scale(1.3, 1.3, 1.3);
  return g;
}

interface SurvivorView {
  group: THREE.Group;
  body: THREE.Mesh;
  ring: THREE.Mesh;
  crate: THREE.Mesh;
  followers: THREE.Mesh[];
  tag: HTMLDivElement;
  x: number;
  z: number;
  heading: number;
  walk: number;
  hit: number;
}

const hash = (n: number) => {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
};

export class Actors {
  root = new THREE.Group();
  private views = new Map<string, SurvivorView>();
  private infected: THREE.InstancedMesh;
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
  private npcGeo = figureGeo(0x8fa3a0, 0x3a3f45, 0xc9a58a, null);

  constructor(private stage: Stage, private city: City, private labels: HTMLElement, s: GameState) {
    const scene = this.root;
    stage.scene.add(this.root);
    // infected (one draw call for the whole horde)
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    this.infected = new THREE.InstancedMesh(figureGeo(0x4f5a4a, 0x2c2f2c, 0x8f9a86, null, true), mat, 48);
    this.infected.castShadow = stage.q.shadows;
    this.infected.frustumCulled = false;
    this.infected.count = 0;
    scene.add(this.infected);

    // target rings
    const ringGeo = new THREE.RingGeometry(2.1, 2.7, 28).rotateX(-Math.PI / 2);
    for (let i = 0; i < NODES.length; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x3fe0c5, transparent: true, opacity: 0.8, depthTest: false, toneMapped: false }));
      m.renderOrder = 6;
      m.visible = false;
      scene.add(m);
      this.rings.push(m);
    }
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.6, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, toneMapped: false }));
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
    const body = new THREE.Mesh(figureGeo(col, 0x2a2e33, 0xd0a988, 0x3d4a3a), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, transparent: true }));
    body.castShadow = this.stage.q.shadows;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.05, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, depthTest: false, toneMapped: false }));
    ring.position.y = 0.12;
    ring.renderOrder = 6;
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0x8a7446, roughness: 0.9 }));
    crate.position.set(0, 2.9, -0.1);
    crate.visible = false;
    const group = new THREE.Group();
    group.add(body, ring, crate);
    const followers: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(this.npcGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
      f.scale.setScalar(i === 2 ? 0.7 : 0.95);
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
    this.views.set(sv.id, { group, body, ring, crate, followers, tag, x: p.x, z: p.z, heading: 0, walk: 0, hit: 0 });
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
      if (moving) v.heading = Math.atan2(dx, dz);
      v.walk += dt * (moving ? (sv.mode === 'flee' ? 13 : 8.5) : 0);
      const inside = NODE[p.node].kind === 'interior' && !p.moving && dist < 1.5;
      if (inside) (occupied[p.node] ??= []).push(sv.short);
      v.group.visible = !inside;
      v.group.position.set(v.x, 0, v.z);
      const down = sv.mode === 'down';
      const crouch = sv.mode === 'hide' || (sv.mode === 'order' && sv.order?.type === 'hold' && !sv.to);
      v.body.rotation.set(down ? -1.45 : moving ? 0.12 : 0, v.heading, moving ? Math.sin(v.walk) * 0.07 : 0, 'YXZ');
      v.body.position.y = down ? 0.35 : moving ? Math.abs(Math.sin(v.walk)) * 0.14 : 0;
      v.body.scale.y = crouch ? 0.68 : 1;
      const mat = v.body.material as THREE.MeshStandardMaterial;
      mat.opacity = sv.linked ? 1 : 0.38;
      v.hit = Math.max(0, v.hit - dt * 2.5);
      mat.emissive.setRGB(v.hit * 0.9, 0, 0);
      const ringMat = v.ring.material as THREE.MeshBasicMaterial;
      ringMat.opacity = sv.linked ? 0.9 : 0.35 + Math.sin(t * 4) * 0.15;
      v.ring.scale.setScalar(1 + (ui.selected === sv.id ? Math.sin(t * 5) * 0.06 : 0));
      v.crate.visible = stockTotal(sv.carrying) > 0 && !down;
      v.crate.rotation.y = v.heading;

      // escorted civilians trail behind
      const flags = [sv.escort.ines || sv.escort.sacha, sv.escort.patient, sv.escort.sacha];
      v.followers.forEach((f, i) => {
        f.visible = flags[i] && !inside && sv.linked;
        if (!f.visible) return;
        const back = 1.6 + i * 1.3;
        f.position.set(v.x - Math.sin(v.heading) * back + (i - 1) * 0.5, 0, v.z - Math.cos(v.heading) * back);
        f.rotation.y = v.heading;
        f.position.y = moving ? Math.abs(Math.sin(v.walk + i)) * 0.1 : 0;
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
        const html = `<b>${sv.short}</b>${ui.selected === sv.id || sv.mode !== 'idle' || !sv.linked ? `<i>${state}</i>` : ''}`;
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
        this.dummy.position.set(c.x + Math.cos(a) * rad + sway * 0.15, 0, c.z + Math.sin(a) * rad);
        this.dummy.rotation.set(0.22 + sway * 0.05, th.to ? p.heading : a + sway * 0.4, sway * 0.09, 'YXZ');
        this.dummy.scale.setScalar(0.92 + hash(i * 5 + th.id) * 0.18);
        this.dummy.updateMatrix();
        this.infected.setMatrixAt(n++, this.dummy.matrix);
      }
    }
    this.infected.count = n;
    this.infected.instanceMatrix.needsUpdate = true;

    // ---------------- node rings + tags
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
        (ring.material as THREE.MeshBasicMaterial).color.setHex(chosen ? 0xffffff : 0x3fe0c5);
      }
      const tag = this.nodeTags.get(node.id)!;
      const it = s.intel[node.id];
      const stale = it.threat > 0 && !live.has(node.id) && it.seenAt !== -1;
      const occ = occupied[node.id];
      const signalSite = node.id === 'apts' && s.flags.unknownState === 'answered';
      const objective = node.id === 'hosp_in' && s.delivered.medicine < 2 && (s.loot.hosp_in?.medicine ?? 0) > 0;
      const loot = it.lootKnown && s.loot[node.id] && stockTotal(s.loot[node.id]) > 0;
      let html = '';
      if (isTarget || chosen) html += `<b>${node.name}</b>`;
      if (occ) html += `<span class="in">⌂ ${occ.join(', ')}</span>`;
      if (objective && !isTarget && !occ) html += `<span class="obj">✚ Saint-Roch</span>`;
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
