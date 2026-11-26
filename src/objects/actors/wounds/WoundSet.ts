import * as THREE from "three";
import type { Wound, WoundHole } from "../../../net/protocol/types";
import { ATTACHMENT_FLAG } from "../model/store";
import { MAX_WOUNDS } from "./constants";
import { woundRimGeometry, woundTunnelGeometry } from "./geometry";
import { woundTunnelMaterial, woundUniformsOf } from "./material";
import type { WoundUniforms } from "./material";

/** A hole as drawn: its bind-space point and normal, and the bones (with their bind inverses) that move it,
 *  by weight. */
interface PlacedHole {
  bones: THREE.Bone[];
  inverses: THREE.Matrix4[];
  weights: number[];
  bind: THREE.Vector3;
  /** The skin's outward normal at the hole. */
  normal: THREE.Vector3;
  radius: number;
}

/** "No wounds", one array: set() is called every frame, and a fresh [] each time would rebuild every time. */
const NONE: readonly Wound[] = [];
/** A bullet that stayed in leaves a closed pocket this deep (in hole radii) instead of a way through. */
const POCKET_DEPTH = 3.5;

const _point = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _exit = new THREE.Vector3();
const _along = new THREE.Vector3();
const _turn = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _blend = new THREE.Matrix4();
const _part = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

/** The hole's skinning now: Σ weight · bone · bind⁻¹, as the surface around it is skinned (the root-relative
 *  skinning, model/RootRelativeSkeleton.ts, draws the same world points). */
const blendOf = (hole: PlacedHole): THREE.Matrix4 => {
  _blend.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  for (let i = 0; i < hole.bones.length; i++) {
    _part.multiplyMatrices(hole.bones[i].matrixWorld, hole.inverses[i]);
    for (let e = 0; e < 16; e++) _blend.elements[e] += _part.elements[e] * hole.weights[i];
  }
  return _blend;
};

const worldPointOf = (hole: PlacedHole, out: THREE.Vector3): THREE.Vector3 => out.copy(hole.bind).applyMatrix4(blendOf(hole));

/** Where a hole is now, and which way its skin faces there. */
const worldFrameOf = (hole: PlacedHole, point: THREE.Vector3, normal: THREE.Vector3): void => {
  const blend = blendOf(hole);
  point.copy(hole.bind).applyMatrix4(blend);
  normal.copy(hole.normal).transformDirection(blend);
};

/** A mesh's world matrix: at `at`, its +y along the unit `direction`, scaled (sx, sy, sx). */
const standAlong = (mesh: THREE.Object3D, at: THREE.Vector3, direction: THREE.Vector3, sx: number, sy: number): void => {
  _turn.setFromUnitVectors(UP, direction);
  mesh.matrixWorld.compose(at, _turn, _scale.set(sx, sy, sx));
};

/**
 * The bullet wounds of ONE model clone (an NPC's, a player's body, a corpse). Each wound is a channel
 * (net/protocol/types.ts Wound): an entry and an exit hole, each skinned as the surface under it, so they stay
 * on the skin through every pose, bend and fall. Before each draw of the clone's skinned meshes the holes'
 * centres are written into its materials' uniforms in the camera's view space (wounds/material.ts cuts them
 * out there). Its FLESH: a TUNNEL from each entry to its exit (a closed pocket when the bullet stayed in), so a
 * look into a hole shows the bullet's way and never the inside of the mesh, and a RIM of torn flesh on every
 * hole, laid along the skin, over the seam between the cut skin and the tunnel's mouth. Each piece is placed
 * in the world right before it draws. A clone is pooled: `dispose` before it goes back.
 */
export class WoundSet {
  private holes: PlacedHole[] = [];
  /** The tunnels and rims, rebuilt when the wounds change. */
  private flesh: THREE.Mesh[] = [];
  private source: readonly Wound[] = [];
  private readonly uniforms: WoundUniforms[];
  private readonly meshes: THREE.Mesh[] = [];
  private skeleton: THREE.Skeleton | null = null;
  private readonly writeForCamera = (_r: unknown, _s: unknown, camera: THREE.Camera): void => this.write(camera);

  constructor(private readonly root: THREE.Object3D, materials: readonly THREE.Material[]) {
    this.uniforms = materials.map(woundUniformsOf).filter((u): u is WoundUniforms => u !== undefined);
    root.traverse((node) => {
      const mesh = node as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      this.meshes.push(mesh);
      // One skeleton per clone (model/store.ts dedupes them by source).
      this.skeleton ??= mesh.skeleton;
    });
  }

  /** The wounds to draw; an unchanged list (the same array) costs nothing. */
  set(wounds: readonly Wound[] | undefined): void {
    const next = wounds && wounds.length > 0 ? wounds : NONE;
    if (next === this.source) return;
    this.source = next;
    this.clearFlesh();
    this.holes = [];
    next.slice(-MAX_WOUNDS).forEach((wound, i) => {
      const seed = next.length - i;
      const entry = this.place(wound.entry);
      if (!entry) return;
      const exit = wound.exit && this.place(wound.exit);
      this.addTunnel(entry, exit, seed);
      this.addRim(entry, seed * 2);
      if (exit) this.addRim(exit, seed * 2 + 1);
    });
    for (const u of this.uniforms) u.uHoleCount.value = this.holes.length;
    for (const mesh of this.meshes) mesh.onBeforeRender = this.holes.length > 0 ? this.writeForCamera : THREE.Object3D.prototype.onBeforeRender;
  }

  dispose(): void {
    this.set(NONE);
  }

  private place(hole: WoundHole): PlacedHole | null {
    const skeleton = this.skeleton;
    if (!skeleton) return null;
    const normal = new THREE.Vector3(hole.nx, hole.ny, hole.nz).normalize();
    const placed: PlacedHole = { bones: [], inverses: [], weights: [], bind: new THREE.Vector3(hole.x, hole.y, hole.z), normal, radius: hole.r };
    hole.b.forEach((name, i) => {
      const at = skeleton.bones.findIndex((bone) => bone.name === name);
      if (at < 0) return;
      placed.bones.push(skeleton.bones[at]);
      placed.inverses.push(skeleton.boneInverses[at]);
      placed.weights.push(hole.w[i]);
    });
    if (placed.bones.length === 0) return null;
    this.holes.push(placed);
    return placed;
  }

  /** A piece of flesh on the clone, put in the world by `place` right before it draws: its matrices are its
   *  own, since the holes move with the skin, not with any one node (three takes the model-view matrix after
   *  onBeforeRender). */
  private addFlesh(geometry: THREE.BufferGeometry, place: (mesh: THREE.Mesh) => void): void {
    const mesh = new THREE.Mesh(geometry, woundTunnelMaterial());
    mesh.userData[ATTACHMENT_FLAG] = true;
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.onBeforeRender = () => place(mesh);
    this.root.add(mesh);
    this.flesh.push(mesh);
  }

  /** The tunnel from `entry` to `exit`, or, with no exit, a pocket closing POCKET_DEPTH radii into the body. */
  private addTunnel(entry: PlacedHole, exit: PlacedHole | null, seed: number): void {
    this.addFlesh(woundTunnelGeometry(entry.radius, exit ? exit.radius : 0, seed), (mesh) => {
      worldFrameOf(entry, _point, _normal);
      if (exit) _along.subVectors(worldPointOf(exit, _exit), _point);
      else _along.copy(_normal).multiplyScalar(-entry.radius * POCKET_DEPTH);
      const length = _along.length();
      standAlong(mesh, _point, length > 0 ? _along.divideScalar(length) : _normal, 1, length);
    });
  }

  /** The hole's rim, along its skin. */
  private addRim(hole: PlacedHole, seed: number): void {
    this.addFlesh(woundRimGeometry(seed), (mesh) => {
      worldFrameOf(hole, _point, _normal);
      standAlong(mesh, _point, _normal, hole.radius, hole.radius);
    });
  }

  private clearFlesh(): void {
    for (const mesh of this.flesh) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    this.flesh = [];
  }

  private write(camera: THREE.Camera): void {
    for (let i = 0; i < this.holes.length; i++) {
      const hole = this.holes[i];
      worldPointOf(hole, _point).applyMatrix4(camera.matrixWorldInverse);
      for (const u of this.uniforms) u.uHoles.value[i].set(_point.x, _point.y, _point.z, hole.radius);
    }
  }
}
