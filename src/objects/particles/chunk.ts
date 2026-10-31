import * as THREE from "three";
import type { RectXZ } from "../../utils/math/types";
import { uploadOnFirstDraw } from "../../utils/uploadOnFirstDraw";

/**
 * A particle CHUNK: one mesh over one instanced geometry for every emitter of a 256u dressing chunk,
 * origins relative to the chunk's centre, an explicit culling sphere padded by the farthest flight. The
 * member seeds each emitter's particles from `seededStream("<tag>|x,z")` so a chunk rebuilds identically;
 * the dressing base fades it in as a chunk (Dressing.tsx selfPatchedMaterial).
 */

/** Collects one chunk's particles (positions ABSOLUTE; the chunk rebases them). */
export class ParticleWriter {
  readonly origins: number[] = [];
  readonly velocities: number[] = [];
  readonly lives: number[] = [];
  readonly phases: number[] = [];
  readonly sizes: number[] = [];
  readonly seeds: number[] = [];

  push(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, phase: number, size: number, seed: number): void {
    this.origins.push(x, y, z);
    this.velocities.push(vx, vy, vz);
    this.lives.push(life);
    this.phases.push(phase);
    this.sizes.push(size);
    this.seeds.push(seed);
  }

  get count(): number {
    return this.lives.length;
  }
}

const QUAD = new THREE.PlaneGeometry(1, 1);

/** The chunk's mesh, or null with no particles. `maxTravel` pads the culling sphere by the farthest flight. */
export const buildParticleChunk = (writer: ParticleWriter, bounds: RectXZ, material: THREE.Material, maxTravel: number, renderOrder: number): THREE.Mesh | null => {
  const n = writer.count;
  if (n === 0) return null;
  const ox = (bounds.minX + bounds.maxX) / 2;
  const oz = (bounds.minZ + bounds.maxZ) / 2;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const y = writer.origins[i * 3 + 1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const oy = (minY + maxY) / 2;
  const origins = new Float32Array(n * 3);
  let reach = 0;
  for (let i = 0; i < n; i++) {
    const x = writer.origins[i * 3] - ox;
    const y = writer.origins[i * 3 + 1] - oy;
    const z = writer.origins[i * 3 + 2] - oz;
    origins[i * 3] = x;
    origins[i * 3 + 1] = y;
    origins[i * 3 + 2] = z;
    reach = Math.max(reach, x * x + y * y + z * z);
  }
  const geometry = new THREE.InstancedBufferGeometry();
  // The quad's own copies: a chunk's geometry.dispose() (the dressing base's drop) deletes the GL buffer of
  // EVERY attribute it holds, and shared ones were re-uploaded by the next surviving chunk's draw.
  geometry.setIndex(QUAD.getIndex()!.clone());
  geometry.setAttribute("position", QUAD.getAttribute("position").clone());
  geometry.setAttribute("uv", QUAD.getAttribute("uv").clone());
  geometry.setAttribute("aOrigin", new THREE.InstancedBufferAttribute(origins, 3));
  geometry.setAttribute("aVelocity", new THREE.InstancedBufferAttribute(new Float32Array(writer.velocities), 3));
  geometry.setAttribute("aLife", new THREE.InstancedBufferAttribute(new Float32Array(writer.lives), 1));
  geometry.setAttribute("aPhase", new THREE.InstancedBufferAttribute(new Float32Array(writer.phases), 1));
  geometry.setAttribute("aSize", new THREE.InstancedBufferAttribute(new Float32Array(writer.sizes), 1));
  geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(new Float32Array(writer.seeds), 1));
  geometry.instanceCount = n;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), Math.sqrt(reach) + maxTravel);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(ox, oy, oz);
  mesh.renderOrder = renderOrder;
  mesh.userData.ownsGeometry = true;
  uploadOnFirstDraw(mesh);
  return mesh;
};
