import type * as THREE from "three";

// The "ascend" sphere morph. Geometry is SHARED with the source GLTF and the
// clone is POOLED, so each mesh morphs a private clone and dispose() must
// restore the original — otherwise the next beeble reusing the clone
// inherited a sphere-morphed body, and the buffers leaked.

/** modelClonePool's MergedSkinnedPart, restated: this file is in the SERVER's type graph (the beeble
 *  state machine imports it) and the pool is not Three-free. */
interface MergedSkinnedPart {
  start: number;
  count: number;
  center: [number, number, number];
  radius: number;
}

interface MorphTarget {
  posAttr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
  original: Float32Array;
  sphere: Float32Array;
}

export interface Inflate {
  update(dt: number): void;
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

    const sphere = new Float32Array(original.length);
    const toSphere = (start: number, count: number, cx: number, cy: number, cz: number, radius: number) => {
      for (let i = start * 3; i < (start + count) * 3; i += 3) {
        const dx = original[i] - cx;
        const dy = original[i + 1] - cy;
        const dz = original[i + 2] - cz;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
        sphere[i] = cx + (dx / dist) * radius;
        sphere[i + 1] = cy + (dy / dist) * radius;
        sphere[i + 2] = cz + (dz / dist) * radius;
      }
    };
    // A merged mesh (modelClonePool) inflates each source mesh's range onto that mesh's own sphere.
    const parts = originalGeometry.userData.mergedSkinnedParts as MergedSkinnedPart[] | undefined;
    if (parts) {
      for (const p of parts) toSphere(p.start, p.count, p.center[0], p.center[1], p.center[2], p.radius);
    } else {
      cloned.computeBoundingSphere();
      const { center, radius } = cloned.boundingSphere!;
      toSphere(0, original.length / 3, center.x, center.y, center.z, radius);
    }
    targets.push({ posAttr, original, sphere });
  });

  let t = 0;
  let done = false;

  return {
    update(dt) {
      if (done) return;
      t = Math.min(t + dt * INFLATE_RATE, 1);
      // One final write at t=1, then stop — writing on would re-upload every buffer every frame.
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
