import * as THREE from "three";
import type { Cut } from "../../../net/protocol/types";
import { addBleeder } from "../../../vfx/blood";
import { RootRelativeSkeleton } from "../model/RootRelativeSkeleton";
import { skinnedFrameOf } from "../wounds/utils";
import type { SkinnedPoint } from "../wounds/utils";
import { BLEED_SECONDS, MAX_BLEEDERS } from "./constants";
import { sliceMesh, weldOf } from "./geometry";
import { fleshMaterial } from "./material";
import type { SliceResult } from "./types";
import { cutKey, gibCutsOf } from "./utils";

/** One skinned mesh of the clone as it was before any cut, and its weld now. */
interface SlicedMeshState {
  mesh: THREE.SkinnedMesh;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  firstWeld: Int32Array;
  weld: Int32Array;
}

/** What a clone's slices are made on (model/types.ts PooledModelClone). */
export interface SliceableClone {
  scene: THREE.Object3D;
  /** Every skeleton the clone draws with: a slice replaces its one in place (markPoseChanged reads it). */
  skeletons: THREE.Skeleton[];
  quantization: number | undefined;
}

/** A piece of one cut, across the clone's meshes: (mesh, piece) → one key. */
const pieceKey = (mesh: number, piece: number): number => mesh * 65536 + piece;

const _local = new THREE.Matrix4();
const _at = new THREE.Vector3();
const _normal = new THREE.Vector3();

/**
 * The slices of ONE model clone (a blade's cuts, a blast's burst): its skinned meshes cut along each cut's
 * planes (geometry.ts), capped with flesh, and its SKELETON split so the pieces part. Each piece the cut
 * made OWNS the bones it weighs most on; a bone a piece leans on that another owns gets a copy of its own
 * (named `<bone>~<cut>.<n>`, deterministic, so a later wound or cut names it on every client), and a bone
 * whose parent another piece owns is re-rooted under the armature: no joint holds the pieces together. An
 * island the cut never crossed (an eye) rides the bones it always did. The ragdoll (ragdoll/Ragdoll.ts)
 * then gives every piece bodies of its own. A fresh cut's stumps bleed (vfx/blood/). A clone is pooled:
 * `dispose` puts everything back before its ragdoll lets go (that restores the standing pose).
 */
export class SliceSet {
  private readonly meshes: SlicedMeshState[] = [];
  private applied: string[] = [];
  private originalSkeleton: THREE.Skeleton | null = null;
  private readonly ownSkeletons: THREE.Skeleton[] = [];
  private readonly dups: THREE.Bone[] = [];
  /** Original bones moved under another parent, in order: undone in reverse. */
  private readonly moves: { bone: THREE.Bone; parent: THREE.Object3D }[] = [];
  private readonly stopBleeding: (() => void)[] = [];
  private welds = { next: 0 };
  private firstWeldCount = 0;
  private bounds: THREE.Box3 | null = null;

  constructor(private readonly clone: SliceableClone) {
    clone.scene.traverse((node) => {
      const mesh = node as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh || !mesh.skeleton || !mesh.geometry.index || Array.isArray(mesh.material)) return;
      this.meshes.push({ mesh, geometry: mesh.geometry, material: mesh.material, firstWeld: new Int32Array(0), weld: new Int32Array(0) });
    });
  }

  /** Whether the body is cut now. */
  get sliced(): boolean {
    return this.applied.length > 0;
  }

  /** The cuts the body should bear, and a burst (`gibSeed`: the body's id) after them. `fresh`: they happen
   *  now (their stumps bleed), not cuts it already had when it came into view. True when the body changed:
   *  its ragdoll must be rebuilt. An unchanged list costs a key per cut. */
  set(cuts: readonly Cut[], gibSeed: string | null, fresh: boolean): boolean {
    if (this.meshes.length === 0) return false;
    const wanted = gibSeed ? [...cuts, ...gibCutsOf(gibSeed, this.bindBounds())] : cuts;
    const keys = wanted.map(cutKey);
    if (keys.length === this.applied.length && keys.every((k, i) => k === this.applied[i])) return false;
    const extends_ = this.applied.every((k, i) => k === keys[i]);
    if (!extends_) this.restore();
    for (let i = this.applied.length; i < wanted.length; i++) {
      this.apply(wanted[i], this.applied.length, fresh);
      this.applied.push(keys[i]);
    }
    return true;
  }

  dispose(): void {
    this.restore();
  }

  /** The body's bounds in the bind space (a burst's planes go through it). */
  private bindBounds(): THREE.Box3 {
    if (this.bounds) return this.bounds;
    const bounds = new THREE.Box3();
    const v = new THREE.Vector3();
    for (const { mesh, geometry } of this.meshes) {
      const position = geometry.getAttribute("position");
      for (let i = 0; i < position.count; i++) bounds.expandByPoint(v.fromBufferAttribute(position, i).applyMatrix4(mesh.bindMatrix));
    }
    return (this.bounds = bounds);
  }

  private ensureWelds(): void {
    if (this.firstWeldCount > 0 || this.welds.next > 0) return;
    // One weld space across the clone's meshes: ids never collide between them.
    let offset = 0;
    for (const state of this.meshes) {
      const weld = weldOf(state.geometry);
      let max = -1;
      for (let i = 0; i < weld.length; i++) {
        weld[i] += offset;
        max = Math.max(max, weld[i]);
      }
      offset = max + 1;
      state.firstWeld = weld;
      state.weld = weld;
    }
    this.firstWeldCount = offset;
    this.welds.next = offset;
  }

  private apply(cut: Cut, serial: number, fresh: boolean): void {
    this.ensureWelds();
    const skeleton = this.meshes[0].mesh.skeleton;
    const boneNames = skeleton.bones.map((b) => b.name);
    const results: (SliceResult | null)[] = this.meshes.map((m) =>
      sliceMesh({ geometry: m.mesh.geometry, bindMatrix: m.mesh.bindMatrix, boneNames, weld: m.weld }, cut, this.welds),
    );
    if (results.every((r) => r === null)) return;

    // Each piece's weight on each bone; a bone's owner is the piece leaning on it most.
    const weights = new Map<number, Map<number, number>>();
    results.forEach((result, m) => {
      if (!result) return;
      const index = result.geometry.getAttribute("skinIndex");
      const weight = result.geometry.getAttribute("skinWeight");
      for (let v = 0; v < result.piece.length; v++) {
        if (result.piece[v] < 0) continue;
        const key = pieceKey(m, result.piece[v]);
        let byBone = weights.get(key);
        if (!byBone) weights.set(key, (byBone = new Map()));
        for (let c = 0; c < 4; c++) {
          const w = weight.getComponent(v, c);
          if (w > 0) byBone.set(index.getComponent(v, c), (byBone.get(index.getComponent(v, c)) ?? 0) + w);
        }
      }
    });
    const pieces = [...weights.keys()].sort((p, q) => p - q);
    const owner = new Map<number, number>();
    const best = new Map<number, number>();
    for (const piece of pieces) {
      for (const [bone, w] of weights.get(piece)!) {
        if (w > (best.get(bone) ?? 0)) {
          best.set(bone, w);
          owner.set(bone, piece);
        }
      }
    }

    const bones = [...skeleton.bones];
    const inverses = [...skeleton.boneInverses];
    const indexOf = new Map(bones.map((bone, i) => [bone, i]));
    const depthOf = (bone: THREE.Object3D): number => {
      let depth = 0;
      for (let node = bone.parent; node && indexOf.has(node as THREE.Bone); node = node.parent) depth++;
      return depth;
    };
    let top: THREE.Object3D = bones[0];
    while (top.parent && indexOf.has(top.parent as THREE.Bone)) top = top.parent;
    const armature = top.parent ?? this.clone.scene;
    this.clone.scene.updateWorldMatrix(true, true);

    // Each piece's copies of the bones it leans on but does not own, parents first.
    const copies = new Map<number, Map<number, number>>();
    const versionIn = (piece: number, bone: number): number | undefined => (owner.get(bone) === piece ? bone : copies.get(piece)?.get(bone));
    let made = 0;
    for (const piece of pieces) {
      const leaned = [...weights.get(piece)!.keys()].filter((b) => owner.get(b) !== piece).sort((p, q) => depthOf(bones[p]) - depthOf(bones[q]) || p - q);
      for (const b of leaned) {
        const source = bones[b];
        const parentIndex = indexOf.get(source.parent as THREE.Bone);
        const parentVersion = parentIndex === undefined ? undefined : versionIn(piece, parentIndex);
        const parent = parentVersion !== undefined ? bones[parentVersion] : armature;
        const copy = new THREE.Bone();
        copy.name = `${source.name}~${serial}.${made++}`;
        copy.userData.sliceSource = source;
        parent.add(copy);
        _local.copy(parent.matrixWorld).invert().multiply(source.matrixWorld);
        _local.decompose(copy.position, copy.quaternion, copy.scale);
        copy.updateMatrixWorld(true);
        this.dups.push(copy);
        let pieceCopies = copies.get(piece);
        if (!pieceCopies) copies.set(piece, (pieceCopies = new Map()));
        pieceCopies.set(b, bones.length);
        bones.push(copy);
        inverses.push(skeleton.boneInverses[b].clone());
      }
    }
    // An owned bone whose parent another piece owns is parted from it: under its own piece's copy of the
    // parent, or the armature. A parent no piece of this cut leans on keeps it (the cut never passed there).
    for (const [b, piece] of [...owner.entries()].sort((p, q) => depthOf(bones[p[0]]) - depthOf(bones[q[0]]) || p[0] - q[0])) {
      const bone = bones[b];
      const parentIndex = indexOf.get(bone.parent as THREE.Bone);
      if (parentIndex === undefined || !owner.has(parentIndex) || owner.get(parentIndex) === piece) continue;
      const copy = copies.get(piece)?.get(parentIndex);
      this.moves.push({ bone, parent: bone.parent! });
      (copy !== undefined ? bones[copy] : armature).attach(bone);
    }

    const next = new RootRelativeSkeleton(bones, inverses, this.clone.scene);
    this.ownSkeletons.push(next);
    this.originalSkeleton ??= skeleton;
    const at = this.clone.skeletons.indexOf(skeleton);
    if (at >= 0) this.clone.skeletons[at] = next;
    else this.clone.skeletons.push(next);

    results.forEach((result, m) => {
      const state = this.meshes[m];
      state.mesh.skeleton = next;
      if (!result) return;
      const index = result.geometry.getAttribute("skinIndex") as THREE.BufferAttribute;
      for (let v = 0; v < result.piece.length; v++) {
        if (result.piece[v] < 0) continue;
        const key = pieceKey(m, result.piece[v]);
        for (let c = 0; c < 4; c++) {
          const b = index.getComponent(v, c);
          if (owner.get(b) !== key && result.geometry.getAttribute("skinWeight").getComponent(v, c) > 0) {
            const copy = copies.get(key)?.get(b);
            if (copy !== undefined) index.setComponent(v, c, copy);
          }
        }
      }
      if (state.mesh.geometry !== state.geometry) state.mesh.geometry.dispose();
      state.mesh.geometry = result.geometry;
      state.mesh.material = [state.material, fleshMaterial(this.clone.quantization)];
      state.weld = result.weld;
      if (fresh) this.bleed(state.mesh, result, next);
    });
  }

  /** The stumps of a fresh cut spurt blood for a while (the first MAX_BLEEDERS of the body's). */
  private bleed(mesh: THREE.SkinnedMesh, result: SliceResult, skeleton: THREE.Skeleton): void {
    const position = result.geometry.getAttribute("position");
    const index = result.geometry.getAttribute("skinIndex");
    const weight = result.geometry.getAttribute("skinWeight");
    for (const stump of result.stumps) {
      if (this.stopBleeding.length >= MAX_BLEEDERS) return;
      const point: SkinnedPoint = {
        bones: [],
        inverses: [],
        weights: [],
        bind: new THREE.Vector3().fromBufferAttribute(position, stump.vertex).applyMatrix4(mesh.bindMatrix),
        normal: stump.normal.clone().transformDirection(mesh.bindMatrix),
      };
      for (let c = 0; c < 4; c++) {
        const w = weight.getComponent(stump.vertex, c);
        if (w <= 0) continue;
        point.bones.push(skeleton.bones[index.getComponent(stump.vertex, c)]);
        point.inverses.push(skeleton.boneInverses[index.getComponent(stump.vertex, c)]);
        point.weights.push(w);
      }
      const root = this.clone.scene;
      this.stopBleeding.push(
        addBleeder({
          seconds: BLEED_SECONDS,
          frame: (at, out) => {
            if (!root.parent || !mesh.visible) return false;
            skinnedFrameOf(point, at, out);
            return true;
          },
        }),
      );
    }
  }

  /** Back to the whole body: the clone's own geometry, materials and skeleton, its bones where they hung
   *  (keeping their world pose: the ragdoll's restore follows), the copies gone. */
  private restore(): void {
    for (const stop of this.stopBleeding.splice(0)) stop();
    if (this.applied.length === 0) return;
    this.clone.scene.updateWorldMatrix(true, true);
    for (const state of this.meshes) {
      if (state.mesh.geometry !== state.geometry) state.mesh.geometry.dispose();
      state.mesh.geometry = state.geometry;
      state.mesh.material = state.material;
      if (this.originalSkeleton) state.mesh.skeleton = this.originalSkeleton;
      state.weld = state.firstWeld;
    }
    for (const { bone, parent } of this.moves.splice(0).reverse()) parent.attach(bone);
    for (const dup of this.dups.splice(0)) dup.removeFromParent();
    if (this.originalSkeleton) {
      const current = this.ownSkeletons[this.ownSkeletons.length - 1];
      const at = this.clone.skeletons.indexOf(current);
      if (at >= 0) this.clone.skeletons[at] = this.originalSkeleton;
    }
    for (const skeleton of this.ownSkeletons.splice(0)) skeleton.dispose();
    this.originalSkeleton = null;
    this.welds.next = this.firstWeldCount;
    this.applied = [];
  }
}
