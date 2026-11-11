// Renderer, isometric orthographic camera, time-of-day lighting, touch controls.
import * as THREE from 'three';
import { BOUNDS } from '../sim/world';
import type { Quality } from './quality';

const YAW = Math.PI / 4;
const PITCH = (40 * Math.PI) / 180; // degrees down from the horizon
const DIST = 220;

export class Stage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.OrthographicCamera;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  /** Smoothed camera state (world units; zoom = half the vertical extent). */
  view = { x: -30, z: 8, zoom: 34 };
  goal = { x: -30, z: 8, zoom: 34 };
  minZoom = 14;
  maxZoom = 62;
  onTap: (x: number, y: number) => void = () => {};
  private pointers = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
  private pinch = 0;
  private moved = false;
  private dyn = 1;
  private frameAvg = 16;
  private fog: THREE.Fog;
  private tmp = new THREE.Vector3();
  private flash = 0;

  constructor(public canvas: HTMLCanvasElement, public q: Quality) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: q.antialias, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = true;

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 600);
    this.fog = new THREE.Fog(0x5a5d6e, DIST - 25, DIST + 320);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(0x5a5d6e);

    this.hemi = new THREE.HemisphereLight(0x9fb0d0, 0x4a4038, 1.0);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffb27a, 2.6);
    this.sun.castShadow = q.shadows;
    if (q.shadows) {
      this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
      this.sun.shadow.bias = -0.0006;
      this.sun.shadow.normalBias = 0.04;
      this.sun.shadow.camera.near = 10;
      this.sun.shadow.camera.far = 400;
    }
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.makeEnvironment();
    this.bind();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Small gradient sky baked into an environment map so metal, glass and water have something to reflect. */
  private makeEnvironment() {
    const pm = new THREE.PMREMGenerator(this.renderer);
    const sky = new THREE.Scene();
    const geo = new THREE.SphereGeometry(50, 24, 12);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const ground = new THREE.Color(0x2b2724);
    const horizon = new THREE.Color(0xe0a274);
    const zenith = new THREE.Color(0x56699a);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 50;
      if (y < 0) c.copy(horizon).lerp(ground, Math.min(1, -y * 4));
      else c.copy(horizon).lerp(zenith, Math.pow(y, 0.55));
      // warm glow on the sunset side
      const west = Math.max(0, -pos.getX(i) / 50) * Math.max(0, 1 - Math.abs(y) * 2.2);
      c.lerp(new THREE.Color(0xffc48a), west * 0.6);
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    sky.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    this.scene.environment = pm.fromScene(sky, 0.03).texture;
    pm.dispose();
    geo.dispose();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(this.q.pixelRatio * this.dyn);
    this.renderer.setSize(w, h, false);
    // Portrait phones see less width: allow a wider zoom-out.
    this.maxZoom = w < h ? 96 : 62;
    this.applyCamera();
  }

  private applyCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    const v = this.view;
    this.camera.top = v.zoom;
    this.camera.bottom = -v.zoom;
    this.camera.left = -v.zoom * aspect;
    this.camera.right = v.zoom * aspect;
    const ch = Math.cos(PITCH) * DIST;
    this.camera.position.set(v.x + Math.sin(YAW) * ch, Math.sin(PITCH) * DIST, v.z + Math.cos(YAW) * ch);
    this.camera.lookAt(v.x, 0, v.z);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  /** dark: 0 dusk → 1 night. storm: 0..1. */
  setAtmosphere(dark: number, storm: number, t: number) {
    const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
    const c = (a: number, b: number, k: number) => new THREE.Color(a).lerp(new THREE.Color(b), k);
    const gloom = Math.min(1, dark + storm * 0.35);
    this.sun.color.copy(c(0xffa86c, 0x86a6e0, gloom));
    this.sun.intensity = lerp(3.8, 1.25, gloom) * (1 - storm * 0.25);
    this.hemi.color.copy(c(0xb4c0dc, 0x4a5c94, gloom));
    this.hemi.groundColor.copy(c(0x6a5a4c, 0x1a1e2c, gloom));
    this.hemi.intensity = lerp(1.45, 1.1, gloom);
    this.scene.environmentIntensity = lerp(0.85, 0.4, gloom);
    const fogC = c(0x6f6a72, 0x18203a, gloom);
    if (this.flash > 0) {
      fogC.lerp(new THREE.Color(0xaab8d8), this.flash * 0.5);
      this.hemi.intensity += this.flash * 1.6;
      this.flash = Math.max(0, this.flash - 0.07);
    } else if (storm > 0.5 && Math.random() < 0.004) this.flash = 1;
    this.fog.color.copy(fogC);
    (this.scene.background as THREE.Color).copy(fogC);
    this.fog.near = DIST - lerp(25, 70, storm);
    this.fog.far = DIST + lerp(320, 170, Math.max(storm, dark * 0.35));
    // low sun from the south-west, sliding toward a high cold moon
    const az = lerp(-2.1, -1.2, dark);
    const el = lerp(0.42, 0.95, dark);
    const d = 160;
    const v = this.view;
    this.sun.position.set(v.x + Math.cos(el) * Math.sin(az) * d, Math.sin(el) * d, v.z + Math.cos(el) * Math.cos(az) * d);
    this.sun.target.position.set(v.x, 0, v.z);
    if (this.q.shadows) {
      const s = Math.min(90, v.zoom * 2.1 + 14);
      const cam = this.sun.shadow.camera;
      if (Math.abs(cam.right - s) > 2) {
        cam.left = -s;
        cam.right = s;
        cam.top = s;
        cam.bottom = -s;
        cam.updateProjectionMatrix();
      }
    }
    void t;
  }

  focus(x: number, z: number, zoom?: number) {
    this.goal.x = x;
    this.goal.z = z;
    if (zoom) this.goal.zoom = zoom;
  }

  /** Frame a set of ground points, leaving room for the HUD. */
  frame(points: { x: number; z: number }[], pad = 9) {
    if (!points.length) return;
    let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
    for (const p of points) {
      const u = (p.x - p.z) * Math.SQRT1_2;
      const w = (p.x + p.z) * Math.SQRT1_2;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      w0 = Math.min(w0, w);
      w1 = Math.max(w1, w);
    }
    const aspect = window.innerWidth / window.innerHeight;
    const needV = ((w1 - w0) * Math.sin(PITCH)) / 2 + pad * 1.5;
    const needH = ((u1 - u0) / 2 + pad * 2.2) / aspect;
    const uc = (u0 + u1) / 2 - pad * 0.5; // shift right: the team panel sits on the left
    const wc = (w0 + w1) / 2 + pad * 0.3;
    this.goal.zoom = Math.max(needV, needH, 22);
    this.goal.x = (uc + wc) * Math.SQRT1_2;
    this.goal.z = (wc - uc) * Math.SQRT1_2;
  }

  update(dt: number) {
    const g = this.goal;
    const half = this.view.zoom * 0.35;
    g.x = Math.min(BOUNDS.maxX - half * 0.2, Math.max(BOUNDS.minX + half * 0.2, g.x));
    g.z = Math.min(BOUNDS.maxZ - half * 0.2, Math.max(BOUNDS.minZ + half * 0.2, g.z));
    g.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, g.zoom));
    const k = 1 - Math.pow(0.0015, dt);
    this.view.x += (g.x - this.view.x) * k;
    this.view.z += (g.z - this.view.z) * k;
    this.view.zoom += (g.zoom - this.view.zoom) * k;
    this.applyCamera();

    // dynamic resolution: trade pixels for a stable frame rate
    this.frameAvg += (dt * 1000 - this.frameAvg) * 0.05;
    if (this.frameAvg > 26 && this.dyn > 0.6) {
      this.dyn = Math.max(0.6, this.dyn - 0.1);
      this.frameAvg = 18;
      this.renderer.setPixelRatio(this.q.pixelRatio * this.dyn);
    } else if (this.frameAvg < 13 && this.dyn < 1) {
      this.dyn = Math.min(1, this.dyn + 0.05);
      this.frameAvg = 17;
      this.renderer.setPixelRatio(this.q.pixelRatio * this.dyn);
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** World (x, y, z) → CSS pixels. */
  project(x: number, y: number, z: number): { x: number; y: number } {
    this.tmp.set(x, y, z).project(this.camera);
    return { x: (this.tmp.x * 0.5 + 0.5) * window.innerWidth, y: (-this.tmp.y * 0.5 + 0.5) * window.innerHeight };
  }

  stats() {
    const i = this.renderer.info.render;
    return { calls: i.calls, tris: i.triangles, scale: this.dyn, ms: this.frameAvg };
  }

  // ---------------------------------------------------------------- input
  private pan(dx: number, dy: number) {
    const upp = (this.view.zoom * 2) / window.innerHeight; // world units per CSS pixel
    const rx = Math.cos(YAW);
    const rz = -Math.sin(YAW);
    const fx = -Math.sin(YAW);
    const fz = -Math.cos(YAW);
    const along = (dy * upp) / Math.sin(PITCH);
    this.goal.x = this.view.x = this.view.x - dx * upp * rx + along * fx;
    this.goal.z = this.view.z = this.view.z - dx * upp * rz + along * fz;
  }

  private bind() {
    const el = this.canvas;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: e.timeStamp });
      if (this.pointers.size === 1) this.moved = false;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = Math.hypot(a.x - b.x, a.y - b.y);
        this.moved = true;
      }
    });
    el.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pointers.size === 1) {
        if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 8) this.moved = true;
        if (this.moved) this.pan(dx, dy);
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch > 0 && d > 0) this.goal.zoom = this.view.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.view.zoom * (this.pinch / d)));
        this.pinch = d;
        this.pan(dx / 2, dy / 2);
      }
    });
    const end = (e: PointerEvent) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (p && !this.moved && this.pointers.size === 0 && e.timeStamp - p.t < 600) this.onTap(e.clientX, e.clientY);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', (e) => this.pointers.delete(e.pointerId));
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.goal.zoom *= Math.exp(e.deltaY * 0.0012);
      },
      { passive: false },
    );
  }
}
