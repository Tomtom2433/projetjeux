// Procedural city block: every mesh is generated here and merged per material
// so the whole static environment costs a handful of draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CANAL } from '../sim/world';
import type { Shelter } from '../sim/types';
import { GROUND, ROADS, makeDetail, makeFacade, makeGlow, makeGroundTextures, makeSign, makeWaterNormal, type FacadeStyle } from './textures';
import type { Quality } from './quality';

function seeded(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Mat = 'matte' | 'metal' | 'gloss' | 'glass' | 'foliage' | 'glow';

const UNIT = {
  box: new THREE.BoxGeometry(1, 1, 1).toNonIndexed(),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 8).toNonIndexed(),
  cyl12: new THREE.CylinderGeometry(1, 1, 1, 14).toNonIndexed(),
  cone: new THREE.CylinderGeometry(0, 1, 1, 6).toNonIndexed(),
  blob: new THREE.IcosahedronGeometry(1, 1),
  rock: new THREE.IcosahedronGeometry(1, 0),
  // half-cylinder shell lying along z, dome up (tents)
  half: new THREE.CylinderGeometry(1, 1, 1, 10, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2).toNonIndexed(),
};

/** Collects coloured primitives and merges them into one mesh per material. */
class Batch {
  private geos = new Map<Mat, THREE.BufferGeometry[]>();
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];
  private tmp = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private col = new THREE.Color();
  constructor(private r: () => number) {}

  push(x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) {
    this.e.set(rx, ry, rz, 'YXZ');
    this.q.setFromEuler(this.e);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), this.q, new THREE.Vector3(1, 1, 1));
    this.stack.push(this.stack[this.stack.length - 1].clone().multiply(m));
  }
  pop() {
    this.stack.pop();
  }

  add(mat: Mat, base: THREE.BufferGeometry, color: number, sx: number, sy: number, sz: number, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, jitter = 0.07) {
    const g = base.clone();
    this.e.set(rx, ry, rz, 'YXZ');
    this.q.setFromEuler(this.e);
    this.tmp.compose(new THREE.Vector3(x, y, z), this.q, new THREE.Vector3(sx, sy, sz));
    g.applyMatrix4(this.tmp.premultiply(this.stack[this.stack.length - 1]));
    this.col.setHex(color);
    if (jitter) {
      const k = 1 + (this.r() - 0.5) * 2 * jitter;
      this.col.multiplyScalar(k);
    }
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = this.col.r;
      arr[i * 3 + 1] = this.col.g;
      arr[i * 3 + 2] = this.col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    if (!this.geos.has(mat)) this.geos.set(mat, []);
    this.geos.get(mat)!.push(g);
  }
  /** Box resting on y. */
  box(mat: Mat, w: number, h: number, d: number, x: number, y: number, z: number, color: number, ry = 0, rx = 0, rz = 0) {
    this.add(mat, UNIT.box, color, w, h, d, x, y + h / 2, z, ry, rx, rz);
  }
  cyl(mat: Mat, r: number, h: number, x: number, y: number, z: number, color: number, rx = 0, rz = 0, round = false) {
    this.add(mat, round ? UNIT.cyl12 : UNIT.cyl, color, r, h, r, x, y + (rx || rz ? 0 : h / 2), z, 0, rx, rz);
  }
  blob(mat: Mat, r: number, x: number, y: number, z: number, color: number, sy = 1, rock = false) {
    this.add(mat, rock ? UNIT.rock : UNIT.blob, color, r, r * sy, r, x, y, z, this.r() * 6, this.r(), 0, 0.12);
  }
  build(mats: Record<Mat, THREE.Material>, shadows: boolean): THREE.Group {
    const group = new THREE.Group();
    for (const [mat, list] of this.geos) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mats[mat]);
      mesh.castShadow = shadows && mat !== 'glow';
      mesh.receiveShadow = shadows && mat !== 'glow';
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    return group;
  }
}

export interface Glow {
  mesh: THREE.Mesh;
  base: number;
  kind: 'steady' | 'blink' | 'flicker' | 'flood' | 'beacon';
  phase: number;
}

export interface City {
  group: THREE.Group;
  /** Roof outlines of the abstract interiors, keyed by node id. */
  interiors: Record<string, THREE.Mesh>;
  update(t: number, dark: number, storm: number): void;
  setShelter(sh: Shelter): void;
  /** Show the objects brought back to the base. */
  setFinds(ids: string[]): void;
  setBusFire(on: boolean): void;
  flare(x: number, z: number): void;
}

export function buildCity(q: Quality): City {
  const r = seeded(20261111);
  const root = new THREE.Group();
  const B = new Batch(r);
  const glows: Glow[] = [];
  const footprints: [number, number, number, number][] = [];
  const facades = new Map<FacadeStyle, THREE.BufferGeometry[]>();

  const mats: Record<Mat, THREE.Material> = {
    matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93 }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.55 }),
    gloss: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.25 }),
    glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.85 }),
    foliage: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
  };

  // trees and bushes lean with the wind (vertex shader, no CPU cost)
  const wind = { value: 0 };
  mats.foliage.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = wind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  { float h = smoothstep(1.2, 5.5, position.y); float ph = position.x * 0.31 + position.z * 0.27; transformed.x += sin(uWind * 1.3 + ph) * 0.11 * h; transformed.z += cos(uWind * 1.1 + ph * 1.3) * 0.08 * h; }');
  };

  // ------------------------------------------------------------ ground & canal
  const tex = makeGroundTextures(q.groundTex);
  const groundMat = new THREE.MeshStandardMaterial({ map: tex.map, roughnessMap: tex.rough, roughness: 1, metalness: 0.08 });
  // world-scale grain layered over the painted map (one extra texture fetch)
  const detail = makeDetail();
  groundMat.onBeforeCompile = (shader) => {
    shader.uniforms.detailMap = { value: detail };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n  { float det = texture2D(detailMap, vMapUv * vec2(48.0, 36.0)).r; float fine = texture2D(detailMap, vMapUv * vec2(173.0, 131.0) + 0.37).r; diffuseColor.rgb *= 0.46 + det * 0.72 + fine * 0.4; }');
  };
  const groundPiece = (x0: number, x1: number) => {
    const g = new THREE.PlaneGeometry(x1 - x0, GROUND.z1 - GROUND.z0);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, 0, 0);
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, (pos.getX(i) - GROUND.x0) / (GROUND.x1 - GROUND.x0), 1 - (pos.getZ(i) - GROUND.z0) / (GROUND.z1 - GROUND.z0));
    }
    const m = new THREE.Mesh(g, groundMat);
    m.receiveShadow = q.shadows;
    m.matrixAutoUpdate = false;
    root.add(m);
  };
  groundPiece(GROUND.x0, CANAL.x0);
  groundPiece(CANAL.x1, GROUND.x1);
  // terrain skirt far beyond the block, swallowed by fog
  // (split in two so it never covers the canal)
  const skirtMat = new THREE.MeshStandardMaterial({ color: 0x3a3d30, roughness: 1 });
  for (const [sx0, sx1] of [[-400, CANAL.x0], [CANAL.x1, 400]]) {
    const skirt = new THREE.Mesh(new THREE.PlaneGeometry(sx1 - sx0, 800).rotateX(-Math.PI / 2), skirtMat);
    skirt.position.set((sx0 + sx1) / 2, -0.4, 0);
    root.add(skirt);
  }

  const waterNormal = makeWaterNormal();
  waterNormal.repeat.set(2, 55);
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x2a7482, emissive: 0x0b2c33, roughness: 0.22, metalness: 0, envMapIntensity: 0.35, normalMap: waterNormal, normalScale: new THREE.Vector2(0.5, 0.5) });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(CANAL.x1 - CANAL.x0, 800).rotateX(-Math.PI / 2), waterMat);
  water.position.set((CANAL.x0 + CANAL.x1) / 2, -1.5, 0);
  root.add(water);
  // quay walls and coping stones
  for (const [x, side] of [[CANAL.x0, -1], [CANAL.x1, 1]] as const) {
    B.box('matte', 0.8, 3.2, 800, x + side * 0.4, -3.1, 0, 0x6b6c63);
    for (let z = -160; z < 160; z += 4) {
      if (Math.abs(z + 1.9) < 8) continue;
      B.box('matte', 1.0, 0.28, 3.9, x + side * 0.45, 0, z + 2, 0xa9a89c);
    }
    // railings
    for (let z = -70; z < 70; z += 3) {
      if (Math.abs(z) < 9 || Math.abs(z + 36) < 2.2) continue;
      if (r() < 0.12) continue; // gaps where the railing is gone
      B.box('metal', 0.1, 1.0, 0.1, x + side * 0.75, 0.28, z, 0x2a2d30);
      B.box('metal', 0.06, 0.06, 3, x + side * 0.75, 1.2, z + 1.5, 0x2a2d30);
    }
  }
  // sunken barge and debris in the water
  B.push(4.2, -1.75, 22, 0.12, 0, 0.14);
  B.box('metal', 4.2, 1.5, 15, 0, 0, 0, 0x4a3327);
  B.box('metal', 3, 1.6, 3.5, 0, 1.4, -4.5, 0x6d6a5c);
  B.box('matte', 3.4, 0.5, 6, 0, 1.4, 2.5, 0x2c2a26);
  B.pop();
  for (let i = 0; i < 16; i++) B.box('matte', 0.5 + r() * 1.6, 0.3, 0.4 + r(), CANAL.x0 + 1 + r() * 8, -1.6, -65 + r() * 130, 0x3b3a30, r() * 3);

  // ------------------------------------------------------------ bridge
  B.box('matte', 11, 0.9, 15.4, 4, -0.9, 0, 0x2c2e31);
  B.box('matte', 11, 0.14, 2.6, 4, 0, -6.4, 0x73736f);
  B.box('matte', 11, 0.14, 2.6, 4, 0, 6.4, 0x73736f);
  for (const zz of [-7.9, 7.9]) {
    B.box('matte', 12.4, 1.05, 0.5, 4, 0, zz, 0x85857c);
    for (let x = -1.5; x <= 9.5; x += 2.75) B.box('matte', 0.7, 1.3, 0.7, x, 0, zz, 0x7a7a72);
  }
  for (const px of [1.6, 6.4]) B.box('matte', 1.4, 3.4, 13, px, -4.2, 0, 0x5c5d57);
  for (let x = -0.5; x < 9; x += 5) B.box('matte', 2.2, 0.03, 0.22, x + 1.2, 0.005, 0, 0xa5a498);
  // wrecked bus across the deck
  B.push(4.2, 0, -0.3, 1.18);
  B.box('gloss', 10.5, 2.5, 2.6, 0, 0.45, 0, 0xb39a3a);
  B.box('glass', 10.2, 0.85, 2.66, 0, 1.75, 0, 0x10161c);
  B.box('gloss', 10.6, 0.28, 2.68, 0, 2.75, 0, 0x8c7a33);
  B.box('matte', 10.5, 0.45, 2.5, 0, 0.05, 0, 0x1b1b1c);
  for (const wx of [-3.6, 3.4]) for (const wz of [-1.25, 1.25]) B.cyl('matte', 0.5, 0.35, wx, 0.5, wz, 0x121212, Math.PI / 2, 0, true);
  B.box('matte', 1.4, 0.06, 2.2, -5.6, 0.02, 0.4, 0x15151a, 0.3); // oil
  B.pop();
  car(-4.5, 2.4, 0.25, 0x6e7d86);
  car(8.6, -2.6, -2.9, 0x7c3b2c, { burnt: true });
  glow(4.5, 3.6, 4.5, 0xff8a2a, 0.55, 'blink', 0.4);

  // ------------------------------------------------------------ lock footbridge
  B.box('metal', 10.4, 0.2, 2.6, 4, 0.05, -36, 0x4a4f52);
  for (const zz of [-37.25, -34.75]) {
    B.box('metal', 10.4, 0.07, 0.07, 4, 1.1, zz, 0x33383b);
    for (let x = -1; x <= 9; x += 1.25) B.box('metal', 0.07, 1.1, 0.07, x, 0.2, zz, 0x33383b);
  }
  B.box('metal', 0.5, 3.6, 5.4, 4.2, -2.9, -40.6, 0x2f3a36, 0.5);
  B.box('metal', 0.5, 3.6, 5.4, 4.2, -2.9, -44.6, 0x2f3a36, -0.5);
  building(13.5, -42, 4.5, 3.6, 3.2, 'brick', { roof: 0x3a2c26, lit: 0 });

  // ------------------------------------------------------------ buildings
  // Tanneurs block (north-west): tall, behind the streets so it never hides them.
  building(-42, -29, 16, 11, 15, 'plaster', { ruined: true, lit: 2, ivy: true });
  building(-60, -22, 12, 16, 18, 'brick', { lit: 1 });
  building(-34, -48, 18, 10, 9, 'concrete', { ruined: true });
  building(-60, -50, 16, 13, 21, 'plaster', { lit: 1 });
  B.box('matte', 22, 1.6, 0.4, -37, 0, -9, 0x7a5a48); // courtyard wall along the avenue
  B.box('matte', 0.4, 1.6, 8, -26.2, 0, -13, 0x7a5a48);
  building(-60, -12.8, 13, 7, 6.4, 'plaster', {});
  building(-8, -52, 9, 8, 7, 'brick', { ruined: true });
  // far backdrop (north and west edges)
  for (const [x, z, w, d, h] of [[-84, -40, 14, 26, 24], [-84, -6, 12, 22, 14], [-84, 30, 12, 30, 17], [-30, -68, 26, 10, 26], [8, -70, 22, 10, 19], [44, -68, 30, 10, 23], [78, -58, 14, 16, 18]] as const)
    building(x, z, w, d, h, r() < 0.5 ? 'plaster' : 'concrete', { plain: true });
  // east bank
  building(20.5, -22, 7, 6, 3.8, 'concrete', { ruined: true });
  building(20, 38, 16, 15, 5, 'metal', { roof: 0x3b4046 });
  building(58, -26, 24, 16, 11, 'hospital', { lit: 3, helipad: true });
  building(50.5, -10.8, 10, 7.6, 6.4, 'hospital', { lit: 1 });
  building(58, -50, 20, 12, 14, 'concrete', { lit: 0 });
  building(53, 12.2, 20, 6.8, 4.4, 'brick', { awning: true, roof: 0x3d3632 });
  building(56, 34, 16, 12, 5.4, 'metal', { roof: 0x444a50 });
  building(62, 56, 20, 10, 5, 'metal', {});
  building(-46, 54, 24, 11, 6.5, 'metal', { roof: 0x3b4046 });
  building(-78, 22, 9, 22, 9, 'concrete', { plain: true });
  // ECHO-7 radio building
  building(-52.5, 26, 10, 8, 4.4, 'concrete', { roof: 0x4b4e4f, lit: 4, noProps: true, warm: true });

  // ------------------------------------------------------------ ECHO-7 compound
  fence(-60, 9.5, -47.5, 9.5);
  fence(-40.5, 9.5, -30, 9.5);
  fence(-30, 9.5, -30, 36);
  fence(-30, 36, -60, 36);
  fence(-60, 36, -60, 9.5);
  B.box('metal', 0.25, 2.8, 0.25, -47.5, 0, 9.5, 0x3b3f42);
  B.box('metal', 0.25, 2.8, 0.25, -40.5, 0, 9.5, 0x3b3f42);
  B.box('metal', 4.8, 2.1, 0.1, -49.6, 0.15, 11.3, 0x4b5257, 0.85); // gate leaf, open
  B.box('matte', 2.6, 0.5, 0.9, -38.6, 0, 8.4, 0x8a7c5c);
  B.box('matte', 2.4, 0.45, 0.85, -38.5, 0.5, 8.4, 0x93835f);
  B.box('matte', 2.6, 0.5, 0.9, -49.6, 0, 8.3, 0x8a7c5c);
  // container on the roof + base mast (always present)
  B.box('metal', 5, 2.3, 2.4, -50.5, 4.75, 27.5, 0x35566b, 0.08);
  mast(-55, 4.75, 23.5, 7, B);
  glow(-55, 12.4, 23.5, 0xff2a1e, 0.9, 'beacon', 0, 1.2, true);
  // table and fire barrel: all there is on the first evening
  B.cyl('metal', 0.45, 0.95, -41, 0, 21.5, 0x3a2f28, 0, 0, true);
  B.box('glow', 0.5, 0.12, 0.5, -41, 0.9, 21.5, 0xffa040);
  glow(-41, 0.1, 21.5, 0xff8a3a, 0.9, 'flicker', 0, 8);
  B.add('glow', UNIT.cone, 0xffb347, 0.3, 0.75, 0.3, -41, 1.3, 21.5, 0, 0, 0, 0);
  B.add('glow', UNIT.cone, 0xff6a1f, 0.2, 0.5, 0.2, -40.9, 1.2, 21.6, 1, 0, 0.1, 0);
  // the operator's field table: radio set, map, mugs
  B.box('metal', 0.6, 0.32, 0.36, -44.5, 0.95, 24.4, 0x3a4a3f);
  B.cyl('metal', 0.015, 0.7, -44.25, 1.27, 24.3, 0x9aa0a4);
  B.box('glow', 0.08, 0.05, 0.02, -44.6, 1.1, 24.59, 0x3fe0c5);
  B.box('matte', 0.8, 0.02, 0.6, -43.5, 0.95, 24.5, 0xcfc6a8, 0.2);
  B.cyl('matte', 0.06, 0.12, -43.9, 0.95, 24.85, 0xb5483a);
  B.cyl('matte', 0.06, 0.12, -44.2, 0.95, 24.9, 0xe8e6d8);
  for (const [bx, bz] of [[-45.6, 25.6], [-42.4, 25.6]]) B.box('matte', 0.5, 0.45, 0.5, bx, 0, bz, 0x6f5b3c, r());
  for (let i = 0; i < 9; i++) B.box('matte', 0.9 + r() * 0.5, 0.7 + r() * 0.3, 0.9, -34 + r() * 3 - (i % 3) * 0.2, i > 5 ? 0.75 : 0, 15 + (i % 3) * 1.2, [0x6f5b3c, 0x7b6844, 0x566046][i % 3], r() * 0.4);
  B.box('matte', 2.2, 0.1, 1.1, -44, 0.85, 24.5, 0x5e4c36);
  for (const [lx, lz] of [[-45, 24.1], [-43, 24.1], [-45, 24.9], [-43, 24.9]]) B.box('matte', 0.1, 0.85, 0.1, lx, 0, lz, 0x3a3027);
  // solar panels
  for (let i = 0; i < 3; i++) {
    B.push(-56.5 + i * 2.9, 0, 31.5, 0, 0.5, 0);
    B.box('glass', 2.6, 0.08, 1.7, 0, 1.25, 0, 0x16233d);
    B.box('metal', 2.7, 0.05, 1.8, 0, 1.2, 0, 0x8b9095);
    B.pop();
    B.box('metal', 0.1, 1.3, 0.1, -56.5 + i * 2.9, 0, 31.9, 0x555a5e);
  }
  B.box('metal', 6.1, 2.5, 2.4, -55.6, 0, 14, 0x2f5a78, 0.03);
  glow(-44, 0.1, 8, 0xffc27a, 0.5, 'steady', 0, 7);
  lamp(-41.6, 9.6, 0xffc27a, true, Math.PI / 2);

  // ------------------------------------------------------------ checkpoint (east bridgehead)
  for (const [x, z, a] of [[12.5, -3.2, 0.1], [15, -1.2, -0.2], [13.2, 2.4, 0.15], [17.5, 3.6, 0.5], [18.5, -3.8, 0], [21, 0.6, 1.2]] as const) jersey(x, z, a);
  building(20.5, -9.4, 2.8, 2.6, 2.7, 'metal', { roof: 0x2f3437, noProps: true });
  fence(11.5, -5.4, 11.5, -9.5);
  fence(11.5, 5.4, 11.5, 9.5);
  fence(24.5, 5.4, 24.5, 9.5);
  truck(23.2, 3.9, 0.25);
  for (let i = 0; i < 14; i++) B.box('matte', 0.85, 0.3, 0.45, 15.5 + (i % 5) * 0.86, Math.floor(i / 5) * 0.3, -5.6 + Math.floor(i / 5) * 0.05, 0x847654, r() * 0.2);
  for (const [x, z] of [[14.2, 4.6], [16.4, 0.8], [19.4, -1.6]]) cone(x, z);
  B.cyl('metal', 0.09, 4.2, 13.6, 0, -6.2, 0x33373a);
  B.box('glow', 0.5, 0.3, 0.5, 13.6, 4.2, -6.2, 0xff9a3a);
  glow(13.6, 0.1, -5.2, 0xff8a2a, 0.75, 'blink', 0, 7.5);
  glow(19.8, 0.1, 3.2, 0xff8a2a, 0.6, 'blink', 1.1, 5);
  B.box('glow', 0.24, 0.24, 0.24, 15, 0.92, -1.2, 0xff7a1a);
  B.box('glow', 0.24, 0.24, 0.24, 17.5, 0.92, 3.6, 0xff7a1a);
  sign(21.6, -5.8, -0.3, 'QUARANTAINE', '#c9a227', '#161616');

  // ------------------------------------------------------------ hospital forecourt
  B.box('matte', 7, 0.25, 6, 43.2, 3.4, -19.5, 0x9ea19d); // entrance canopy
  for (const [px, pz] of [[40.2, -22], [40.2, -17], [45.6, -22], [45.6, -17]]) B.box('matte', 0.3, 3.4, 0.3, px, 0, pz, 0x7f827f);
  B.box('glow', 3.2, 0.5, 0.08, 43.2, 3.75, -16.48, 0x66e0d0);
  glow(43, 0.1, -19, 0x8fe8e0, 0.55, 'flicker', 2, 7.5);
  tent(41.6, -29, 4.6, 4, 0xc4c2b8, B);
  tent(41.6, -34, 4.6, 4, 0xb8b6aa, B);
  ambulance(41.2, -11.5, 1.45);
  for (let i = 0; i < 5; i++) B.box('matte', 0.7, 0.9, 2, 46.5 + i * 0.05, 0.0, -6 + i * 2.3 - 12 * 0, 0x6d7275, r() * 0.3 - 0.15);
  jersey(39.6, -24.5, 1.57);
  jersey(39.6, -14.2, 1.5);
  const hSign = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 1.7), new THREE.MeshBasicMaterial({ map: makeSign('SAINT-ROCH', '#0f3f52', '#e8f1f2'), toneMapped: false }));
  hSign.position.set(50.5, 4.9, -6.94);
  root.add(hSign);

  // ------------------------------------------------------------ garage yard
  for (let i = 0; i < 6; i++) B.cyl('matte', 0.62, 0.3, 45.5 + (i % 2) * 1.4, Math.floor(i / 2) * 0.3, 39 + (i % 2) * 0.3, 0x141414, 0, 0, true);
  for (const [dx, dz] of [[46.8, 27.5], [47.4, 26.4], [46.2, 26.3]]) B.cyl('gloss', 0.42, 1.05, dx, 0, dz, r() < 0.5 ? 0x8a2f24 : 0x3a5a3a, 0, 0, true);
  truck(42.5, 37.5, -1.2, 0x7a3a22);
  car(43, 25.4, 0.4, 0x49545b, { lifted: true });
  B.cyl('metal', 0.45, 0.95, 44.6, 0, 31.2, 0x3a2f28, 0, 0, true);
  B.box('glow', 0.5, 0.12, 0.5, 44.6, 0.9, 31.2, 0xff9440);
  glow(44.6, 0.1, 31.2, 0xff7a2a, 0.7, 'flicker', 3, 6);
  sign(48, 25.4, -1.2, 'LORENTZ', '#7a2a1c', '#e9dcc0');

  // ------------------------------------------------------------ streets: wrecks, barricades, furniture
  car(-30, 2.4, 0.08, 0x8a2f2a);
  car(-33.5, -2.6, 3.3, 0x55606a, { burnt: true });
  car(-58, -2.4, 3.1, 0x9a9383);
  car(-64, 2.6, -0.2, 0x3f5a6b);
  car(-20.2, -17, 1.5, 0x767c66);
  car(-15.8, -27, -1.65, 0x2d3d54, { doors: true });
  car(-16.2, 16, 1.7, 0x8a8f94);
  car(-20.4, 26, 1.45, 0x6b3a2a, { burnt: true });
  car(-19.5, 46, 1.2, 0x4a5a4a);
  van(-14.6, 33.5, 1.52);
  car(28, -2.3, 3.05, 0x9c7b2e);
  car(44, 2.5, 0.1, 0x7c8792, { doors: true });
  car(56, -2.6, 3.2, 0x5d2f2a);
  car(66, 2.2, 0.3, 0x30363c, { burnt: true });
  car(32.2, -27, 1.6, 0x4f6272);
  car(36, -44, -1.5, 0x8c8a80);
  car(36.2, 16, -1.62, 0x7a5a33);
  car(32, 24, 1.3, 0x2f4a3a, { flipped: true });
  car(35.6, 44, -1.4, 0x8a2f2a);
  for (const [x, z, a, c] of [[14.5, 10.4, 1.57, 0x7c8792], [20.5, 10.6, 1.6, 0x8a5a2a], [26.5, 10.3, 1.5, 0x3f4a55], [17.5, 19.6, -1.57, 0x9a9383], [23.6, 19.2, -1.4, 0x55303a]] as const)
    car(x, z, a, c, { burnt: r() < 0.3 });
  // barricade on Rue Saint-Roch south and at quay north
  barricade(34, 26.5, 0);
  barricade(-18, -44, 0.1);
  barricade(60, 0.5, 1.5);
  // bus shelter, benches, bins
  B.box('metal', 3.6, 0.1, 1.4, -27, 2.4, -6.6, 0x3d4a52);
  B.box('glass', 3.6, 2.2, 0.06, -27, 0.2, -7.25, 0x1c2a33);
  for (const dx of [-1.7, 1.7]) B.box('metal', 0.1, 2.4, 0.1, -27 + dx, 0, -6, 0x2b2f31);
  for (const [x, z, a] of [[-9, -14, 1.57], [-9, 12, 1.57], [-8, 40, 1.57], [18, -30, 0.3], [-25, 6.4, 0]] as const) {
    B.push(x, 0, z, a);
    B.box('matte', 1.9, 0.1, 0.5, 0, 0.45, 0, 0x5b4a36);
    B.box('matte', 1.9, 0.5, 0.08, 0, 0.55, -0.25, 0x5b4a36);
    B.box('metal', 0.08, 0.45, 0.5, -0.8, 0, 0, 0x2a2a2a);
    B.box('metal', 0.08, 0.45, 0.5, 0.8, 0, 0, 0x2a2a2a);
    B.pop();
  }
  // street lamps and power poles
  for (const [x, lit] of [[-66, false], [-30, false], [28, false], [48, true], [68, false]] as const) lamp(x, -6.3, 0xffc890, lit, 0);
  lamp(-12.6, 6.3, 0xffc890, false, Math.PI);
  lamp(-22.6, -30, 0xffc890, false, -Math.PI / 2);
  lamp(38.6, 30, 0xffb070, true, Math.PI / 2);
  const wires: number[] = [];
  const poles: [number, number][] = [];
  for (let z = -62; z <= 62; z += 20.5) if (Math.abs(z) > 9) poles.push([-23.2, z + (r() - 0.5) * 2]);
  pole(poles);
  const poles2: [number, number][] = [];
  for (let z = 10; z <= 64; z += 18) poles2.push([29.4, z]);
  pole(poles2);
  if (wires.length) {
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
    root.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x0c0d0f, transparent: true, opacity: 0.8 })));
  }
  // traffic lights (dead) at both crossroads
  for (const [x, z] of [[-23.4, -5.6], [-12.6, 5.6], [28.6, -5.6], [39.4, 5.6]]) {
    B.box('metal', 0.14, 3.6, 0.14, x, 0, z, 0x262a2c);
    B.box('matte', 0.36, 0.95, 0.3, x, 3.2, z, 0x161819);
  }

  // ------------------------------------------------------------ rubble, rubbish, vegetation
  const blocked = (x: number, z: number, pad = 0.6) => {
    if (x > CANAL.x0 - 1 - pad && x < CANAL.x1 + 1 + pad) return true;
    for (const rd of ROADS) {
      const hw = rd.w / 2 + pad;
      if (rd.z0 === rd.z1 ? Math.abs(z - rd.z0) < hw && x > Math.min(rd.x0, rd.x1) && x < Math.max(rd.x0, rd.x1) : Math.abs(x - rd.x0) < hw && z > Math.min(rd.z0, rd.z1) && z < Math.max(rd.z0, rd.z1)) return true;
    }
    for (const [x0, z0, x1, z1] of footprints) if (x > x0 - pad && x < x1 + pad && z > z0 - pad && z < z1 + pad) return true;
    return false;
  };
  const inYard = (x: number, z: number) => (x > -61 && x < -29 && z > 8 && z < 37) || (x > 38 && x < 47 && z > -37 && z < -5) || (x > 11 && x < 30 && z > 5 && z < 25);
  // rubbish piles along kerbs
  for (let i = 0; i < 46; i++) {
    const along = r() < 0.5;
    const x = along ? -70 + r() * 140 : (r() < 0.5 ? -18 : 34) + (r() < 0.5 ? -1 : 1) * (5.2 + r() * 1.6);
    const z = along ? (r() < 0.5 ? -1 : 1) * (5.8 + r() * 1.6) : -60 + r() * 120;
    if (x > CANAL.x0 - 2 && x < CANAL.x1 + 2) continue;
    const n = 2 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      const c = [0x16181a, 0x1d2428, 0x2a3b55, 0x6a6558, 0x3d3a34][Math.floor(r() * 5)];
      if (r() < 0.6) B.blob('matte', 0.3 + r() * 0.28, x + (r() - 0.5) * 1.6, 0.22, z + (r() - 0.5) * 1.6, c, 0.75, true);
      else B.box('matte', 0.5 + r() * 0.5, 0.3 + r() * 0.4, 0.5 + r() * 0.4, x + (r() - 0.5) * 1.8, 0, z + (r() - 0.5) * 1.8, 0x7a6a4c, r() * 3);
    }
  }
  // trees: quay strip, park on the east bank, courtyards
  const treeSpots: [number, number, number][] = [];
  for (let z = -62; z < 64; z += 8.5) if (Math.abs(z) > 10 && Math.abs(z + 36) > 4) treeSpots.push([-8 + (r() - 0.5) * 5, z + (r() - 0.5) * 3, 0.9 + r() * 0.5]);
  for (let i = 0; i < 26; i++) treeSpots.push([12 + r() * 17, -52 + r() * 43, 0.8 + r() * 0.7]);
  for (const [x, z] of [[-27, -40], [-26, -18], [-50, -40], [-68, -36], [-66, 4.5], [-26, 42], [-34, 44], [-62, 44], [44, 48], [70, 14], [70, -8], [46, -42], [72, -40], [26, 30], [12, 48], [26, 52], [-27, 16], [-64, -6.2], [50, 6.6]])
    treeSpots.push([x, z, 0.9 + r() * 0.6]);
  for (const [x, z, sc] of treeSpots) if (!blocked(x, z, 1.2) && !(Math.abs(z + 36) < 3 && x > 8)) tree(x, z, sc);
  // bushes and ivy mounds
  for (let i = 0; i < q.bushes; i++) {
    const x = -90 + r() * 180;
    const z = -68 + r() * 136;
    if (blocked(x, z, 0.4) || inYard(x, z)) continue;
    const c = [0x3f5226, 0x4c5f2a, 0x34461f, 0x5c6630, 0x6b5e2e][Math.floor(r() * 5)];
    B.blob('foliage', 0.6 + r() * 1.1, x, 0.3, z, c, 0.6 + r() * 0.3);
  }
  // rubble scattered in vacant lots
  for (let i = 0; i < 120; i++) {
    const x = -80 + r() * 160;
    const z = -64 + r() * 128;
    if (blocked(x, z, 0.2)) continue;
    B.blob('foliage', 0.2 + r() * 0.45, x, 0.12, z, [0x6f6d66, 0x5b5a55, 0x7c756a][i % 3], 0.6, true);
  }

  // ------------------------------------------------------------ assemble
  root.add(B.build(mats, q.shadows));
  const facadeMats = new Map<FacadeStyle, THREE.MeshStandardMaterial>();
  let fi = 0;
  for (const [style, list] of facades) {
    const m = new THREE.MeshStandardMaterial({ map: makeFacade(style, 11 + fi++ * 7, q.tier !== 'low'), roughness: style === 'metal' ? 0.6 : 0.9, metalness: style === 'metal' ? 0.4 : 0 });
    facadeMats.set(style, m);
    const mesh = new THREE.Mesh(mergeGeometries(list, false)!, m);
    mesh.castShadow = mesh.receiveShadow = q.shadows;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
  }

  // grass tufts (instanced)
  // three leaning blades per tuft
  const blade = (lean: number, turn: number) => new THREE.ConeGeometry(0.07, 0.6, 3, 1, true).translate(0, 0.3, 0).rotateZ(lean).rotateY(turn);
  const tuftGeo = mergeGeometries([blade(0.3, 0), blade(-0.35, 2.1), blade(0.2, 4.2), blade(0, 1)])!;
  const tufts = new THREE.InstancedMesh(tuftGeo, new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true, side: THREE.DoubleSide }), q.grass);
  const dummy = new THREE.Object3D();
  const tc = new THREE.Color();
  let placed = 0;
  for (let i = 0; i < q.grass * 4 && placed < q.grass; i++) {
    let x = -92 + r() * 184;
    let z = -70 + r() * 140;
    // bias: weeds love kerbs and cracks
    if (r() < 0.35) {
      if (r() < 0.5) z = (r() < 0.5 ? -1 : 1) * (5 + r() * 3.2);
      else x = (r() < 0.5 ? -18 : 34) + (r() < 0.5 ? -1 : 1) * (4 + r() * 3);
    }
    if (x > CANAL.x0 - 1.2 && x < CANAL.x1 + 1.2) continue;
    let onAsphalt = false;
    for (const rd of ROADS) if (rd.kind !== 'alley' && (rd.z0 === rd.z1 ? Math.abs(z - rd.z0) < rd.w / 2 - 0.4 : Math.abs(x - rd.x0) < rd.w / 2 - 0.4)) onAsphalt = true;
    if (onAsphalt && r() < 0.93) continue;
    let inside = false;
    for (const [x0, z0, x1, z1] of footprints) if (x > x0 && x < x1 && z > z0 && z < z1) inside = true;
    if (inside || (inYard(x, z) && r() < 0.85)) continue;
    dummy.position.set(x, 0, z);
    dummy.rotation.set((r() - 0.5) * 0.25, r() * 6.28, (r() - 0.5) * 0.25);
    const sc = 0.7 + r() * 1.1;
    dummy.scale.set(sc * (1 + r() * 0.8), sc, sc * (1 + r() * 0.8));
    dummy.updateMatrix();
    tufts.setMatrixAt(placed, dummy.matrix);
    tc.setHex([0x556a2c, 0x64742f, 0x47592a, 0x7a7a3a, 0x8a7a44, 0x3e5024][Math.floor(r() * 6)]).multiplyScalar(0.8 + r() * 0.4);
    tufts.setColorAt(placed, tc);
    placed++;
  }
  tufts.count = placed;
  tufts.instanceMatrix.needsUpdate = true;
  tufts.receiveShadow = q.shadows;
  root.add(tufts);

  // interior outlines (abstract interiors: the roof lights up when someone is inside)
  const interiors: Record<string, THREE.Mesh> = {};
  const outline = (id: string, x: number, z: number, w: number, d: number, h: number) => {
    const parts = [new THREE.BoxGeometry(w, 0.12, 0.3).translate(0, 0, -d / 2), new THREE.BoxGeometry(w, 0.12, 0.3).translate(0, 0, d / 2), new THREE.BoxGeometry(0.3, 0.12, d).translate(-w / 2, 0, 0), new THREE.BoxGeometry(0.3, 0.12, d).translate(w / 2, 0, 0), new THREE.BoxGeometry(w - 0.3, 0.02, d - 0.3)];
    const m = new THREE.Mesh(mergeGeometries(parts)!, new THREE.MeshBasicMaterial({ color: 0x3fe0c5, transparent: true, opacity: 0.0, depthWrite: false, toneMapped: false }));
    m.position.set(x, h + 0.9, z);
    m.visible = false;
    root.add(m);
    interiors[id] = m;
  };
  outline('apts', -42, -29, 16, 11, 15);
  outline('hosp_in', 58, -26, 24, 16, 11);
  outline('garage', 56, 34, 16, 12, 5.4);

  // shelter upgrade visuals
  const up: Record<string, THREE.Group[]> = { antenna: [], infirmary: [], generator: [], storage: [] };
  const floods: Glow[] = [];
  const sub = (key: keyof typeof up, fn: (b: Batch) => void) => {
    const b = new Batch(r);
    fn(b);
    const g = b.build(mats, q.shadows);
    g.visible = false;
    root.add(g);
    up[key].push(g);
  };
  sub('antenna', (b) => {
    b.cyl('metal', 1.1, 0.25, -49.5, 7.6, 24.3, 0xc9cdd0, 0.9, 0, true);
    b.cyl('metal', 0.06, 1.0, -49.5, 7.05, 24.3, 0x6d7275);
    mast(-55, 11.7, 23.5, 3.5, b);
  });
  sub('antenna', (b) => {
    mast(-55, 15.1, 23.5, 5, b);
    b.box('metal', 2.6, 0.08, 0.08, -55, 17.5, 23.5, 0x8d9296);
    b.box('metal', 2.0, 0.08, 0.08, -55, 18.6, 23.5, 0x8d9296);
    b.box('metal', 1.4, 0.08, 0.08, -55, 19.6, 23.5, 0x8d9296);
  });
  sub('infirmary', (b) => {
    tent(-36.5, 32.4, 6.4, 4.4, 0xc7c2ae, b);
    b.box('matte', 1.9, 0.5, 0.8, -33.2, 0, 29.4, 0x9aa3a0);
  });
  sub('infirmary', (b) => {
    b.box('metal', 4.2, 2.4, 2.3, -33.6, 0, 21.2, 0xd5d6d0, 1.57);
    b.box('glow', 0.7, 0.2, 0.05, -34.78, 1.5, 21.2, 0x3fd0a4, 1.57);
  });
  sub('generator', (b) => {
    for (const [fx, fz] of [[-58.6, 11], [-31.4, 11], [-31.4, 34.6], [-58.6, 34.6]]) {
      b.cyl('metal', 0.1, 6.5, fx, 0, fz, 0x3d4245);
      b.box('metal', 1.1, 0.5, 0.5, fx, 6.4, fz, 0x2b2e30, Math.atan2(-44 - fx, 22 - fz));
      b.box('glow', 0.9, 0.34, 0.1, fx + Math.sign(-44 - fx) * 0.2, 6.45, fz + Math.sign(22 - fz) * 0.2, 0xfff1d0, Math.atan2(-44 - fx, 22 - fz));
    }
    b.box('glow', 0.3, 0.12, 0.05, -45, 1.1, 32.72, 0x6dff8a);
  });
  sub('generator', (b) => {
    for (const [fx, fz] of [[-44, 6.2], [-62, 22], [-28, 22]]) {
      b.cyl('metal', 0.1, 5, fx, 0, fz, 0x3d4245);
      b.box('glow', 0.8, 0.3, 0.3, fx, 5, fz, 0xfff1d0);
    }
  });
  sub('storage', (b) => {
    b.box('metal', 6.1, 2.5, 2.4, -55.4, 2.5, 14.2, 0x7a3b25, -0.05);
    b.box('metal', 6.1, 2.5, 2.4, -55.6, 0, 17, 0x44624a, 0.02);
  });
  sub('storage', (b) => {
    b.box('metal', 2.4, 2.5, 6.1, -33.4, 0, 14, 0x8a7a3a, 0.04);
    for (let i = 0; i < 8; i++) b.box('matte', 1, 0.8, 1, -37 + (i % 4) * 1.1, Math.floor(i / 4) * 0.8, 11.4, 0x6f5b3c, 0.1);
  });
  // objects brought back from the district: each appears in the yard once it is installed
  const found: Record<string, THREE.Group> = {};
  const fsub = (id: string, fn: (b: Batch) => void) => {
    const b = new Batch(r);
    fn(b);
    const g = b.build(mats, q.shadows);
    g.visible = false;
    root.add(g);
    found[id] = g;
  };
  fsub('tarp', (b) => {
    tent(-36.5, 26, 6.4, 4.6, 0xb9b39e, b);
    b.box('glow', 0.9, 0.28, 0.05, -36.5, 1.6, 28.36, 0x3fd0a4);
    b.box('glow', 0.28, 0.9, 0.05, -36.5, 1.3, 28.36, 0x3fd0a4);
  });
  fsub('genset', (b) => {
    b.box('gloss', 2.6, 1.3, 1.4, -45, 0.15, 32, 0xc49a22);
    b.box('metal', 0.9, 1.0, 1.2, -43.4, 0.15, 32, 0x4b4d50);
    b.box('matte', 2.9, 0.15, 1.7, -45, 0, 32, 0x2a2a2a);
    b.cyl('metal', 0.12, 1.3, -46, 1.4, 32.3, 0x2b2b2b);
    for (const [dx, dz, c] of [[-48, 33, 0x8a2f24], [-48.9, 32.3, 0x2d4a63], [-48.2, 31.5, 0x8a2f24]]) b.cyl('gloss', 0.42, 1.05, dx, 0, dz, c, 0, 0, true);
  });
  fsub('water', (b) => {
    b.cyl('gloss', 1.25, 2.1, -57, 0.5, 31.5, 0x3f6f8a, 0, 0, true);
    b.box('metal', 3, 0.5, 3, -57, 0, 31.5, 0x3b3f42);
    b.cyl('metal', 0.08, 0.9, -55.6, 0.4, 31.5, 0x8d9296);
  });
  fsub('stove', (b) => {
    b.box('metal', 0.9, 1.0, 0.8, -46.5, 0, 20.6, 0x26221f);
    b.cyl('metal', 0.12, 2.4, -46.5, 1.0, 20.6, 0x2b2b2b);
    b.box('glow', 0.4, 0.3, 0.05, -46.5, 0.35, 21.02, 0xff7a2a);
    for (let i = 0; i < 5; i++) b.box('matte', 0.9, 0.22, 0.22, -45.2, 0.02 + (i % 2) * 0.22, 20.2 + Math.floor(i / 2) * 0.26, 0x6b4a2c, 0.1);
  });
  fsub('shelves', (b) => {
    for (let i = 0; i < 3; i++) {
      b.box('metal', 3.2, 0.08, 0.9, -39, 0.5 + i * 0.75, 11.2, 0x6d7275);
      b.box('matte', 0.8, 0.5, 0.7, -40 + i * 0.95, 0.56 + i * 0.75, 11.2, i % 2 ? 0x6f5b3c : 0x4f6a52);
    }
    for (const dx of [-40.6, -37.4]) b.box('metal', 0.08, 2.3, 0.9, dx, 0, 11.2, 0x4b5257);
  });
  fsub('flood', (b) => {
    b.cyl('metal', 0.07, 3.2, -44, 0, 10.6, 0x3d4245);
    b.box('metal', 1.0, 0.6, 0.4, -44, 3.2, 10.6, 0x2b2e30);
    b.box('glow', 0.9, 0.5, 0.08, -44, 3.25, 10.36, 0xfff1d0);
  });
  fsub('seeds', (b) => {
    for (let i = 0; i < 3; i++) {
      b.box('matte', 3.2, 0.45, 1.1, -34 , 0, 31.2 + i * 1.5, 0x5a4632);
      b.box('foliage', 2.9, 0.35, 0.85, -34, 0.42, 31.2 + i * 1.5, 0x4f8a3c);
    }
  });
  fsub('dish', (b) => {
    b.cyl('metal', 1.5, 0.3, -52.5, 7.7, 29, 0xd5d8da, 0.8, 0, true);
    b.cyl('metal', 0.07, 1.2, -52.5, 6.9, 29, 0x6d7275);
  });
  fsub('cots', (b) => {
    for (let i = 0; i < 3; i++) {
      b.box('matte', 0.9, 0.12, 2.0, -40.5 + i * 1.3, 0.35, 29.2, 0x5d6a4a);
      b.box('metal', 0.9, 0.35, 0.06, -40.5 + i * 1.3, 0, 28.3, 0x3d4245);
      b.box('metal', 0.9, 0.35, 0.06, -40.5 + i * 1.3, 0, 30.1, 0x3d4245);
    }
  });
  fsub('battery', (b) => {
    for (let i = 0; i < 4; i++) b.box('gloss', 0.7, 0.55, 0.45, -42.2, 0.15, 30.9 + i * 0.55, 0x23282c);
    b.box('glow', 0.12, 0.12, 0.05, -41.84, 0.5, 31.2, 0x6dff8a);
  });
  fsub('bench', (b) => {
    b.box('matte', 3.0, 0.14, 1.1, -50.5, 0.95, 20.2, 0x6b4a2c);
    for (const [dx, dz] of [[-51.8, 19.8], [-49.2, 19.8], [-51.8, 20.6], [-49.2, 20.6]]) b.box('metal', 0.1, 0.95, 0.1, dx, 0, dz, 0x3d4245);
    b.box('metal', 0.5, 0.35, 0.35, -51.3, 1.1, 20.2, 0x8a2f24);
    b.box('metal', 2.2, 0.9, 0.06, -50.5, 1.1, 19.7, 0x4b5257);
  });
  for (const [fx, fz] of [[-52, 15], [-37, 15], [-37, 30], [-52, 31]]) floods.push(glow(fx, 0.1, fz, 0xfff0d2, 0.0, 'flood', 0, 13));
  for (const [fx, fz] of [[-44, 3], [-64, 22], [-26, 22]]) floods.push(glow(fx, 0.1, fz, 0xfff0d2, 0.0, 'flood', 0, 11));

  // optional real lights (high tier only)
  const pointLights: THREE.PointLight[] = [];
  if (q.pointLights > 0) {
    const defs: [number, number, number, number, number][] = [[-41, 2.2, 21.5, 0xff8a3a, 60], [15, 3, -3, 0xff8a2a, 70], [43, 3, -19, 0x8fe8e0, 50]];
    for (const [x, y, z, c, i] of defs.slice(0, q.pointLights)) {
      const l = new THREE.PointLight(c, i, 26, 1.8);
      l.position.set(x, y, z);
      root.add(l);
      pointLights.push(l);
    }
  }

  // smoke: a few soft puffs rising from each fire
  const smokeTex = makeGlow();
  const puffs: { m: THREE.Mesh; x: number; z: number; t: number; bus: boolean }[] = [];
  const puffGeo = new THREE.PlaneGeometry(1, 1);
  const addSmoke = (x: number, z: number, n: number, bus: boolean) => {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ map: smokeTex, color: 0x2a2a2e, transparent: true, opacity: 0, depthWrite: false }));
      m.rotation.set(-0.7, Math.PI / 4, 0, 'YXZ');
      m.renderOrder = 2;
      root.add(m);
      puffs.push({ m, x, z, t: i / n, bus });
    }
  };
  addSmoke(-41, 21.5, 4, false);
  addSmoke(44.6, 31.2, 3, false);
  addSmoke(4.2, -0.3, 6, true);
  let busOn = false;

  const flareLight = glow(34, 9, 34, 0xff5a3a, 0, 'steady', 0, 60);
  // the bus burns on the days the bridge is cut
  const busFire = [glow(4.2, 0.2, -0.3, 0xff6a1a, 0, 'flicker', 1, 17), glow(4.2, 3.4, -0.3, 0xffb040, 0, 'flicker', 4, 7, true), glow(2.4, 3.1, 2.4, 0xff8a2a, 0, 'flicker', 7, 5, true)];
  let flareT = -1;

  // ============================================================ helpers
  function glow(x: number, y: number, z: number, color: number, base: number, kind: Glow['kind'], phase = 0, size = 6, billboard = false): Glow {
    const m = new THREE.Mesh(sharedGlowGeo(), new THREE.MeshBasicMaterial({ map: sharedGlowTex(), color, transparent: true, opacity: base, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    if (!billboard) m.rotation.x = -Math.PI / 2;
    else m.rotation.set(-0.7, Math.PI / 4, 0, 'YXZ');
    m.position.set(x, y, z);
    m.scale.setScalar(size);
    m.renderOrder = 3;
    root.add(m);
    const gl: Glow = { mesh: m, base, kind, phase };
    glows.push(gl);
    return gl;
  }

  function building(x: number, z: number, w: number, d: number, h: number, style: FacadeStyle, o: { roof?: number; ruined?: boolean; lit?: number; ivy?: boolean; awning?: boolean; plain?: boolean; helipad?: boolean; noProps?: boolean; warm?: boolean }) {
    footprints.push([x - w / 2, z - d / 2, x + w / 2, z + d / 2]);
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    const off = Math.floor(r() * 4);
    for (let i = 0; i < uv.count; i++) {
      const face = Math.floor(i / 4);
      const span = face < 2 ? d : face < 4 ? w : w;
      if (face === 2 || face === 3) uv.setXY(i, uv.getX(i) * 0.05, uv.getY(i) * 0.05);
      else uv.setXY(i, (uv.getX(i) * span) / 8 + off, (uv.getY(i) * h) / 6.4);
    }
    g.translate(x, h / 2, z);
    const ng = g.toNonIndexed();
    g.dispose();
    if (!facades.has(style)) facades.set(style, []);
    facades.get(style)!.push(ng);
    const roofC = o.roof ?? [0x3a3c3d, 0x45423d, 0x2f3234, 0x4a4541][Math.floor(r() * 4)];
    B.box('matte', w + 0.3, 0.3, d + 0.3, x, h, z, roofC);
    if (o.plain) return;
    // parapet
    const pc = style === 'brick' ? 0x5d4034 : style === 'hospital' ? 0x9a9d99 : style === 'metal' ? 0x4d555c : 0x7a7566;
    B.box('matte', w + 0.3, 0.6, 0.3, x, h + 0.3, z - d / 2, pc);
    B.box('matte', w + 0.3, 0.6, 0.3, x, h + 0.3, z + d / 2, pc);
    B.box('matte', 0.3, 0.6, d, x - w / 2, h + 0.3, z, pc);
    B.box('matte', 0.3, 0.6, d, x + w / 2, h + 0.3, z, pc);
    if (!o.noProps && w > 6) {
      const n = Math.floor((w * d) / 45) + 1;
      for (let i = 0; i < n; i++) {
        const px = x + (r() - 0.5) * (w - 3);
        const pz = z + (r() - 0.5) * (d - 3);
        const k = r();
        if (k < 0.4) B.box('metal', 1.4, 0.8, 1.1, px, h + 0.3, pz, 0x6a6f72, r());
        else if (k < 0.6) B.cyl('metal', 0.9, 1.6, px, h + 0.3, pz, 0x5b4a3c, 0, 0, true);
        else if (k < 0.8) B.box('matte', 2, 1.6, 1.6, px, h + 0.3, pz, pc);
        else {
          B.cyl('metal', 0.05, 3, px, h + 0.3, pz, 0x25282a);
          B.box('metal', 1.2, 0.05, 0.05, px, h + 2.6, pz, 0x25282a);
        }
      }
    }
    if (o.helipad) {
      B.cyl('matte', 5, 0.06, x + 3, h + 0.3, z, 0x565b5c, 0, 0, true);
      B.cyl('matte', 4.3, 0.07, x + 3, h + 0.3, z, 0x3c4041, 0, 0, true);
      B.box('matte', 0.5, 0.09, 3, x + 2, h + 0.3, z, 0xcfd2cc);
      B.box('matte', 0.5, 0.09, 3, x + 4, h + 0.3, z, 0xcfd2cc);
      B.box('matte', 2, 0.09, 0.5, x + 3, h + 0.3, z, 0xcfd2cc);
    }
    if (o.ruined) {
      // broken upper wall and a rubble fan at the base
      for (let i = 0; i < 9; i++) {
        const along = r() < 0.5;
        B.box('matte', along ? 1 + r() * 2.4 : 0.35, 0.6 + r() * 2.2, along ? 0.35 : 1 + r() * 2.4, x + (along ? (r() - 0.5) * w : (r() < 0.5 ? -1 : 1) * w * 0.5), h + 0.3, z + (along ? (r() < 0.5 ? -1 : 1) * d * 0.5 : (r() - 0.5) * d), pc, 0, 0, (r() - 0.5) * 0.2);
      }
      for (let i = 0; i < 26; i++) {
        const side = r() < 0.5;
        const rx = side ? x + w / 2 + r() * 3.2 : x + (r() - 0.5) * w;
        const rz = side ? z + (r() - 0.5) * d : z + d / 2 + r() * 3.2;
        B.blob('foliage', 0.3 + r() * 0.75, rx, 0.2, rz, [0x77736a, 0x66625a, 0x8a8478, 0x5a4a40][i % 4], 0.65, true);
      }
    }
    if (o.ivy) {
      for (let i = 0; i < 14; i++) B.blob('foliage', 0.8 + r() * 1.3, x + w / 2 + 0.1, 0.5 + r() * h * 0.7, z + (r() - 0.5) * d, 0x3c5226, 1.2);
      for (let i = 0; i < 10; i++) B.blob('foliage', 0.8 + r() * 1.2, x + (r() - 0.5) * w, 0.5 + r() * h * 0.5, z + d / 2 + 0.1, 0x44592a, 1.2);
    }
    if (o.awning) {
      for (let ax = x - w / 2 + 2; ax < x + w / 2 - 1; ax += 4.4) B.box('matte', 3.4, 0.12, 1.5, ax + 0.4, 2.7, z + (z < 0 ? d / 2 + 0.7 : -d / 2 - 0.7), [0x7a2f26, 0x2f5a4a, 0x8a7a3a][Math.floor(r() * 3)], 0, z < 0 ? 0.25 : -0.25);
    }
    // a few lit windows on the camera-facing sides
    const lit = o.lit ?? 0;
    const cols = style === 'hospital' ? 4 : 3;
    for (let i = 0; i < lit * q.litScale; i++) {
      const south = r() < 0.5;
      const span = south ? w : d;
      const col = Math.floor(r() * Math.floor((span / 8) * cols));
      const u = ((col + 0.5) * 8) / cols;
      if (u > span - 0.8) continue;
      const fl = Math.floor(r() * Math.floor(h / 3.2));
      const wy = Math.floor(fl / 2) * 6.4 + (fl % 2 ? 4.9 : 1.7);
      if (wy > h - 1) continue;
      const c = o.warm ? 0xffc27a : style === 'hospital' ? 0xa8f0e4 : r() < 0.7 ? 0xffb86a : 0xd8e6ff;
      if (south) B.box('glow', 1.1, 1.5, 0.06, x - w / 2 + u, wy - 0.75, z + d / 2 + 0.02, c);
      else B.box('glow', 0.06, 1.5, 1.1, x + w / 2 + 0.02, wy - 0.75, z + d / 2 - u, c);
    }
  }

  function car(x: number, z: number, a: number, color: number, o: { burnt?: boolean; doors?: boolean; flipped?: boolean; lifted?: boolean } = {}) {
    const c = o.burnt ? 0x2a2522 : color;
    const mat: Mat = o.burnt ? 'matte' : 'gloss';
    B.push(x, o.flipped ? 1.55 : o.lifted ? 0.5 : 0, z, a, 0, o.flipped ? Math.PI : (r() - 0.5) * 0.06);
    B.box(mat, 4.3, 0.72, 1.82, 0, 0.32, 0, c);
    B.box('glass', 2.25, 0.6, 1.66, -0.25, 1.04, 0, o.burnt ? 0x0b0b0b : 0x121a22);
    B.box(mat, 2.1, 0.1, 1.7, -0.25, 1.6, 0, c);
    B.box(mat, 0.12, 0.6, 1.7, -1.35, 1.04, 0, c);
    B.box(mat, 0.12, 0.6, 1.7, 0.85, 1.04, 0, c, 0, 0, -0.3);
    for (const wx of [-1.4, 1.35]) for (const wz of [-0.86, 0.86]) B.cyl('matte', 0.36, 0.26, wx, 0.36, wz, 0x111111, Math.PI / 2, 0, true);
    if (o.doors) {
      B.box(mat, 1.1, 0.95, 0.08, -0.2, 0.4, 1.35, c, 0.9);
      B.box(mat, 1.1, 0.95, 0.08, -0.2, 0.4, -1.35, c, -0.8);
    }
    if (!o.burnt && r() < 0.5) B.box('matte', 1.6, 0.03, 1.2, 1.3 + r() * 0.3, 0.74, 0, 0x6b3a22); // rust patch on bonnet
    // bumpers, lights, mirrors, door seams: small parts that pay off when zoomed in
    B.box('matte', 0.14, 0.22, 1.86, 2.16, 0.3, 0, 0x1a1b1d);
    B.box('matte', 0.14, 0.22, 1.86, -2.16, 0.3, 0, 0x1a1b1d);
    for (const lz of [-0.66, 0.66]) {
      B.box(o.burnt ? 'matte' : 'glass', 0.06, 0.16, 0.36, 2.16, 0.68, lz, o.burnt ? 0x111111 : 0xd9d6c4);
      B.box('matte', 0.06, 0.14, 0.34, -2.16, 0.7, lz, o.burnt ? 0x111111 : 0x7a1f1a);
      B.box(mat, 0.16, 0.1, 0.2, 0.78, 1.0, lz * 1.52, c);
    }
    B.box('matte', 0.03, 0.62, 1.84, -0.3, 0.38, 0, 0x101113);
    B.pop();
    footprints.push([x - 2.4, z - 2.4, x + 2.4, z + 2.4]);
  }

  function van(x: number, z: number, a: number) {
    B.push(x, 0, z, a);
    B.box('gloss', 5.2, 2.0, 2.1, 0, 0.4, 0, 0xb7b9b4);
    B.box('glass', 1.3, 0.8, 2.14, 1.85, 1.5, 0, 0x121a22);
    B.box('gloss', 0.1, 1.7, 0.95, -2.7, 0.5, 0.75, 0xa9aba6, -1.0);
    for (const wx of [-1.7, 1.7]) for (const wz of [-1.0, 1.0]) B.cyl('matte', 0.4, 0.28, wx, 0.4, wz, 0x111111, Math.PI / 2, 0, true);
    B.box('matte', 0.9, 0.7, 0.9, -3.6, 0, 0.3, 0x6f5b3c, 0.4);
    B.box('matte', 0.8, 0.6, 0.8, -3.9, 0, -0.8, 0x7b6844, 0.1);
    B.pop();
    footprints.push([x - 2, z - 3.2, x + 2, z + 3.2]);
  }

  function truck(x: number, z: number, a: number, color = 0x4d553a) {
    B.push(x, 0, z, a);
    B.box('matte', 4.4, 1.9, 2.4, -1.3, 0.9, 0, color);
    B.box('matte', 2.0, 1.7, 2.3, 2.2, 0.8, 0, color);
    B.box('glass', 0.1, 0.75, 2.0, 3.22, 1.55, 0, 0x121a22);
    B.box('matte', 6.6, 0.35, 2.2, 0, 0.5, 0, 0x1b1b1b);
    for (const wx of [-2.4, -1.2, 2.2]) for (const wz of [-1.15, 1.15]) B.cyl('matte', 0.5, 0.32, wx, 0.5, wz, 0x111111, Math.PI / 2, 0, true);
    B.pop();
    footprints.push([x - 3.4, z - 3.4, x + 3.4, z + 3.4]);
  }

  function ambulance(x: number, z: number, a: number) {
    B.push(x, 0, z, a);
    B.box('gloss', 5.4, 2.1, 2.1, 0, 0.4, 0, 0xcfd1cc);
    B.box('gloss', 5.42, 0.3, 2.12, 0, 1.2, 0, 0xc2452c);
    B.box('glass', 1.2, 0.8, 2.14, 2.0, 1.6, 0, 0x121a22);
    B.box('glow', 0.9, 0.16, 0.3, 1.6, 2.5, 0, 0x4a7dff);
    B.box('gloss', 0.1, 1.8, 1.0, -2.75, 0.5, 0.9, 0xcfd1cc, -1.1);
    for (const wx of [-1.7, 1.7]) for (const wz of [-1.0, 1.0]) B.cyl('matte', 0.4, 0.28, wx, 0.4, wz, 0x111111, Math.PI / 2, 0, true);
    B.box('metal', 1.9, 0.5, 0.6, -4.2, 0, 0.2, 0x8d9296, 0.5);
    B.pop();
    footprints.push([x - 3, z - 3, x + 3, z + 3]);
  }

  function jersey(x: number, z: number, a: number) {
    B.push(x, 0, z, a);
    B.box('matte', 0.7, 0.35, 2.6, 0, 0, 0, 0x8d8c84);
    B.box('matte', 0.36, 0.6, 2.6, 0, 0.3, 0, 0x99988f);
    B.box('matte', 0.38, 0.12, 0.9, 0, 0.55, 0, 0xb8862b);
    B.pop();
  }

  function cone(x: number, z: number) {
    B.add('matte', UNIT.cone, 0xd2591e, 0.22, 0.6, 0.22, x, 0.3, z, 0, r() < 0.3 ? 1.5 : 0, 0);
    B.box('matte', 0.4, 0.04, 0.4, x, 0, z, 0x1a1a1a);
  }

  function barricade(x: number, z: number, a: number) {
    B.push(x, 0, z, a);
    for (let i = -3; i <= 3; i += 1.5) {
      B.box('matte', 1.3, 0.14, 1.1, i, 0.0, (r() - 0.5) * 0.6, 0x6b5536, r() * 0.3);
      B.box('matte', 1.3, 1.1, 0.12, i, 0.1, (r() - 0.5) * 0.5, 0x7a6240, r() * 0.3, 0.25);
    }
    for (let i = 0; i < 5; i++) B.cyl('matte', 0.4, 0.28, -3.6 + r() * 7.2, 0.14 + Math.floor(r() * 2) * 0.28, 0.9 + r() * 0.5, 0x121212, 0, 0, true);
    B.box('metal', 3.4, 0.08, 0.08, 0, 1.25, 0, 0x55595c, 0.05, 0, 0.06);
    B.pop();
  }

  function fence(x0: number, z0: number, x1: number, z1: number) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const a = Math.atan2(-(z1 - z0), x1 - x0);
    const n = Math.max(1, Math.round(len / 3));
    for (let i = 0; i <= n; i++) B.box('metal', 0.1, 2.4, 0.1, x0 + ((x1 - x0) * i) / n, 0, z0 + ((z1 - z0) * i) / n, 0x43484b);
    B.box('metal', len, 0.06, 0.06, (x0 + x1) / 2, 2.3, (z0 + z1) / 2, 0x43484b, a);
    B.box('metal', len, 0.06, 0.06, (x0 + x1) / 2, 0.25, (z0 + z1) / 2, 0x43484b, a);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(len, 2.1), fenceMat());
    mesh.position.set((x0 + x1) / 2, 1.3, (z0 + z1) / 2);
    mesh.rotation.y = a;
    (mesh.material as THREE.MeshBasicMaterial).map!.repeat.set(len / 1.2, 2.1 / 1.2);
    root.add(mesh);
  }

  function lamp(x: number, z: number, color: number, lit: boolean, a: number) {
    B.push(x, 0, z, a);
    B.cyl('metal', 0.1, 6, 0, 0, 0, 0x2b2f31);
    B.box('metal', 0.1, 0.1, 1.8, 0, 5.9, 0.85, 0x2b2f31);
    B.box(lit ? 'glow' : 'metal', 0.36, 0.14, 0.7, 0, 5.78, 1.5, lit ? color : 0x3a3d3f);
    B.pop();
    if (lit) glow(x + Math.sin(a) * 1.5, 0.1, z + Math.cos(a) * 1.5, color, 0.6, 'steady', 0, 10);
  }

  function pole(list: [number, number][]) {
    list.forEach(([x, z], i) => {
      const lean = (r() - 0.5) * 0.12;
      B.push(x, 0, z, 0, lean, lean);
      B.cyl('matte', 0.14, 7.6, 0, 0, 0, 0x4a3b2c);
      B.box('matte', 0.14, 0.14, 2.2, 0, 6.9, 0, 0x4a3b2c);
      B.box('metal', 0.4, 0.7, 0.4, 0.3, 5.6, 0, 0x5d6468);
      B.pop();
      if (i === 0) return;
      const [px, pz] = list[i - 1];
      for (const off of [-0.95, 0.95]) {
        if (r() < 0.2) continue; // snapped wire
        const N = 8;
        for (let k = 0; k < N; k++) {
          const t0 = k / N;
          const t1 = (k + 1) / N;
          const sag = (t: number) => 7 - Math.sin(t * Math.PI) * 1.1;
          wires.push(px + (x - px) * t0 + off, sag(t0), pz + (z - pz) * t0, px + (x - px) * t1 + off, sag(t1), pz + (z - pz) * t1);
        }
      }
    });
  }

  function tree(x: number, z: number, sc: number) {
    const autumn = r() < 0.28;
    const dead = r() < 0.12;
    B.cyl('matte', 0.2 * sc, 2.6 * sc, x, 0, z, 0x3b2e22);
    if (dead) {
      B.cyl('matte', 0.1 * sc, 1.8 * sc, x + 0.4 * sc, 2.9 * sc, z, 0x3b2e22, 0, -0.6);
      B.cyl('matte', 0.1 * sc, 1.6 * sc, x - 0.4 * sc, 3.0 * sc, z + 0.2, 0x3b2e22, 0.3, 0.6);
      return;
    }
    const pal = autumn ? [0x8a5a24, 0x9a6a2a, 0x7a4a22, 0x6b6a2c] : [0x3c5a2a, 0x47682d, 0x33502a, 0x557030];
    const n = 3 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) {
      B.blob('foliage', (1.3 + r() * 0.8) * sc, x + (r() - 0.5) * 1.6 * sc, (3 + r() * 1.6) * sc, z + (r() - 0.5) * 1.6 * sc, pal[Math.floor(r() * pal.length)], 0.85);
    }
  }

  function sign(x: number, z: number, a: number, text: string, bg: string, fg: string) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.25), new THREE.MeshStandardMaterial({ map: makeSign(text, bg, fg), roughness: 0.8, side: THREE.DoubleSide }));
    m.position.set(x, 2.3, z);
    m.rotation.y = a + Math.PI / 4;
    root.add(m);
    B.box('metal', 0.1, 1.8, 0.1, x - 1.2, 0, z, 0x3d4245);
    B.box('metal', 0.1, 1.8, 0.1, x + 1.2, 0, z, 0x3d4245);
  }

  // ============================================================ runtime
  let shelterKey = '';
  return {
    group: root,
    interiors,
    setShelter(sh) {
      const key = `${sh.antenna}${sh.infirmary}${sh.generator}${sh.storage}`;
      if (key === shelterKey) return;
      shelterKey = key;
      for (const k of Object.keys(up) as (keyof Shelter)[]) up[k].forEach((g, i) => (g.visible = sh[k] > i));
      floods.forEach((f, i) => (f.base = sh.generator >= 1 && i < 4 ? 0.55 : sh.generator >= 2 && i >= 4 ? 0.5 : 0));
    },
    setFinds(ids) {
      for (const [id, g] of Object.entries(found)) g.visible = ids.includes(id);
    },
    setBusFire(on) {
      busFire.forEach((g, i) => (g.base = on ? (i === 0 ? 1.3 : 1) : 0));
      busOn = on;
    },
    flare(x, z) {
      flareLight.mesh.position.set(x, 0.2, z);
      flareT = 0;
    },
    update(t, dark, storm) {
      wind.value = t * (1 + storm * 1.8);
      for (const p of puffs) {
        const k = (p.t + t * (p.bus ? 0.11 : 0.16)) % 1;
        const show = !p.bus || busOn;
        p.m.visible = show;
        if (!show) continue;
        const rise = p.bus ? 9 : 5;
        p.m.position.set(p.x + k * (1.5 + storm * 3) + Math.sin(k * 9 + p.t * 20) * 0.3, 1.4 + k * rise, p.z + k * 1.2);
        p.m.scale.setScalar((p.bus ? 2.2 : 1) * (0.7 + k * 2.4));
        (p.m.material as THREE.MeshBasicMaterial).opacity = Math.sin(k * Math.PI) * (p.bus ? 0.5 : 0.3);
      }
      waterNormal.offset.y = t * 0.012;
      waterNormal.offset.x = Math.sin(t * 0.2) * 0.02;
      const night = 0.45 + dark * 0.75;
      (mats.glow as THREE.MeshBasicMaterial).color.setScalar(0.55 + dark * 0.75);
      for (const g of glows) {
        let k = 1;
        if (g.kind === 'blink') k = (t * 1.1 + g.phase) % 1 < 0.5 ? 1 : 0.12;
        else if (g.kind === 'flicker') k = 0.8 + Math.sin(t * 11 + g.phase) * 0.1 + Math.sin(t * 27.3 + g.phase * 2) * 0.1;
        else if (g.kind === 'beacon') k = (t * 0.8) % 1 < 0.25 ? 1 : 0.1;
        const m = g.mesh.material as THREE.MeshBasicMaterial;
        m.opacity = g.base * k * (g.kind === 'beacon' ? 1 : night);
        g.mesh.visible = m.opacity > 0.01;
      }
      if (flareT >= 0) {
        flareT += 1 / 60;
        const m = flareLight.mesh.material as THREE.MeshBasicMaterial;
        m.opacity = Math.max(0, 0.9 - flareT / 14) * (0.85 + Math.sin(t * 30) * 0.15);
        flareLight.mesh.visible = m.opacity > 0.01;
        if (flareT > 14) flareT = -1;
      }
      for (const l of pointLights) l.intensity = (40 + dark * 60) * (0.9 + Math.sin(t * 13 + l.position.x) * 0.1);
      void storm;
    },
  };
}

function mast(x: number, y: number, z: number, h: number, b: Batch) {
  for (const [dx, dz] of [[-0.35, -0.35], [0.35, -0.35], [0, 0.4]]) b.cyl('metal', 0.05, h, x + dx, y, z + dz, 0x8d9296);
  for (let k = 0.6; k < h; k += 1.1) {
    b.box('metal', 0.75, 0.05, 0.05, x, y + k, z - 0.35, 0x7d8286);
    b.box('metal', 0.05, 0.05, 0.8, x - 0.18, y + k, z, 0x7d8286, 0.42);
    b.box('metal', 0.05, 0.05, 0.8, x + 0.18, y + k, z, 0x7d8286, -0.42);
  }
  b.cyl('metal', 0.03, 1.2, x, y + h, z, 0xb9bdc0);
}

function tent(x: number, z: number, w: number, d: number, color: number, b: Batch) {
  b.add('matte', UNIT.half, color, w / 2, 2.5, d, x, 0, z, 0, 0, 0, 0.04);
  b.box('matte', w * 0.3, 1.7, 0.06, x, 0, z + d / 2 + 0.02, 0x23211d);
}

let glowGeo: THREE.PlaneGeometry | null = null;
let glowTex: THREE.Texture | null = null;
const sharedGlowGeo = () => (glowGeo ??= new THREE.PlaneGeometry(1, 1));
const sharedGlowTex = () => (glowTex ??= makeGlow());

let fenceTex: THREE.CanvasTexture | null = null;
function fenceMat() {
  if (!fenceTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d')!;
    g.strokeStyle = 'rgba(150,158,162,0.9)';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(32, 32);
    g.moveTo(32, 0);
    g.lineTo(0, 32);
    g.stroke();
    fenceTex = new THREE.CanvasTexture(c);
    fenceTex.wrapS = fenceTex.wrapT = THREE.RepeatWrapping;
  }
  return new THREE.MeshBasicMaterial({ map: fenceTex.clone(), transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, color: 0x8a9296 });
}
