// Realistic survivor models: a skinned GLB (generated from the character art) animated procedurally
// by rotating its bones, so one small file per character covers walking, running, crouching,
// reaching, carrying and falling. The stylised figure stays as a fallback until the model has loaded.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/** Characters that ship a rigged model in public/models. */
export const RIGGED = new Set(['mara', 'jo', 'lena', 'ines', 'sacha', 'vogel', 'stranger']);

export interface Pose {
  /** Walk cycle angle, advanced by the distance actually covered. */
  phase: number;
  /** Stride amplitude: 0 standing, about 0.6 walking, 1+ running. */
  gait: number;
  /** Upper-arm raise in radians, 0 = hanging, positive = forward. */
  armL: number;
  armR: number;
  /** Elbow bend in radians, 0 = straight. */
  elbowL: number;
  elbowR: number;
  /** 0 standing .. 1 crouched. */
  crouch: number;
  /** Arms held away from the body, 0..1. */
  spread: number;
  /** What the body is busy with, for figures driven by clips: talk, search, punch, look, crouch, carry, injured. */
  action?: string;
  /** Torso lean forward, radians. */
  lean?: number;
  /** Head tilt forward (talking, nodding) and turn (looking around), radians. */
  nod?: number;
  look?: number;
  /** Clock for breathing and small idle motion. */
  time?: number;
}

interface BoneRef {
  bone: THREE.Bone;
  rest: THREE.Quaternion;
  /** Rest orientation in model space, so rotations can be given about model axes. */
  world: THREE.Quaternion;
  worldInv: THREE.Quaternion;
}

const UP = new THREE.Vector3(0, 1, 0);
const tmpQ = new THREE.Quaternion();
const tmpR = new THREE.Quaternion();

export class RiggedFigure {
  /** Add this to the character's body group. Faces +Z, feet on y = 0, about 2 units tall. */
  root = new THREE.Group();
  materials: THREE.MeshStandardMaterial[] = [];
  private b: Record<string, BoneRef> = {};
  /** Model-space axes measured on the skeleton: toward the left arm, and toward the toes. */
  private sideAxis = new THREE.Vector3(1, 0, 0);
  private fwdAxis = new THREE.Vector3(0, 0, 1);
  /** Sign that makes a hanging limb swing forward when rotated about the side axis. */
  private swingSign = 1;
  /** Sign that lowers the left arm when rotated about the forward axis. */
  private dropSign = 1;
  /** Sign that turns the left side toward the front when rotated about the vertical axis. */
  private yawSign = 1;
  /** Joints found by where they sit on the body, not by their names: generated rigs label them inconsistently. */
  private arm: { L: string[]; R: string[] } = { L: [], R: [] };
  private leg: { L: string[]; R: string[] } = { L: [], R: [] };
  private spine = '';
  private neck = '';

  constructor(gltf: THREE.Object3D, height: number, shadows: boolean) {
    // The cached scene may still hang under a previous game's character (turned, scaled, posed):
    // detach it and go back to the bind pose, so the skeleton is measured in its own frame.
    gltf.removeFromParent();
    gltf.traverse((o) => {
      const bone = o as THREE.Bone;
      if (!bone.isBone) return;
      if (bone.userData.rest) bone.quaternion.copy(bone.userData.rest as THREE.Quaternion);
      else bone.userData.rest = bone.quaternion.clone();
    });
    gltf.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const P = new Map<THREE.Object3D, THREE.Vector3>();
    const bones: THREE.Bone[] = [];
    gltf.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) {
        m.frustumCulled = false;
        m.castShadow = shadows;
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.transparent = true;
        mat.roughness = 0.85;
        mat.metalness = 0;
        mat.color.setScalar(1.35); // the baked texture is dark for a dusk scene
        mat.side = THREE.FrontSide;
        if (mat.map) mat.map.anisotropy = 4;
        this.materials.push(mat);
        m.geometry.computeBoundingBox();
        box.union(m.geometry.boundingBox!);
      }
      const bone = o as THREE.Bone;
      if (bone.isBone) {
        const world = bone.getWorldQuaternion(new THREE.Quaternion());
        this.b[bone.name] = { bone, rest: bone.quaternion.clone(), world, worldInv: world.clone().invert() };
        P.set(bone, bone.getWorldPosition(new THREE.Vector3()));
        bones.push(bone);
      }
    });
    const top = Math.max(0.001, ...bones.map((x) => P.get(x)!.y));
    const kids = (x: THREE.Object3D) => x.children.filter((c) => P.has(c)) as THREE.Bone[];
    const flat = (x: THREE.Object3D, c: THREE.Object3D) => Math.hypot(P.get(c)!.x - P.get(x)!.x, P.get(c)!.z - P.get(x)!.z);
    const drop = (x: THREE.Object3D, c: THREE.Object3D) => P.get(x)!.y - P.get(c)!.y;
    const isAnc = (a: THREE.Object3D, x: THREE.Object3D) => {
      for (let n: THREE.Object3D | null = x; n; n = n.parent) if (n === a) return true;
      return false;
    };
    // a limb segment: a bone with a child a good way off, sideways for an arm, downwards for a leg
    const far = (x: THREE.Bone, kind: 'arm' | 'leg') =>
      kids(x)
        .filter((c) => (kind === 'arm' ? flat(x, c) > 0.1 * top && Math.abs(drop(x, c)) < 0.08 * top : drop(x, c) > 0.15 * top))
        .sort((c1, c2) => (kind === 'arm' ? flat(x, c2) - flat(x, c1) : drop(x, c2) - drop(x, c1)))[0];
    const chains = (kind: 'arm' | 'leg') =>
      bones
        .filter((x) => far(x, kind) && !(x.parent && P.has(x.parent) && far(x.parent as THREE.Bone, kind) === x))
        .map((x) => {
          const mid = far(x, kind);
          const end = far(mid, kind) ?? kids(mid)[0];
          return [x, mid, end].filter(Boolean);
        })
        .filter((ch) => ch.length === 3);
    const arms = chains('arm');
    const legs = chains('leg');
    // Measure the character's own frame instead of assuming one: exporters disagree on axes.
    if (arms.length >= 2) {
      this.sideAxis.copy(P.get(arms[0][1])!).sub(P.get(arms[1][1])!).setY(0).normalize();
      this.arm = { L: arms[0].map((x) => x.name), R: arms[1].map((x) => x.name) };
    }
    const sideOf = (x: THREE.Object3D) => P.get(x)!.dot(this.sideAxis);
    if (legs.length >= 2) {
      const [l, r] = sideOf(legs[0][0]) >= sideOf(legs[1][0]) ? [legs[0], legs[1]] : [legs[1], legs[0]];
      this.leg = { L: l.map((x) => x.name), R: r.map((x) => x.name) };
      // the toes are the ankle's child that sticks out furthest
      const ankle = l[2];
      const toe = kids(ankle).sort((c1, c2) => flat(ankle, c2) - flat(ankle, c1))[0];
      if (toe) this.fwdAxis.copy(P.get(toe)!).sub(P.get(ankle)!).setY(0);
    }
    if (this.fwdAxis.lengthSq() < 1e-4) this.fwdAxis.crossVectors(this.sideAxis, UP);
    this.fwdAxis.normalize();
    // spine: the lowest bone that carries the arms but not the legs; neck: same idea for the head
    if (arms.length >= 2 && legs.length >= 2) {
      let n: THREE.Object3D = arms[0][0];
      while (n.parent && P.has(n.parent) && !isAnc(n.parent, legs[0][0])) n = n.parent;
      if (isAnc(n, arms[1][0])) this.spine = n.name;
      let hd: THREE.Object3D = bones.reduce((best, x) => (P.get(x)!.y > P.get(best)!.y ? x : best), bones[0]);
      while (hd.parent && P.has(hd.parent) && !isAnc(hd.parent, arms[0][0])) hd = hd.parent;
      this.neck = hd.name;
    }
    const probe = new THREE.Vector3(0, -1, 0).applyAxisAngle(this.sideAxis, 0.3);
    this.swingSign = probe.dot(this.fwdAxis) >= 0 ? 1 : -1;
    const dropV = this.sideAxis.clone().applyAxisAngle(this.fwdAxis, 0.3);
    this.dropSign = dropV.y <= 0 ? 1 : -1;
    this.yawSign = this.sideAxis.clone().applyAxisAngle(UP, 0.3).dot(this.fwdAxis) >= 0 ? 1 : -1;
    const h = Math.max(0.001, box.max.y - box.min.y);
    const inner = new THREE.Group();
    inner.add(gltf);
    inner.scale.setScalar(height / h);
    inner.rotation.y = -Math.atan2(this.fwdAxis.x, this.fwdAxis.z);
    inner.position.y = -box.min.y * (height / h);
    this.root.add(inner);
  }

  /** Rotate a bone away from its rest pose: first `a1` about `ax1`, then `a2` about `ax2` (model axes). */
  private turn(name: string | undefined, ax1: THREE.Vector3, a1: number, ax2?: THREE.Vector3, a2 = 0) {
    const r = name ? this.b[name] : undefined;
    if (!r) return;
    tmpR.setFromAxisAngle(ax1, a1);
    if (ax2) tmpR.premultiply(tmpQ.setFromAxisAngle(ax2, a2));
    // local = rest * inv(world) * R * world
    r.bone.quaternion.copy(r.rest).multiply(tmpQ.copy(r.worldInv)).multiply(tmpR).multiply(tmpQ.copy(r.world));
  }

  pose(p: Pose) {
    const S = this.sideAxis;
    const F = this.fwdAxis;
    const f = this.swingSign;
    const y = this.yawSign;
    const t = p.time ?? 0;
    const amp = Math.min(1, p.gait * 1.7); // how much of a stride is showing
    const run = Math.min(1, Math.max(0, (p.gait - 0.62) / 0.4));
    const squat = p.crouch * 0.9;
    const sinP = Math.sin(p.phase);
    for (const [leg, side] of [[this.leg.L, 0], [this.leg.R, Math.PI]] as const) {
      const ph = p.phase + side;
      const s = Math.sin(ph);
      const fwd = Math.max(0, Math.cos(ph)); // the leg is swinging forward, off the ground
      // thigh swings; the knee folds while the leg comes through and gives a little on landing
      const thigh = (0.4 + run * 0.14) * amp * s + squat + run * 0.08 * amp;
      const knee = ((0.7 + run * 0.65) * fwd * fwd + 0.12 * Math.max(0, s) + 0.06) * amp + squat * 1.9;
      const ankle = (0.2 * Math.max(0, s) - 0.32 * Math.max(0, -s) * (1 - fwd)) * amp + squat * 0.9;
      this.turn(leg[0], S, thigh * f);
      this.turn(leg[1], S, -knee * f);
      this.turn(leg[2], S, ankle * f);
    }
    // arms swing against the legs, loose at the elbow; a runner carries them bent
    for (const [arm, k, raise, elbow, side] of [[this.arm.L, 1, p.armL, p.elbowL, Math.PI], [this.arm.R, -1, p.armR, p.elbowR, 0]] as const) {
      const ph = p.phase + side;
      const free = Math.max(0, 1 - raise * 1.4); // a busy arm does not swing
      const sway = Math.sin(t * 1.25 + side) * 0.03 * (1 - amp);
      const swing = ((0.36 + run * 0.22) * Math.sin(ph) + run * 0.04) * amp * free + sway;
      const hang = (1.43 - p.spread * 0.9 - 0.06 * amp) * this.dropSign * k;
      this.turn(arm[0], F, hang, S, (raise + swing) * f);
      const bend = elbow + ((0.16 + run * 0.95) + 0.3 * Math.max(0, Math.sin(ph - 0.5))) * amp * free;
      this.turn(arm[1], UP, bend * y * k);
      this.turn(arm[2], UP, 0.12 * y * k); // a relaxed wrist
    }
    // shoulders turn against the hips; the torso leans into speed and breathes at rest
    const twist = -0.15 * amp * sinP * y;
    const breathe = Math.sin(t * 1.9) * 0.018 * (1 - amp);
    this.turn(this.spine, S, ((p.lean ?? 0) + amp * (0.05 + run * 0.16) + p.crouch * 0.45 + breathe) * f, UP, twist);
    this.turn(this.neck, S, (-p.crouch * 0.3 - amp * run * 0.1 - (p.lean ?? 0) * 0.5 + (p.nod ?? 0)) * f, UP, (p.look ?? 0) * y - twist * 0.8);
  }
}

/** Anything the actors can pose: the procedural rig above, or a figure driven by recorded clips. */
export interface Figure {
  root: THREE.Group;
  materials: THREE.MeshStandardMaterial[];
  /** True when recorded animation drives the body (it crouches and bends by itself). */
  clips?: boolean;
  pose(p: Pose): void;
}

interface ClipData {
  dur: number;
  /** Frames, evenly spaced over the duration. */
  n: number;
  /** Per bone: n quaternions, each the rotation away from the rest pose. */
  rot: Record<string, number[]>;
  /** Hips offset from rest, in units of hip height. */
  hips: number[] | null;
  /** Strides in the clip (locomotion only). */
  cycles: number;
}

/** Characters rigged on the shared skeleton, so every recorded clip plays on all of them. */
export const CLIP_RIGGED = new Set(['mara', 'jo', 'lena', 'ines', 'sacha', 'vogel', 'stranger']);
const STAND = new Set(['talk', 'search', 'punch', 'look']);
const MOVE: Record<string, string> = { injured: 'injured', shamble: 'shamble' };
const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const qc = new THREE.Quaternion();

/**
 * A character animated by motion clips (idle, walk, run and actions), blended by weight.
 * Locomotion clips are scrubbed by the distance covered, so feet stay planted at any speed.
 */
export class ClipFigure implements Figure {
  root = new THREE.Group();
  materials: THREE.MeshStandardMaterial[] = [];
  clips = true;
  private bones: { bone: THREE.Bone; rest: THREE.Quaternion; name: string }[] = [];
  private hips: { bone: THREE.Bone; rest: THREE.Vector3 } | null = null;
  private head: { bone: THREE.Bone; world: THREE.Quaternion; inv: THREE.Quaternion } | null = null;
  private w: Record<string, number> = { idle: 1 };
  private last = 0;
  private side = new THREE.Vector3(1, 0, 0);
  /** A calm standing pose built from the rest pose: arms down by the sides. Used whenever nothing else plays. */
  private stand: Record<string, THREE.Quaternion> = {};
  private spine: { bone: THREE.Bone; world: THREE.Quaternion; inv: THREE.Quaternion } | null = null;

  constructor(gltf: THREE.Object3D, private data: Record<string, ClipData>, height: number, shadows: boolean) {
    gltf.removeFromParent();
    gltf.traverse((o) => {
      const bone = o as THREE.Bone;
      if (!bone.isBone) return;
      if (bone.userData.rest) {
        bone.quaternion.copy(bone.userData.rest as THREE.Quaternion);
        bone.position.copy(bone.userData.restPos as THREE.Vector3);
      } else {
        bone.userData.rest = bone.quaternion.clone();
        bone.userData.restPos = bone.position.clone();
      }
    });
    gltf.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const pos: Record<string, THREE.Vector3> = {};
    gltf.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) {
        m.frustumCulled = false;
        m.castShadow = shadows;
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.transparent = true;
        mat.roughness = 0.85;
        mat.metalness = 0;
        mat.color.setScalar(1.35);
        mat.side = THREE.FrontSide;
        if (mat.map) mat.map.anisotropy = 4;
        this.materials.push(mat);
        m.geometry.computeBoundingBox();
        box.union(m.geometry.boundingBox!);
      }
      const bone = o as THREE.Bone;
      if (bone.isBone) {
        this.bones.push({ bone, rest: bone.quaternion.clone(), name: bone.name });
        pos[bone.name] = bone.getWorldPosition(new THREE.Vector3());
        if (bone.name === 'Hips') this.hips = { bone, rest: bone.position.clone() };
        if (bone.name === 'Head' || bone.name === 'Spine01') {
          const world = bone.getWorldQuaternion(new THREE.Quaternion());
          const ref = { bone, world, inv: world.clone().invert() };
          if (bone.name === 'Head') this.head = ref;
          else this.spine = ref;
        }
      }
    });
    const fwd = new THREE.Vector3(0, 0, 1);
    if (pos.LeftToeBase && pos.LeftFoot) fwd.copy(pos.LeftToeBase).sub(pos.LeftFoot).setY(0).normalize();
    if (pos.LeftArm && pos.RightArm) this.side.copy(pos.LeftArm).sub(pos.RightArm).setY(0).normalize();
    // arms: from the T of the rest pose to hanging, a little away from the hips, elbows barely bent
    const byName: Record<string, THREE.Bone> = {};
    for (const b of this.bones) byName[b.name] = b.bone;
    for (const [arm, fore, k] of [['LeftArm', 'LeftForeArm', 1], ['RightArm', 'RightForeArm', -1]] as const) {
      if (!byName[arm] || !pos[arm] || !pos[fore]) continue;
      const dir = pos[fore].clone().sub(pos[arm]).normalize();
      const want = new THREE.Vector3().copy(this.side).multiplyScalar(0.16 * k).add(new THREE.Vector3(0, -1, 0)).addScaledVector(fwd, 0.05).normalize();
      const down = new THREE.Quaternion().setFromUnitVectors(dir, want);
      const w = byName[arm].getWorldQuaternion(new THREE.Quaternion());
      this.stand[arm] = w.clone().invert().multiply(down).multiply(w);
      if (byName[fore]) {
        // the bend that ends up pointing forward once the arm hangs
        let bend = new THREE.Quaternion().setFromAxisAngle(UP, 0.28);
        if (dir.clone().applyQuaternion(bend).applyQuaternion(down).dot(fwd) < dir.clone().applyQuaternion(down).dot(fwd)) bend = new THREE.Quaternion().setFromAxisAngle(UP, -0.28);
        const wf = byName[fore].getWorldQuaternion(new THREE.Quaternion());
        this.stand[fore] = wf.clone().invert().multiply(bend).multiply(wf);
      }
    }
    const h = Math.max(0.001, box.max.y - box.min.y);
    const inner = new THREE.Group();
    inner.add(gltf);
    inner.scale.setScalar(height / h);
    inner.rotation.y = -Math.atan2(fwd.x, fwd.z);
    inner.position.y = -box.min.y * (height / h);
    this.root.add(inner);
  }

  private has(name: string) {
    return name === 'idle' || !!this.data[name];
  }

  pose(p: Pose) {
    const t = p.time ?? 0;
    const dt = Math.min(0.2, Math.max(0, t - this.last));
    this.last = t;
    const amp = Math.min(1, p.gait * 1.7);
    const run = Math.min(1, Math.max(0, (p.gait - 0.62) / 0.4));
    const act = p.action ?? '';
    const stand = STAND.has(act) && this.has(act) ? act : 'idle';
    const move = MOVE[act] && this.has(MOVE[act]) ? MOVE[act] : 'walk';
    const target: Record<string, number> = {};
    target[stand] = (target[stand] ?? 0) + (1 - amp);
    if (move === 'walk') {
      target.walk = (target.walk ?? 0) + amp * (1 - run);
      target.run = amp * run;
    } else target[move] = (target[move] ?? 0) + amp;
    // ease between clips so a change of activity never snaps
    const k = Math.min(1, dt * 7 + (dt === 0 ? 1 : 0));
    let sum = 0;
    for (const name of new Set([...Object.keys(this.w), ...Object.keys(target)])) {
      const v = (this.w[name] ?? 0) + ((target[name] ?? 0) - (this.w[name] ?? 0)) * k;
      if (v < 0.004 && !target[name]) delete this.w[name];
      else {
        this.w[name] = v;
        sum += v;
      }
    }
    const standW = (this.w.idle ?? 0) / (sum || 1);
    const active = Object.entries(this.w)
      .filter(([name]) => name !== 'idle' && this.has(name))
      .map(([name, weight]) => {
        const c = this.data[name];
        // strides are scrubbed by distance; everything else runs on the clock
        const u = c.cycles > 0 && name !== 'idle' && !STAND.has(name) ? (((p.phase / (Math.PI * 2)) % c.cycles) + c.cycles) % c.cycles / c.cycles : ((t / c.dur) % 1 + 1) % 1;
        const f = u * (c.n - 1);
        const i0 = Math.floor(f);
        return { c, weight: weight / (sum || 1), i0, i1: Math.min(c.n - 1, i0 + 1), a: f - i0 };
      });
    for (const b of this.bones) {
      // start from the calm standing pose, then blend in whatever clips are playing
      let acc = standW;
      let first = standW <= 0;
      if (!first) {
        const sq = this.stand[b.name];
        if (sq) qc.copy(sq);
        else qc.identity();
      }
      for (const cl of active) {
        const r = cl.c.rot[b.name];
        if (!r) continue;
        qa.fromArray(r, cl.i0 * 4);
        qb.fromArray(r, cl.i1 * 4);
        qa.slerp(qb, cl.a);
        if (first) {
          qc.copy(qa);
          acc = cl.weight;
          first = false;
        } else {
          acc += cl.weight;
          qc.slerp(qa, cl.weight / acc);
        }
      }
      if (first) continue;
      b.bone.quaternion.copy(b.rest).multiply(qc);
    }
    if (this.hips) {
      const hb = this.hips;
      let x = 0, y = 0, z = 0;
      for (const cl of active) {
        const hp = cl.c.hips;
        if (!hp) continue;
        const o0 = cl.i0 * 3, o1 = cl.i1 * 3;
        // keep the bob and the crouch, drop any drift along the ground
        y += (hp[o0 + 1] + (hp[o1 + 1] - hp[o0 + 1]) * cl.a) * cl.weight;
        x += (hp[o0] + (hp[o1] - hp[o0]) * cl.a) * cl.weight * 0.3;
        z += (hp[o0 + 2] + (hp[o1 + 2] - hp[o0 + 2]) * cl.a) * cl.weight * 0.3;
      }
      const hh = hb.rest.y || 1;
      hb.bone.position.set(hb.rest.x + x * hh, hb.rest.y + y * hh, hb.rest.z + z * hh);
    }
    // breathing, and a slow shift of weight, while standing
    if (this.spine && standW > 0.02) {
      qa.setFromAxisAngle(this.side, Math.sin(t * 1.7) * 0.022 * standW);
      qb.setFromAxisAngle(UP, Math.sin(t * 0.37) * 0.05 * standW);
      qa.multiply(qb);
      this.spine.bone.quaternion.multiply(qb.copy(this.spine.inv)).multiply(qa).multiply(qb.copy(this.spine.world));
    }
    // the head can still turn and nod on top of whatever the body is doing
    if (this.head && (p.look || p.nod)) {
      qa.setFromAxisAngle(UP, p.look ?? 0);
      qb.setFromAxisAngle(this.side, p.nod ?? 0);
      qa.multiply(qb);
      this.head.bone.quaternion.multiply(qb.copy(this.head.inv)).multiply(qa).multiply(qb.copy(this.head.world));
    }
  }
}

const cache = new Map<string, Promise<THREE.Object3D | null>>();

let clipsP: Promise<Record<string, ClipData> | null> | null = null;
const loadClips = () =>
  (clipsP ??= fetch('./models/clips.json')
    .then((r) => (r.ok ? (r.json() as Promise<Record<string, ClipData>>) : null))
    .catch(() => null));

/** A pack of infected: copies of one model, each with its own skeleton, all on the shared clips. */
export function loadHorde(count: number, height: number, shadows: boolean): Promise<ClipFigure[] | null> {
  return Promise.all([
    new GLTFLoader()
      .loadAsync('./models/m-infected.glb')
      .then((g) => g.scene as THREE.Object3D)
      .catch(() => null),
    loadClips(),
  ]).then(([scene, clips]) => {
    if (!scene || !clips) return null;
    const out: ClipFigure[] = [];
    for (let i = 0; i < count; i++) {
      const copy = cloneSkinned(scene);
      // each copy needs its own material so one can fade or flash without the others
      copy.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (m.isSkinnedMesh) m.material = (m.material as THREE.Material).clone();
      });
      out.push(new ClipFigure(copy, clips, height * (0.94 + ((i * 37) % 13) / 100), shadows));
    }
    return out;
  });
}

/** Loads a character model once. Resolves to null if the file is missing or broken. */
export function loadRig(id: string, height: number, shadows: boolean): Promise<Figure | null> {
  if (!RIGGED.has(id)) return Promise.resolve(null);
  const clip = CLIP_RIGGED.has(id);
  const file = clip ? `./models/m-${id}.glb` : `./models/${id}.glb`;
  if (!cache.has(id)) {
    cache.set(
      id,
      new GLTFLoader()
        .loadAsync(file)
        .then((g) => g.scene as THREE.Object3D)
        .catch(() => null),
    );
  }
  return Promise.all([cache.get(id)!, clip ? loadClips() : null]).then(([scene, clips]) => (!scene ? null : clip && clips ? new ClipFigure(scene, clips, height, shadows) : clip ? null : new RiggedFigure(scene, height, shadows)));
}
