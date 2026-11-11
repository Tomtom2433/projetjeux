// Realistic survivor models: a skinned GLB (generated from the character art) animated procedurally
// by rotating its bones, so one small file per character covers walking, running, crouching,
// reaching, carrying and falling. The stylised figure stays as a fallback until the model has loaded.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Characters that ship a rigged model in public/models. */
export const RIGGED = new Set(['mara', 'jo', 'lena']);

export interface Pose {
  /** -1..1 walking phase (sine). */
  stride: number;
  /** Amplitude of the gait: 0 standing, 1 running. */
  gait: number;
  /** Arm targets in radians, 0 = hanging, positive = raised forward. */
  armL: number;
  armR: number;
  /** 0 standing .. 1 crouched. */
  crouch: number;
  /** Arms spread sideways (binoculars), 0..1. */
  spread: number;
  /** Head tilt forward, radians (talking, nodding). */
  nod?: number;
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
    const swing = p.stride * (0.35 + p.gait * 0.4);
    const squat = p.crouch * 0.9;
    for (const [leg, s] of [[this.leg.L, 1], [this.leg.R, -1]] as const) {
      const a = swing * s;
      // thigh swings; the trailing leg bends at the knee, and both bend when crouched
      this.turn(leg[0], S, (a + squat) * f);
      this.turn(leg[1], S, -(Math.max(0, -a) * 1.1 + squat * 1.9) * f);
      this.turn(leg[2], S, squat * 0.9 * f);
    }
    for (const [arm, k, target] of [[this.arm.L, 1, p.armL], [this.arm.R, -1, p.armR]] as const) {
      // upper arm, forearm, hand. From the T-pose: down along the body, then swing forward.
      const down = (1.32 - p.spread * 0.9) * this.dropSign * k;
      this.turn(arm[0], F, down, S, target * f);
      this.turn(arm[1], S, (0.22 + Math.max(0, target) * 0.6) * f);
    }
    this.turn(this.spine, S, (p.gait * 0.1 + p.crouch * 0.45) * f);
    this.turn(this.neck, S, (-p.crouch * 0.3 + (p.nod ?? 0)) * f);
  }
}

const cache = new Map<string, Promise<THREE.Object3D | null>>();

/** Loads a character model once. Resolves to null if the file is missing or broken. */
export function loadRig(id: string, height: number, shadows: boolean): Promise<RiggedFigure | null> {
  if (!RIGGED.has(id)) return Promise.resolve(null);
  if (!cache.has(id)) {
    cache.set(
      id,
      new GLTFLoader()
        .loadAsync(`./models/${id}.glb`)
        .then((g) => g.scene as THREE.Object3D)
        .catch(() => null),
    );
  }
  return cache.get(id)!.then((scene) => (scene ? new RiggedFigure(scene, height, shadows) : null));
}
