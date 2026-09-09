import type * as THREE from "three";

/**
 * The beeble "ascend" visual: every mesh morphs toward a sphere while the
 * group scales up. Shared by the local state machine (stateMachine.ts) and
 * the networked beeble (Beeble.tsx, clip "ascend" from the server).
 *
 * The model's geometry is SHARED with the source GLTF (and the clone itself
 * is POOLED — see modelClonePool). Every mesh gets a private clone to morph,
 * and dispose() puts the shared geometry back and frees the clones: without
 * it every ascended beeble leaked its vertex buffers AND handed a
 * sphere-morphed body to the next beeble that reused its pooled clone.
 */

interface MorphTarget {
  posAttr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
  original: Float32Array;
  sphere: Float32Array;
}

export interface Inflate {
  /** Advance the morph. Saturates at t = 1 and then writes nothing. */
  update(dt: number): void;
  /** Restore shared geometry, free clones, reset scale. */
  dispose(): void;
}

const INFLATE_RATE = 0.5; // t per second
const MAX_SCALE_UP = 0.5;

export const beginInflate = (group: THREE.Object3D): Inflate => {
  const swapped: { node: THREE.Mesh; original: THREE.BufferGeometry; cloned: THREE.BufferGeometry }[] = [];
  const targets: MorphTarget[] = [];

  group.traverse((node: any) => {
    if (!node.isMesh || !node.geometry) return;
    const originalGeometry = node.geometry as THREE.BufferGeometry;
    const cloned = originalGeometry.clone();
    node.geometry = cloned;
    swapped.push({ node, original: originalGeometry, cloned });

    const posAttr = cloned.getAttribute("position");
    if (!posAttr) return;
    const original = new Float32Array(posAttr.array.length);
    original.set(posAttr.array as Float32Array);

    cloned.computeBoundingSphere();
    const center = cloned.boundingSphere!.center;
    const radius = cloned.boundingSphere!.radius;
    const sphere = new Float32Array(original.length);
    for (let i = 0; i < original.length; i += 3) {
      const dx = original[i] - center.x;
      const dy = original[i + 1] - center.y;
      const dz = original[i + 2] - center.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
      sphere[i] = center.x + (dx / dist) * radius;
      sphere[i + 1] = center.y + (dy / dist) * radius;
      sphere[i + 2] = center.z + (dz / dist) * radius;
    }
    targets.push({ posAttr, original, sphere });
  });

  let t = 0;
  let done = false;

  return {
    update(dt) {
      if (done) return;
      t = Math.min(t + dt * INFLATE_RATE, 1);
      // The morph saturates at t=1 — ONE final write there, then stop (this
      // used to rewrite + re-upload every vertex buffer every frame forever).
      for (const m of targets) {
        const arr = m.posAttr.array as Float32Array;
        for (let i = 0; i < arr.length; i++) arr[i] = m.original[i] + (m.sphere[i] - m.original[i]) * t;
        m.posAttr.needsUpdate = true;
      }
      const s = 1 + t * MAX_SCALE_UP;
      group.scale.set(s, s, s);
      if (t >= 1) done = true;
    },
    dispose() {
      for (const s of swapped) {
        s.node.geometry = s.original;
        s.cloned.dispose();
      }
      targets.length = 0;
      group.scale.set(1, 1, 1);
    },
  };
};
