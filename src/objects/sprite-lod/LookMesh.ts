import * as THREE from "three";
import { spriteDetailOf } from "./detail";
import {
  INSTANCE_BORN,
  INSTANCE_DATA,
  INSTANCE_DETAIL,
  INSTANCE_FLOATS,
  INSTANCE_LOD,
  INSTANCE_OFFSET,
  INSTANCE_SIZE,
  SPRITE_DATA_FLOATS,
} from "./layout";
import { createSpriteMaterial } from "./spriteMaterial";
import type { SpriteChunkLook, SpriteLook } from "./types";

const MIN_CAPACITY = 256;
const GROWTH_FACTOR = 1.5;

/** One look: its mesh, and its instance buffer packed from the front (a removal moves the last instance into
 *  the hole), so a chunk arriving or leaving touches only its own sprites. */
export class LookMesh {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.MeshStandardMaterial>;
  private buffer!: THREE.InstancedInterleavedBuffer;
  private capacity = 0;
  private count = 0;
  /** Spawn-point id → instance slot. */
  private readonly slots = new Map<string, number>();
  /** Instance slot → spawn-point id. */
  private readonly ids: string[] = [];
  /** The buffer has not reached the GPU yet: its first upload sends all of it, so ranges would only repeat it. */
  private unsent = true;

  constructor(readonly look: SpriteLook) {
    this.mesh = new THREE.Mesh(this.createGeometry(MIN_CAPACITY), createSpriteMaterial(look));
    // Instances span kilometres around the camera.
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
  }

  /** The most instances the renderer will actually draw. */
  get drawCap(): number {
    return (this.mesh.geometry as unknown as { _maxInstanceCount?: number })._maxInstanceCount ?? this.capacity;
  }

  placeAt(originX: number, originZ: number): void {
    this.mesh.position.set(originX, 0, originZ);
    this.mesh.updateMatrix();
    this.mesh.updateMatrixWorld();
  }

  /** One chunk's sprites of this look; (dx, dz) is the chunk's corner relative to the rebase origin, in float64. */
  add({ ids, instances }: SpriteChunkLook, dx: number, dz: number, born: number): void {
    if (ids.length === 0) return;
    this.ensureCapacity(this.count + ids.length);
    const array = this.buffer.array as Float32Array;
    const first = this.count;
    array.set(instances, first * INSTANCE_FLOATS);
    ids.forEach((id, i) => {
      const o = (first + i) * INSTANCE_FLOATS;
      array[o + INSTANCE_OFFSET] += dx;
      array[o + INSTANCE_OFFSET + 2] += dz;
      array[o + INSTANCE_DETAIL] = spriteDetailOf(id);
      array[o + INSTANCE_BORN] = born;
      this.slots.set(id, first + i);
      this.ids[first + i] = id;
    });
    this.setCount(first + ids.length);
    this.markDirty(first * INSTANCE_FLOATS, ids.length * INSTANCE_FLOATS);
  }

  remove(ids: readonly string[]): void {
    const array = this.buffer.array as Float32Array;
    for (const id of ids) {
      const slot = this.slots.get(id);
      if (slot === undefined) continue;
      this.slots.delete(id);
      const last = this.count - 1;
      const moved = this.ids.pop()!;
      this.setCount(last);
      if (slot === last) continue;
      array.copyWithin(slot * INSTANCE_FLOATS, last * INSTANCE_FLOATS, (last + 1) * INSTANCE_FLOATS);
      this.ids[slot] = moved;
      this.slots.set(moved, slot);
      this.markDirty(slot * INSTANCE_FLOATS, INSTANCE_FLOATS);
    }
  }

  clear(): void {
    this.slots.clear();
    this.ids.length = 0;
    this.setCount(0);
  }

  /** False when the id has no sprite here. */
  writeDetail(id: string, visibility: number): boolean {
    const slot = this.slots.get(id);
    if (slot === undefined) return false;
    const o = slot * INSTANCE_FLOATS + INSTANCE_DETAIL;
    this.buffer.array[o] = visibility;
    this.markDirty(o, 1);
    return true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }

  private setCount(count: number): void {
    this.count = count;
    this.mesh.geometry.instanceCount = count;
  }

  private markDirty(start: number, floats: number): void {
    if (!this.unsent) this.buffer.addUpdateRange(start, floats);
    this.buffer.needsUpdate = true;
  }

  /** Growth builds a NEW geometry: three fixes an instanced geometry's draw cap (_maxInstanceCount) on its first
   *  draw and only forgets it on dispose, so a bigger buffer on the same geometry drew only the first load. */
  private ensureCapacity(needed: number): void {
    if (needed <= this.capacity) return;
    const previous = this.mesh.geometry;
    const kept = (this.buffer.array as Float32Array).subarray(0, this.count * INSTANCE_FLOATS);
    this.mesh.geometry = this.createGeometry(Math.max(needed, Math.ceil(this.capacity * GROWTH_FACTOR)));
    (this.buffer.array as Float32Array).set(kept);
    this.mesh.geometry.instanceCount = this.count;
    previous.dispose();
  }

  private createGeometry(capacity: number): THREE.InstancedBufferGeometry {
    const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(quad.getIndex());
    for (const name of ["position", "normal", "uv"]) geometry.setAttribute(name, quad.getAttribute(name));
    const buffer = new THREE.InstancedInterleavedBuffer(new Float32Array(capacity * INSTANCE_FLOATS), INSTANCE_FLOATS, 1);
    buffer.setUsage(THREE.DynamicDrawUsage);
    this.unsent = true;
    // three has InterleavedBuffer.onUpload; @types/three 0.170 leaves it out.
    (buffer as unknown as THREE.BufferAttribute).onUpload(() => (this.unsent = false));
    geometry.setAttribute("aSpriteOffset", new THREE.InterleavedBufferAttribute(buffer, 3, INSTANCE_OFFSET));
    geometry.setAttribute("aSpriteSize", new THREE.InterleavedBufferAttribute(buffer, 2, INSTANCE_SIZE));
    geometry.setAttribute("aSpriteLod", new THREE.InterleavedBufferAttribute(buffer, 4, INSTANCE_LOD));
    for (let i = 0; i < SPRITE_DATA_FLOATS / 4; i++) {
      geometry.setAttribute(`aSpriteData${i}`, new THREE.InterleavedBufferAttribute(buffer, 4, INSTANCE_DATA + i * 4));
    }
    geometry.instanceCount = 0;
    this.buffer = buffer;
    this.capacity = capacity;
    return geometry;
  }
}
