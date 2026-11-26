import * as THREE from "three";
import { boneNamed } from "../objects/actors/ragdoll/utils";
import { reportContentError } from "../utils/utils";
import { AIM_DISTANCE, ARM_BONES, DEFAULT_REACH, HOLD_BLEND_SECONDS } from "./constants";
import { HOLD } from "./enums";
import { EQUIPPABLE_MODELS } from "./registry";
import { equippableOf } from "./spec";
import type { Arm, EquippableSpec } from "./types";

interface ArmChain {
  upper: THREE.Bone;
  lower: THREE.Bone;
  /** The hand, in the lower bone's space: where its children (the fingers) start. */
  hand: THREE.Vector3;
}

const BONE_AXIS = new THREE.Vector3(0, 1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const _look = new THREE.Vector3();
const _target = new THREE.Vector3();
const _from = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _want = new THREE.Vector3();
const _side = new THREE.Vector3();
const _up = new THREE.Vector3();
const _hand = new THREE.Vector3();
const _grip = new THREE.Vector3();
const _world = new THREE.Quaternion();
const _parent = new THREE.Quaternion();
const _turn = new THREE.Quaternion();
const _local = new THREE.Quaternion();
const _basis = new THREE.Matrix4();

/** The arm's chain in `model`; null (a loud content error) for a rig without it. */
const chainOf = (model: THREE.Object3D, arm: Arm): ArmChain | null => {
  const names = ARM_BONES[arm];
  const upper = boneNamed(model, names.upper) as THREE.Bone | null;
  const lower = boneNamed(model, names.lower) as THREE.Bone | null;
  if (!upper || !lower) {
    reportContentError(`a model holding an equippable has no ${arm} arm (equippables/constants.ts ARM_BONES)`);
    return null;
  }
  const fingers = lower.children.filter((c) => (c as THREE.Bone).isBone);
  const hand = new THREE.Vector3();
  for (const f of fingers) hand.add(f.position);
  if (fingers.length > 0) hand.divideScalar(fingers.length);
  return { upper, lower, hand };
};

/** Turns `bone` (posed, its parent's world matrix fresh) so its length points at `target`, `weight` of the
 *  way from where the animation put it. */
const pointBoneAt = (bone: THREE.Bone, target: THREE.Vector3, weight: number): void => {
  bone.getWorldQuaternion(_world);
  _from.setFromMatrixPosition(bone.matrixWorld);
  _axis.copy(BONE_AXIS).applyQuaternion(_world);
  _want.subVectors(target, _from).normalize();
  _turn.setFromUnitVectors(_axis, _want);
  bone.parent!.getWorldQuaternion(_parent);
  _local.copy(_parent).invert().multiply(_turn.multiply(_world));
  bone.quaternion.slerp(_local, weight);
  bone.updateMatrixWorld(true);
};

/**
 * What ONE body holds (equippables/): the item's model in its hand, and its arms posed to hold it. Called
 * after the animation posed the bones each frame (`pose`): an AIM hold points the spec's arms where the body
 * looks (one arm along the look, two meeting before the chest), blended in and out over HOLD_BLEND_SECONDS,
 * and the item lies in the first arm's hand, its forward along the forearm, its grip in the palm. The item is
 * drawn under `holder`, a group with no transform of its own (the body's clone is pooled and must not keep it).
 */
export class EquippableHolder {
  private readonly models = new Map<string, THREE.Object3D>();
  private readonly chains = new Map<Arm, ArmChain | null>();
  private shown: THREE.Object3D | null = null;
  /** The spec whose arms are up (or coming down), and how far up (0–1). */
  private raised: EquippableSpec | null = null;
  private weight = 0;

  constructor(private readonly model: THREE.Object3D, private readonly holder: THREE.Object3D) {}

  /** The body holds `id` ("" nothing) and looks along (yaw, pitch); `dt` (s) the frame. Returns the item's
   *  model drawn now (its flashes are the caller's), or null. */
  pose(id: string, yaw: number, pitch: number, dt: number, visible: boolean): THREE.Object3D | null {
    const spec = id ? equippableOf(id) ?? null : null;
    const item = spec ? this.modelOf(spec.id) : null;
    if (this.shown !== item) {
      if (this.shown) this.shown.visible = false;
      this.shown = item;
    }
    if (spec?.hold === HOLD.AIM) this.raised = spec;
    const up = spec?.hold === HOLD.AIM ? 1 : 0;
    this.weight += Math.sign(up - this.weight) * Math.min(Math.abs(up - this.weight), dt / HOLD_BLEND_SECONDS);
    if (this.raised && this.weight > 0) this.aim(this.raised, yaw, pitch, this.weight);
    else if (this.weight === 0) this.raised = null;
    if (!item || !spec) return null;
    item.visible = visible;
    if (visible) this.placeInHand(item, spec, yaw);
    return item;
  }

  /** Whether it moved the arms off the animation this frame (the skin must be redrawn). */
  get posing(): boolean {
    return this.weight > 0;
  }

  dispose(): void {
    for (const m of this.models.values()) m.removeFromParent();
    this.models.clear();
    this.shown = null;
  }

  private modelOf(id: string): THREE.Object3D | null {
    let m = this.models.get(id);
    if (!m) {
      const create = EQUIPPABLE_MODELS[id];
      if (!create) return null;
      m = create();
      m.visible = false;
      this.holder.add(m);
      this.models.set(id, m);
    }
    return m;
  }

  private chain(arm: Arm): ArmChain | null {
    if (!this.chains.has(arm)) this.chains.set(arm, chainOf(this.model, arm));
    return this.chains.get(arm)!;
  }

  private aim(spec: EquippableSpec, yaw: number, pitch: number, weight: number): void {
    const chains = spec.arms.map((arm) => this.chain(arm)).filter((c): c is ArmChain => c !== null);
    if (chains.length === 0) return;
    this.model.updateWorldMatrix(true, true);
    _look.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    // Two arms meet before the chest (between their shoulders); one points along the look.
    _target.set(0, 0, 0);
    for (const c of chains) _target.add(_from.setFromMatrixPosition(c.upper.matrixWorld));
    _target.divideScalar(chains.length).addScaledVector(_look, chains.length > 1 ? (spec.reach ?? DEFAULT_REACH) : AIM_DISTANCE);
    for (const c of chains) {
      pointBoneAt(c.upper, _target, weight);
      pointBoneAt(c.lower, _target, weight);
    }
  }

  /** The item in the first arm's hand: forward along the forearm, up as near the world's up as it can be,
   *  its grip on the hand. */
  private placeInHand(item: THREE.Object3D, spec: EquippableSpec, yaw: number): void {
    const chain = this.chain(spec.arms[0]);
    if (!chain) return;
    chain.lower.updateWorldMatrix(true, false);
    _hand.copy(chain.hand).applyMatrix4(chain.lower.matrixWorld);
    chain.lower.getWorldQuaternion(_world);
    const forward = _axis.copy(BONE_AXIS).applyQuaternion(_world).normalize();
    // Straight up or down the forearm: its up is the body's forward instead.
    const reference = Math.abs(forward.dot(UP)) > 0.98 ? _up.set(Math.sin(yaw), 0, Math.cos(yaw)) : _up.copy(UP);
    _side.crossVectors(reference, forward).normalize();
    _up.crossVectors(forward, _side);
    item.quaternion.setFromRotationMatrix(_basis.makeBasis(_side, _up, forward));
    item.scale.setScalar(spec.scale);
    _grip.set(spec.grip[0], spec.grip[1], spec.grip[2]).multiplyScalar(spec.scale).applyQuaternion(item.quaternion);
    item.position.copy(_hand).sub(_grip);
    item.updateMatrix();
    item.updateMatrixWorld(true);
  }
}
