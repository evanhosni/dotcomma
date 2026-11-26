import type Rapier from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import type { RagdollImpulse } from "../state/types";
import { ANGULAR_DAMPING, LINEAR_DAMPING, MAX_DROP, MAX_PART_MASS, MAX_PART_SPEED, MAX_PART_SPIN, MIN_LEAF_PART_SIZE, MIN_PART_HALF_EXTENT, MIN_PART_MASS, MIN_PART_VERTICES, PART_BOX_SCALE, PART_DENSITY, PART_FRICTION, RAGDOLL_COLLISION_GROUPS } from "./constants";
import type { SkeletonLayout } from "./types";

interface Part {
  bone: THREE.Bone;
  body: Rapier.RigidBody;
  /** The nearest ancestor with a body of its own; null for a root of the ragdoll. */
  parent: Part | null;
}

interface BonePose {
  bone: THREE.Bone;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _parentPosition = new THREE.Vector3();
const _parentQuaternion = new THREE.Quaternion();
const _parentScale = new THREE.Vector3();
const _parentInverse = new THREE.Matrix4();
const _anchor = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

/** MAX_PART_SPEED / MAX_PART_SPIN, applied each frame. */
const clampSpeed = (body: Rapier.RigidBody): void => {
  const v = body.linvel();
  const speed = Math.hypot(v.x, v.y, v.z);
  if (speed > MAX_PART_SPEED) body.setLinvel({ x: (v.x * MAX_PART_SPEED) / speed, y: (v.y * MAX_PART_SPEED) / speed, z: (v.z * MAX_PART_SPEED) / speed }, true);
  const w = body.angvel();
  const spin = Math.hypot(w.x, w.y, w.z);
  if (spin > MAX_PART_SPIN) body.setAngvel({ x: (w.x * MAX_PART_SPIN) / spin, y: (w.y * MAX_PART_SPIN) / spin, z: (w.z * MAX_PART_SPIN) / spin }, true);
};

const posesOf = (bones: THREE.Bone[]): BonePose[] => bones.map((bone) => ({ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone() }));
const capture = (poses: BonePose[]): void => {
  for (const p of poses) {
    p.position.copy(p.bone.position);
    p.quaternion.copy(p.bone.quaternion);
  }
};

/**
 * ONE actor's ragdoll: every bone that enough of the mesh follows (skeletonLayoutOf) becomes a dynamic box
 * fitted to its vertices, joined to its nearest bodied ancestor by a spherical joint at the bone's origin,
 * in the client's physics world. While limp, the bones are written from the bodies each frame; released,
 * the bones keep the limp pose and `blend` eases them from it into whatever the animation poses, so the
 * body stands back up instead of snapping. Generic over any skinned model: a part is a bone, not a name.
 * The fall is simulated per client, from the same pose and impulse: limbs may land a little differently
 * on two screens, the body lands in the same place.
 */
export class Ragdoll {
  private parts: Part[] = [];
  private readonly bones: THREE.Bone[] = [];
  /** The bones as they stood when it went limp: what a re-pose starts from (a clip that does not move a
   *  bone must find it where it was, not where the ragdoll dropped it). */
  private readonly standing: BonePose[];
  /** The bones as they lay when it was released: what `blend` starts from. */
  private readonly limp: BonePose[];
  private lowestY = -Infinity;
  private frozen = false;

  constructor(
    private readonly world: Rapier.World,
    private readonly rapier: typeof Rapier,
    /** The actor's root: its bones are under it. */
    private readonly root: THREE.Object3D,
    private readonly layout: SkeletonLayout,
  ) {
    root.traverse((node) => {
      if ((node as THREE.Bone).isBone) this.bones.push(node as THREE.Bone);
    });
    this.standing = posesOf(this.bones);
    this.limp = posesOf(this.bones);
  }

  get active(): boolean {
    return this.parts.length > 0;
  }

  /** Goes limp from the pose the bones hold now. `velocity` is the body's as it went (u/s); the impulse is
   *  a change of velocity given to one bone's body. */
  start(impulse: RagdollImpulse | null, velocity: { x: number; y: number; z: number } | null): void {
    if (this.active) return;
    const { world, rapier } = this;
    this.root.updateWorldMatrix(true, true);
    capture(this.standing);
    const byBone = new Map<THREE.Object3D, Part>();
    let rootY = Infinity;

    for (const bone of this.bones) {
      const shape = this.layout.shapes.get(bone.name);
      if (!shape || shape.vertices < MIN_PART_VERTICES) continue;
      const leaf = !bone.children.some((child) => (child as THREE.Bone).isBone);
      if (leaf && shape.max.distanceTo(shape.min) < MIN_LEAF_PART_SIZE) continue;
      bone.matrixWorld.decompose(_position, _quaternion, _scale);
      const body = world.createRigidBody(
        rapier.RigidBodyDesc.dynamic()
          .setTranslation(_position.x, _position.y, _position.z)
          .setRotation({ x: _quaternion.x, y: _quaternion.y, z: _quaternion.z, w: _quaternion.w })
          .setLinearDamping(LINEAR_DAMPING)
          .setAngularDamping(ANGULAR_DAMPING)
          .setCcdEnabled(true),
      );
      const s = _scale.x;
      const half = (min: number, max: number) => Math.max(((max - min) / 2) * s * PART_BOX_SCALE, MIN_PART_HALF_EXTENT);
      const hx = half(shape.min.x, shape.max.x);
      const hy = half(shape.min.y, shape.max.y);
      const hz = half(shape.min.z, shape.max.z);
      const mass = Math.min(Math.max(8 * hx * hy * hz * PART_DENSITY, MIN_PART_MASS), MAX_PART_MASS);
      world.createCollider(
        rapier.ColliderDesc.cuboid(hx, hy, hz)
          .setTranslation(((shape.min.x + shape.max.x) / 2) * s, ((shape.min.y + shape.max.y) / 2) * s, ((shape.min.z + shape.max.z) / 2) * s)
          .setMass(mass)
          .setFriction(PART_FRICTION)
          .setCollisionGroups(RAGDOLL_COLLISION_GROUPS),
        body,
      );

      let parent: Part | null = null;
      for (let node = bone.parent; node && node !== this.root && !parent; node = node.parent) parent = byBone.get(node) ?? null;
      if (parent) {
        const p = parent.body.translation();
        const r = parent.body.rotation();
        _anchor.set(_position.x - p.x, _position.y - p.y, _position.z - p.z).applyQuaternion(_q.set(r.x, r.y, r.z, r.w).invert());
        world.createImpulseJoint(rapier.JointData.spherical({ x: _anchor.x, y: _anchor.y, z: _anchor.z }, { x: 0, y: 0, z: 0 }), parent.body, body, true);
      } else {
        rootY = Math.min(rootY, _position.y);
      }
      if (velocity) body.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);
      const part: Part = { bone, body, parent };
      byBone.set(bone, part);
      this.parts.push(part);
    }

    if (impulse && this.parts.length > 0) {
      const hit = this.parts.find((p) => p.bone.name === impulse.bone) ?? this.parts[0];
      const v = hit.body.linvel();
      hit.body.setLinvel({ x: v.x + impulse.x, y: v.y + impulse.y, z: v.z + impulse.z }, true);
    }
    this.lowestY = rootY - MAX_DROP;
    this.frozen = false;
  }

  /** Writes the bones from the bodies (parents first: each bone is set in its parent's fresh world frame). */
  step(): void {
    if (!this.active) return;
    for (const part of this.parts) {
      clampSpeed(part.body);
      const t = part.body.translation();
      const r = part.body.rotation();
      const parent = part.bone.parent!;
      parent.updateWorldMatrix(true, false);
      parent.matrixWorld.decompose(_parentPosition, _parentQuaternion, _parentScale);
      part.bone.quaternion.copy(_parentQuaternion).invert().multiply(_q.set(r.x, r.y, r.z, r.w));
      if (!part.parent) part.bone.position.set(t.x, t.y, t.z).applyMatrix4(_parentInverse.copy(parent.matrixWorld).invert());
      if (!this.frozen && !part.parent && t.y < this.lowestY) this.freeze();
    }
  }

  /** Lets go of the bodies; the bones keep the pose they lie in, for `blend` to start from. */
  release(): void {
    if (!this.active) return;
    capture(this.limp);
    this.removeBodies();
  }

  /** Back to the standing pose, before the animation re-poses the bones (see `standing`). */
  restoreStanding(): void {
    for (const p of this.standing) {
      p.bone.position.copy(p.position);
      p.bone.quaternion.copy(p.quaternion);
    }
  }

  /** From the limp pose (t 0) to the pose the bones hold now (t 1). */
  blend(t: number): void {
    for (const p of this.limp) {
      _q.copy(p.bone.quaternion);
      p.bone.quaternion.copy(p.quaternion).slerp(_q, t);
      _v.copy(p.bone.position);
      p.bone.position.lerpVectors(p.position, _v, t);
    }
  }

  /** Removes the bodies and puts the bones back as they stood: the model clone is pooled, and the next actor
   *  to use it must not inherit a fallen pose. */
  dispose(): void {
    if (this.active) this.restoreStanding();
    this.removeBodies();
  }

  /** It fell through the ground: every body stops where it is. */
  private freeze(): void {
    this.frozen = true;
    for (const part of this.parts) part.body.setEnabled(false);
  }

  private removeBodies(): void {
    for (const part of this.parts) this.world.removeRigidBody(part.body);
    this.parts = [];
  }
}
