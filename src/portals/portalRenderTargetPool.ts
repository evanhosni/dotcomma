import * as THREE from "three";

/**
 * Pool of WebGLRenderTargets shared across all Portal instances.
 *
 * Allocating a render target allocates GPU texture memory; doing it on every
 * Portal mount/unmount contributes to the spawn/despawn lag spike. This pool
 * lets a recently unmounted portal's render target be reused by the next one
 * that mounts, avoiding allocation on the critical path.
 *
 * Each render target is created with isXRRenderTarget + SRGBColorSpace — a
 * trick that makes Three.js apply tone mapping + sRGB encoding during the
 * portal render, matching the main output so the portal shader can just pass
 * through without re-processing.
 */

const pool: THREE.WebGLRenderTarget[] = [];

const createRenderTarget = (): THREE.WebGLRenderTarget => {
  const rt = new THREE.WebGLRenderTarget(2, 2, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  (rt as any).isXRRenderTarget = true;
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  return rt;
};

export const acquireRenderTarget = (): THREE.WebGLRenderTarget => {
  return pool.pop() ?? createRenderTarget();
};

export const releaseRenderTarget = (rt: THREE.WebGLRenderTarget): void => {
  pool.push(rt);
};
