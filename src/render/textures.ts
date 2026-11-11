// Procedural canvas textures: no external assets, works offline.
import * as THREE from 'three';
import { CANAL } from '../sim/world';

/** World rectangle covered by the painted ground. */
export const GROUND = { x0: -96, x1: 96, z0: -72, z1: 72 };

function rng(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

export interface RoadDef {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  w: number;
  kind?: 'road' | 'alley';
}

export const ROADS: RoadDef[] = [
  { x0: GROUND.x0, z0: 0, x1: GROUND.x1, z1: 0, w: 10 },
  { x0: -18, z0: GROUND.z0, x1: -18, z1: GROUND.z1, w: 8 },
  { x0: 34, z0: GROUND.z0, x1: 34, z1: GROUND.z1, w: 8 },
  { x0: 9, z0: -36, x1: 34, z1: -36, w: 3.2, kind: 'alley' },
  { x0: -44, z0: 0, x1: -44, z1: 12, w: 5, kind: 'alley' },
  { x0: -14, z0: -36, x1: -1, z1: -36, w: 3.2, kind: 'alley' },
];

export function makeGroundTextures(size: number): { map: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  const W = size;
  const H = Math.round((size * (GROUND.z1 - GROUND.z0)) / (GROUND.x1 - GROUND.x0));
  const { c, g } = canvas(W, H);
  const { c: rc, g: rg } = canvas(W / 2, H / 2);
  const s = W / (GROUND.x1 - GROUND.x0);
  const X = (x: number) => (x - GROUND.x0) * s;
  const Z = (z: number) => (z - GROUND.z0) * s;
  const r = rng(7);
  rg.scale(0.5, 0.5);

  const rect = (ctx: CanvasRenderingContext2D, x0: number, z0: number, x1: number, z1: number) =>
    ctx.fillRect(X(Math.min(x0, x1)), Z(Math.min(z0, z1)), Math.abs(x1 - x0) * s, Math.abs(z1 - z0) * s);

  // --- soil and overgrowth
  g.fillStyle = '#4b4e3a';
  g.fillRect(0, 0, W, H);
  rg.fillStyle = 'rgb(235,235,235)';
  rg.fillRect(0, 0, W, H);
  const soil = ['#55653a', '#5d6e3d', '#414a31', '#665e47', '#6e7a48', '#4c5538', '#6b624a'];
  for (let i = 0; i < 2600; i++) {
    g.globalAlpha = 0.1 + r() * 0.2;
    g.fillStyle = soil[Math.floor(r() * soil.length)];
    const rad = (0.6 + r() * 3.4) * s;
    g.beginPath();
    g.ellipse(r() * W, r() * H, rad, rad * (0.5 + r() * 0.6), r() * 3, 0, 7);
    g.fill();
  }
  g.globalAlpha = 1;

  // --- paved plots
  const plots: [number, number, number, number, string][] = [
    [-60, 9, -30, 36, '#77787a'], // ECHO-7 yard
    [39, -36, 72, -6, '#85868a'], // hospital forecourt
    [12, 6, 29, 24, '#4a4d52'], // car park
    [39, 20, 66, 42, '#74716a'], // garage yard
    [-52, -34, -23, -8, '#7c7a74'], // Tanneurs courtyard
  ];
  for (const [x0, z0, x1, z1, col] of plots) {
    g.fillStyle = col;
    rect(g, x0, z0, x1, z1);
    rg.fillStyle = 'rgb(190,190,190)';
    rect(rg, x0, z0, x1, z1);
  }
  // slab joints on plots
  g.strokeStyle = 'rgba(20,20,22,0.35)';
  g.lineWidth = Math.max(1, s * 0.08);
  for (const [x0, z0, x1, z1] of plots) {
    g.beginPath();
    for (let x = x0; x <= x1; x += 3) {
      g.moveTo(X(x), Z(z0));
      g.lineTo(X(x), Z(z1));
    }
    for (let z = z0; z <= z1; z += 3) {
      g.moveTo(X(x0), Z(z));
      g.lineTo(X(x1), Z(z));
    }
    g.stroke();
  }

  // --- sidewalks
  for (const rd of ROADS) {
    if (rd.kind === 'alley') continue;
    const pad = rd.w / 2 + 2.6;
    g.fillStyle = '#8f8f8a';
    rg.fillStyle = 'rgb(200,200,200)';
    if (rd.z0 === rd.z1) {
      rect(g, rd.x0, rd.z0 - pad, rd.x1, rd.z0 + pad);
      rect(rg, rd.x0, rd.z0 - pad, rd.x1, rd.z0 + pad);
    } else {
      rect(g, rd.x0 - pad, rd.z0, rd.x0 + pad, rd.z1);
      rect(rg, rd.x0 - pad, rd.z0, rd.x0 + pad, rd.z1);
    }
  }
  // kerb joints
  g.strokeStyle = 'rgba(30,30,30,0.3)';
  g.lineWidth = Math.max(1, s * 0.06);
  g.beginPath();
  for (let x = GROUND.x0; x < GROUND.x1; x += 2) {
    for (const zz of [-7.6, -5, 5, 7.6]) {
      g.moveTo(X(x), Z(zz));
      g.lineTo(X(x), Z(zz + (zz < 0 ? 2.6 : -2.6) * (Math.abs(zz) > 6 ? 1 : -1)));
    }
  }
  g.stroke();

  // --- asphalt
  for (const rd of ROADS) {
    const hw = rd.w / 2;
    const alley = rd.kind === 'alley';
    g.fillStyle = alley ? '#6a6252' : '#3a3d43';
    rg.fillStyle = alley ? 'rgb(225,225,225)' : 'rgb(150,150,150)';
    if (rd.z0 === rd.z1) {
      rect(g, rd.x0, rd.z0 - hw, rd.x1, rd.z0 + hw);
      rect(rg, rd.x0, rd.z0 - hw, rd.x1, rd.z0 + hw);
    } else {
      rect(g, rd.x0 - hw, rd.z0, rd.x0 + hw, rd.z1);
      rect(rg, rd.x0 - hw, rd.z0, rd.x0 + hw, rd.z1);
    }
  }
  const onRoad = (x: number, z: number) => {
    for (const rd of ROADS) {
      if (rd.kind === 'alley') continue;
      const hw = rd.w / 2;
      if (rd.z0 === rd.z1 ? Math.abs(z - rd.z0) < hw : Math.abs(x - rd.x0) < hw) return true;
    }
    return false;
  };
  // asphalt grain, patches, cracks
  for (let i = 0; i < 9000; i++) {
    const x = GROUND.x0 + r() * (GROUND.x1 - GROUND.x0);
    const z = GROUND.z0 + r() * (GROUND.z1 - GROUND.z0);
    if (!onRoad(x, z)) continue;
    g.globalAlpha = 0.08 + r() * 0.16;
    g.fillStyle = r() < 0.5 ? '#22242a' : '#585b62';
    const rad = (0.15 + r() * 1.3) * s;
    g.beginPath();
    g.ellipse(X(x), Z(z), rad, rad * (0.4 + r() * 0.6), r() * 3, 0, 7);
    g.fill();
  }
  g.globalAlpha = 1;
  g.strokeStyle = 'rgba(8,8,10,0.75)';
  for (let i = 0; i < 150; i++) {
    let x = GROUND.x0 + r() * (GROUND.x1 - GROUND.x0);
    let z = GROUND.z0 + r() * (GROUND.z1 - GROUND.z0);
    if (!onRoad(x, z)) continue;
    g.lineWidth = Math.max(1, s * (0.05 + r() * 0.08));
    g.beginPath();
    g.moveTo(X(x), Z(z));
    let a = r() * 6.28;
    for (let k = 0; k < 7; k++) {
      a += (r() - 0.5) * 1.4;
      x += Math.cos(a) * (0.5 + r());
      z += Math.sin(a) * (0.5 + r());
      g.lineTo(X(x), Z(z));
    }
    g.stroke();
  }

  // --- road markings (worn)
  const dash = (x0: number, z0: number, x1: number, z1: number, w: number, alpha: number) => {
    g.globalAlpha = alpha;
    g.fillStyle = '#e4e2d4';
    rect(g, x0 - (x0 === x1 ? w / 2 : 0), z0 - (z0 === z1 ? w / 2 : 0), x1 + (x0 === x1 ? w / 2 : 0), z1 + (z0 === z1 ? w / 2 : 0));
    g.globalAlpha = 1;
  };
  const inCross = (x: number, z: number) => (Math.abs(z) < 7 && (Math.abs(x + 18) < 6 || Math.abs(x - 34) < 6));
  for (let x = GROUND.x0; x < GROUND.x1; x += 5) if (!inCross(x + 1, 0) && r() > 0.18) dash(x, 0, x + 2.4, 0, 0.22, 0.35 + r() * 0.4);
  for (const rx of [-18, 34]) for (let z = GROUND.z0; z < GROUND.z1; z += 5) if (!inCross(rx, z + 1) && r() > 0.2) dash(rx, z, rx, z + 2.4, 0.2, 0.3 + r() * 0.4);
  for (const zz of [-4.6, 4.6]) for (let x = GROUND.x0; x < GROUND.x1; x += 9) if (!inCross(x + 4, 0)) dash(x, zz, x + 8.4, zz, 0.14, 0.25 + r() * 0.2);
  // crosswalks
  for (const cx of [-18, 34]) {
    for (let k = -4; k <= 4; k += 1.15) {
      dash(cx - 7.6, k, cx - 5.2, k, 0.55, 0.35 + r() * 0.35);
      dash(cx + 5.2, k, cx + 7.6, k, 0.55, 0.35 + r() * 0.35);
    }
    for (let k = -3.2; k <= 3.2; k += 1.15) {
      dash(cx + k, -8.2, cx + k, -6, 0.55, 0.3 + r() * 0.35);
      dash(cx + k, 6, cx + k, 8.2, 0.55, 0.3 + r() * 0.35);
    }
  }
  // car park bays, hospital hatching, yard markings
  g.strokeStyle = 'rgba(200,198,185,0.4)';
  g.lineWidth = Math.max(1, s * 0.14);
  g.beginPath();
  for (let x = 13; x <= 28; x += 3) {
    g.moveTo(X(x), Z(8));
    g.lineTo(X(x), Z(13));
    g.moveTo(X(x), Z(17));
    g.lineTo(X(x), Z(22));
  }
  g.stroke();
  g.strokeStyle = 'rgba(214,170,60,0.5)';
  g.beginPath();
  for (let k = 0; k < 9; k++) {
    g.moveTo(X(40 + k * 1.2), Z(-21));
    g.lineTo(X(41.5 + k * 1.2), Z(-15));
  }
  g.stroke();

  // --- puddles (dark in colour, glossy in roughness)
  for (let i = 0; i < 90; i++) {
    const x = GROUND.x0 + r() * (GROUND.x1 - GROUND.x0);
    const z = GROUND.z0 + r() * (GROUND.z1 - GROUND.z0);
    const road = onRoad(x, z);
    if (!road && r() < 0.6) continue;
    const rx = (0.8 + r() * 2.6) * s;
    const ry = rx * (0.35 + r() * 0.5);
    const rot = r() * 3;
    const grad = g.createRadialGradient(X(x), Z(z), 0, X(x), Z(z), rx);
    grad.addColorStop(0, 'rgba(14,18,26,0.75)');
    grad.addColorStop(0.7, 'rgba(14,18,26,0.55)');
    grad.addColorStop(1, 'rgba(14,18,26,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(X(x), Z(z), rx, ry, rot, 0, 7);
    g.fill();
    rg.fillStyle = 'rgb(18,18,18)';
    rg.beginPath();
    rg.ellipse(X(x), Z(z), rx * 0.85, ry * 0.85, rot, 0, 7);
    rg.fill();
  }

  // --- weeds creeping over kerbs and litter
  const greens = ['#4d5f2c', '#5d6e31', '#3c4a25', '#6a7436', '#7a6a3a'];
  for (let i = 0; i < 5200; i++) {
    const x = GROUND.x0 + r() * (GROUND.x1 - GROUND.x0);
    const z = GROUND.z0 + r() * (GROUND.z1 - GROUND.z0);
    const dAve = Math.abs(Math.abs(z) - 6.3);
    const dA = Math.abs(Math.abs(x + 18) - 5.3);
    const dB = Math.abs(Math.abs(x - 34) - 5.3);
    if (Math.min(dAve, dA, dB) > 1.6 && r() < 0.93) continue;
    g.globalAlpha = 0.35 + r() * 0.45;
    g.fillStyle = greens[Math.floor(r() * greens.length)];
    const rad = (0.12 + r() * 0.5) * s;
    g.beginPath();
    g.ellipse(X(x), Z(z), rad, rad * 0.7, r() * 3, 0, 7);
    g.fill();
  }
  for (let i = 0; i < 700; i++) {
    g.globalAlpha = 0.5 + r() * 0.4;
    g.fillStyle = ['#b9b6a8', '#8a877c', '#6b5a48', '#9aa0a8', '#74685a'][Math.floor(r() * 5)];
    const x = GROUND.x0 + r() * (GROUND.x1 - GROUND.x0);
    const z = GROUND.z0 + r() * (GROUND.z1 - GROUND.z0);
    g.save();
    g.translate(X(x), Z(z));
    g.rotate(r() * 6);
    g.fillRect(0, 0, (0.15 + r() * 0.35) * s, (0.1 + r() * 0.25) * s);
    g.restore();
  }
  g.globalAlpha = 1;

  // canal bed tint (hidden by geometry, keeps mips clean)
  g.fillStyle = '#1b2428';
  rect(g, CANAL.x0, GROUND.z0, CANAL.x1, GROUND.z1);

  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const rough = new THREE.CanvasTexture(rc);
  rough.anisotropy = 2;
  return { map, rough };
}

export type FacadeStyle = 'plaster' | 'brick' | 'hospital' | 'metal' | 'concrete';

/** One tile = 8 m wide, two storeys (6.4 m) tall. */
export function makeFacade(style: FacadeStyle, seed: number): THREE.CanvasTexture {
  const S = 256;
  const { c, g } = canvas(S, S);
  const r = rng(seed);
  const base: Record<FacadeStyle, string> = { plaster: '#8f8672', brick: '#6e4638', hospital: '#aeb1ad', metal: '#59626a', concrete: '#77756f' };
  g.fillStyle = base[style];
  g.fillRect(0, 0, S, S);
  if (style === 'brick') {
    g.fillStyle = 'rgba(30,18,14,0.35)';
    for (let y = 0; y < S; y += 8) {
      g.fillRect(0, y, S, 1);
      for (let x = (y / 8) % 2 ? 0 : 10; x < S; x += 20) g.fillRect(x, y, 1, 8);
    }
  }
  if (style === 'metal') {
    for (let x = 0; x < S; x += 8) {
      g.fillStyle = x % 16 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.07)';
      g.fillRect(x, 0, 4, S);
    }
  }
  // grime streaks and stains
  for (let i = 0; i < 70; i++) {
    g.globalAlpha = 0.05 + r() * 0.12;
    g.fillStyle = r() < 0.7 ? '#1a1612' : '#c9c2ae';
    g.fillRect(r() * S, r() * S, 2 + r() * 10, 20 + r() * 90);
  }
  g.globalAlpha = 1;
  if (style !== 'metal') {
    const cols = style === 'hospital' ? 4 : 3;
    for (let fl = 0; fl < 2; fl++) {
      for (let i = 0; i < cols; i++) {
        const w = style === 'hospital' ? 46 : 38;
        const h = style === 'hospital' ? 44 : 62;
        const x = (S / cols) * (i + 0.5) - w / 2;
        const y = fl * (S / 2) + (S / 2 - h) / 2 - 4;
        g.fillStyle = '#2a2622';
        g.fillRect(x - 3, y - 3, w + 6, h + 8);
        const roll = r();
        if (roll < 0.2) {
          g.fillStyle = '#5b4631'; // boarded
          g.fillRect(x, y, w, h);
          g.fillStyle = 'rgba(0,0,0,0.35)';
          for (let k = 1; k < 5; k++) g.fillRect(x, y + (h / 5) * k, w, 2);
        } else {
          const grad = g.createLinearGradient(x, y, x + w, y + h);
          grad.addColorStop(0, roll < 0.5 ? '#0c0f14' : '#1c2733');
          grad.addColorStop(1, roll < 0.5 ? '#151a22' : '#2e3d4c');
          g.fillStyle = grad;
          g.fillRect(x, y, w, h);
          g.fillStyle = 'rgba(0,0,0,0.6)';
          g.fillRect(x + w / 2 - 1, y, 2, h);
          if (roll > 0.82) {
            g.strokeStyle = 'rgba(190,200,210,0.5)'; // cracked pane
            g.beginPath();
            g.moveTo(x + 4, y + h);
            g.lineTo(x + w * 0.5, y + h * 0.4);
            g.lineTo(x + w - 3, y + 6);
            g.stroke();
          }
        }
        g.fillStyle = 'rgba(210,205,190,0.5)';
        g.fillRect(x - 4, y + h + 3, w + 8, 3);
      }
    }
    if (style === 'hospital') {
      g.fillStyle = '#3f8f8a';
      g.fillRect(0, S / 2 - 5, S, 5);
      g.fillRect(0, S - 5, S, 5);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 2;
  return t;
}

export function makeGlow(): THREE.CanvasTexture {
  const { c, g } = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.14)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export function makeWaterNormal(): THREE.CanvasTexture {
  const S = 128;
  const { c, g } = canvas(S, S);
  const img = g.createImageData(S, S);
  const h = (x: number, y: number) =>
    Math.sin((x / S) * 6.283 * 3 + Math.sin((y / S) * 6.283 * 2) * 1.3) * 0.5 + Math.sin((y / S) * 6.283 * 5 + (x / S) * 6.283) * 0.35 + Math.sin(((x + y) / S) * 6.283 * 7) * 0.15;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = h(x + 1, y) - h(x - 1, y);
      const dy = h(x, y + 1) - h(x, y - 1);
      const i = (y * S + x) * 4;
      img.data[i] = 128 + dx * 150;
      img.data[i + 1] = 128 + dy * 150;
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function makeDash(): THREE.CanvasTexture {
  const { c, g } = canvas(64, 8);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 40, 8);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export function makeSign(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const { c, g } = canvas(256, 96);
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 96);
  g.fillStyle = fg;
  g.font = 'bold 54px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
