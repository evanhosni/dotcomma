import type * as THREE from "three";

/** One bone's share of a skinned model, in the bone's own space at the bind pose: the box around the
 *  vertices that follow it most, and how many there are. */
export interface BoneShape {
  min: THREE.Vector3;
  max: THREE.Vector3;
  vertices: number;
}

/** A skinned model read once per geometry (ragdoll/utils.ts skeletonLayoutOf). */
export interface SkeletonLayout {
  shapes: Map<string, BoneShape>;
  /** Model space (the clone's root, at the bind pose) → each bone's space. */
  modelToBone: Map<string, THREE.Matrix4>;
}

/** Where a model actor's ragdoll is (ragdoll/hooks.ts): standing, limp, or blending back into its animation. */
export type RagdollPhase = "none" | "limp" | "recovering";
