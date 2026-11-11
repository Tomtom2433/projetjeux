// Realistic survivor models: a skinned GLB (generated from the character art) animated procedurally
// by rotating its bones, so one small file per character covers walking, running, crouching,
// reaching, carrying and falling. The stylised figure stays as a fallback until the model has loaded.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Characters that ship a rigged model in public/models. */
export const RIGGED = new Set(['mara']);

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

  constructor(gltf: THREE.Object3D, height: number, shadows: boolean) {
    // the cached scene may have been posed by a previous game: go back to the bind pose first
    gltf.traverse((o) => {
      const bone = o as THREE.Bone;
      if (!bone.isBone) return;
      if (bone.userData.rest) bone.quaternion.copy(bone.userData.rest as THREE.Quaternion);
      else bone.userData.rest = bone.quaternion.clone();
    });
    gltf.updateMatrixWorld(true);
    const box = new THREE.Box3();
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
      if (bone.isBone && bone.name.includes('tripo')) {
        const world = bone.getWorldQuaternion(new THREE.Quaternion());
        this.b[bone.name.replace(/^tripo[:_]*/, '')] = { bone, rest: bone.quaternion.clone(), world, worldInv: world.clone().invert() };
      }
    });
    const pos = (n: string) => this.b[n]?.bone.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3();
    // Measure the character's own frame instead of assuming one: exporters disagree on axes.
    this.sideAxis.copy(pos('0_Left_Limb_2')).sub(pos('0_Right_Limb_2')).setY(0).normalize();
    this.fwdAxis.copy(pos('1_Left_Limb_3')).sub(pos('1_Left_Limb_2')).setY(0);
    if (this.fwdAxis.lengthSq() < 1e-6) this.fwdAxis.crossVectors(this.sideAxis, UP);
    this.fwdAxis.normalize();
    const probe = new THREE.Vector3(0, -1, 0).applyAxisAngle(this.sideAxis, 0.3);
    this.swingSign = probe.dot(this.fwdAxis) >= 0 ? 1 : -1;
    const drop = this.sideAxis.clone().applyAxisAngle(this.fwdAxis, 0.3);
    this.dropSign = drop.y <= 0 ? 1 : -1;
    const h = Math.max(0.001, box.max.y - box.min.y);
    const inner = new THREE.Group();
    inner.add(gltf);
    inner.scale.setScalar(height / h);
    inner.rotation.y = -Math.atan2(this.fwdAxis.x, this.fwdAxis.z);
    inner.position.y = -box.min.y * (height / h);
    this.root.add(inner);
  }

  /** Rotate a bone away from its rest pose: first `a1` about `ax1`, then `a2` about `ax2` (model axes). */
  private turn(name: string, ax1: THREE.Vector3, a1: number, ax2?: THREE.Vector3, a2 = 0) {
    const r = this.b[name];
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
    for (const [leg, s] of [['1_Left_Limb', 1], ['1_Right_Limb', -1]] as const) {
      const a = swing * s;
      // thigh swings; the trailing leg bends at the knee, and both bend when crouched
      this.turn(leg + '_0', S, (a + squat) * f);
      this.turn(leg + '_1', S, -(Math.max(0, -a) * 1.1 + squat * 1.9) * f);
      this.turn(leg + '_2', S, squat * 0.9 * f);
    }
    for (const [arm, k, target] of [['0_Left_Limb', 1, p.armL], ['0_Right_Limb', -1, p.armR]] as const) {
      // from the T-pose: bring the arm down along the body, then swing it forward
      const down = (1.3 - p.spread * 0.9) * this.dropSign * k;
      this.turn(arm + '_1', F, down, S, target * f);
      this.turn(arm + '_2', S, (0.2 + Math.max(0, target) * 0.5) * f);
    }
    this.turn('Spine_0', S, (p.gait * 0.1 + p.crouch * 0.45) * f);
    this.turn('Head_1', S, -p.crouch * 0.3 * f);
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
