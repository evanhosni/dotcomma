import * as THREE from "three";
import { BATCH_REACH, BATCH_SIZE, DECAL_LIFT } from "./constants";
import type { DecalLook, DecalStamp } from "./types";

interface Batch {
  mesh: THREE.InstancedMesh;
  /** Per decal: its seed, and when it was stamped (the material's clock). */
  decal: THREE.InstancedBufferAttribute;
  /** When its newest decal was stamped: once that one's time is up, the whole batch is free. */
  lastAt: number;
}

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _align = new THREE.Quaternion();
const _spin = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const FACING = new THREE.Vector3(0, 0, 1);
/** A quad, facing +z, in −0.5..0.5: the shape is cut from it. */
const QUAD = new THREE.PlaneGeometry(1, 1);

/**
 * Every decal of ONE kind: batches of instanced quads, each placed at its first decal (small offsets) and
 * taking the decals stamped near it, until full; an expired batch is free again, and past the kind's
 * capacity the batch stamped longest ago gives way.
 */
export class DecalLayer {
  private readonly batches: Batch[] = [];
  private readonly maxBatches: number;

  constructor(private readonly scene: THREE.Object3D, private readonly material: THREE.Material, private readonly look: DecalLook) {
    this.maxBatches = Math.ceil(look.capacity / BATCH_SIZE);
  }

  add({ at, normal, size }: DecalStamp, now: number): void {
    const batch = this.batchNear(at, now);
    const i = batch.mesh.count++;
    const origin = batch.mesh.position;
    _normal.set(normal[0], normal[1], normal[2]);
    _position.set(at[0] - origin.x, at[1] - origin.y, at[2] - origin.z).addScaledVector(_normal, DECAL_LIFT);
    _align.setFromUnitVectors(FACING, _normal).multiply(_spin.setFromAxisAngle(FACING, Math.random() * Math.PI * 2));
    batch.mesh.setMatrixAt(i, _matrix.compose(_position, _align, _scale.set(size, size, 1)));
    batch.mesh.instanceMatrix.needsUpdate = true;
    batch.decal.setXY(i, Math.random(), now);
    batch.decal.needsUpdate = true;
    batch.lastAt = now;
  }

  /** Frees the batches whose time is up. */
  update(now: number): void {
    for (const batch of this.batches) {
      if (batch.mesh.visible && now - batch.lastAt > this.look.seconds) batch.mesh.visible = false;
    }
  }

  dispose(): void {
    for (const batch of this.batches) {
      batch.mesh.removeFromParent();
      batch.mesh.dispose();
      batch.mesh.geometry.dispose();
    }
    this.batches.length = 0;
  }

  /** The batch a decal at `at` goes in: the newest one near it with room, else a free one, a new one, or the
   *  stalest, started over there. */
  private batchNear(at: readonly number[], now: number): Batch {
    let near: Batch | null = null;
    for (const batch of this.batches) {
      if (!batch.mesh.visible || batch.mesh.count >= BATCH_SIZE) continue;
      const o = batch.mesh.position;
      if ((at[0] - o.x) ** 2 + (at[1] - o.y) ** 2 + (at[2] - o.z) ** 2 > BATCH_REACH * BATCH_REACH) continue;
      if (!near || batch.lastAt > near.lastAt) near = batch;
    }
    if (near) return near;
    const free =
      this.batches.find((b) => !b.mesh.visible) ??
      (this.batches.length < this.maxBatches ? this.create() : this.batches.reduce((p, q) => (q.lastAt < p.lastAt ? q : p)));
    free.mesh.count = 0;
    free.mesh.position.set(at[0], at[1], at[2]);
    free.mesh.updateMatrix();
    free.mesh.updateMatrixWorld();
    free.mesh.visible = true;
    free.lastAt = now;
    return free;
  }

  private create(): Batch {
    const mesh = new THREE.InstancedMesh(QUAD, this.material, BATCH_SIZE);
    const decal = new THREE.InstancedBufferAttribute(new Float32Array(BATCH_SIZE * 2), 2);
    decal.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // A geometry per batch: the per-decal attribute is the batch's own.
    mesh.geometry = QUAD.clone();
    mesh.geometry.setAttribute("aDecal", decal);
    mesh.matrixAutoUpdate = false;
    // Culled by the batch's reach, not by its instances' (recomputed on every stamp otherwise).
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), BATCH_REACH + 2);
    mesh.visible = false;
    this.scene.add(mesh);
    const batch: Batch = { mesh, decal, lastAt: -Infinity };
    this.batches.push(batch);
    return batch;
  }
}
