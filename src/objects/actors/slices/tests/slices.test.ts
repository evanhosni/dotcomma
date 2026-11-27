import * as THREE from "three";
import type { Cut } from "../../../../net/protocol/types";
import { sliceMesh, weldOf } from "../geometry";
import { SliceSet } from "../SliceSet";

/** A 1×2×1 bar (seams split, as a real mesh's are), its lower half skinned to bone 0, its upper to bone 1. */
const barGeometry = (): THREE.BufferGeometry => {
  const geometry = new THREE.BoxGeometry(1, 2, 1, 1, 4, 1);
  const position = geometry.getAttribute("position");
  const index: number[] = [];
  const weight: number[] = [];
  for (let i = 0; i < position.count; i++) {
    index.push(position.getY(i) < 0 ? 0 : 1, 0, 0, 0);
    weight.push(1, 0, 0, 0);
  }
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(index, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weight, 4));
  return geometry;
};

const across = (y: number, bone = "*"): Cut => ({ p: [{ b: bone, nx: 0, ny: 1, nz: 0, d: y }] });

describe("sliceMesh", () => {
  it("parts a body across its plane: two pieces, each side's own vertices, each capped with flesh", () => {
    const geometry = barGeometry();
    const weld = weldOf(geometry);
    const welds = { next: Math.max(...weld) + 1 };
    const result = sliceMesh({ geometry, bindMatrix: new THREE.Matrix4(), boneNames: ["lower", "upper"], weld }, across(0.3), welds)!;
    expect(result.pieceCount).toBe(2);
    expect(result.stumps).toHaveLength(2);
    const position = result.geometry.getAttribute("position");
    const above = new Set<number>();
    const below = new Set<number>();
    for (let v = 0; v < position.count; v++) {
      if (result.piece[v] < 0) continue;
      (position.getY(v) > 0.3 + 1e-6 ? above : position.getY(v) < 0.3 - 1e-6 ? below : null)?.add(result.piece[v]);
    }
    expect(above.size).toBe(1);
    expect(below.size).toBe(1);
    expect([...above][0]).not.toBe([...below][0]);
    // The flesh: group 1, after the skin.
    expect(result.geometry.groups).toHaveLength(2);
    expect(result.geometry.groups[1].count).toBeGreaterThan(0);
    expect(result.geometry.userData.fleshStart).toBe(result.geometry.groups[0].count);
  });

  it("names a bone: only its vertices (and the ring around them) are cut", () => {
    const geometry = barGeometry();
    const weld = weldOf(geometry);
    const welds = { next: Math.max(...weld) + 1 };
    expect(sliceMesh({ geometry, bindMatrix: new THREE.Matrix4(), boneNames: ["lower", "upper"], weld }, across(0.6, "lower"), welds)).toBeNull();
    expect(sliceMesh({ geometry, bindMatrix: new THREE.Matrix4(), boneNames: ["lower", "upper"], weld }, across(0.6, "upper"), welds)!.pieceCount).toBe(2);
  });

  it("crosses nothing: null", () => {
    const geometry = barGeometry();
    const weld = weldOf(geometry);
    expect(sliceMesh({ geometry, bindMatrix: new THREE.Matrix4(), boneNames: ["lower", "upper"], weld }, across(5), { next: 1000 })).toBeNull();
  });
});

describe("SliceSet", () => {
  /** root → armature → lower → upper, the bar skinned to them. */
  const body = () => {
    const root = new THREE.Group();
    const armature = new THREE.Object3D();
    const lower = new THREE.Bone();
    lower.name = "lower";
    const upper = new THREE.Bone();
    upper.name = "upper";
    upper.position.y = 0;
    lower.add(upper);
    armature.add(lower);
    const mesh = new THREE.SkinnedMesh(barGeometry(), new THREE.MeshStandardMaterial());
    armature.add(mesh);
    root.add(armature);
    root.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton([lower, upper]);
    mesh.bind(skeleton);
    const skeletons: THREE.Skeleton[] = [skeleton];
    return { root, armature, lower, upper, mesh, skeleton, skeletons, slices: new SliceSet({ scene: root, skeletons, quantization: undefined }) };
  };

  it("parts the skeleton where the cut parts the body, and puts everything back", () => {
    const b = body();
    const original = b.mesh.geometry;
    expect(b.slices.set([across(0.3)], null, false)).toBe(true);
    // The upper piece owns "upper": parted from "lower" (the lower piece's), under the armature.
    expect(b.upper.parent).toBe(b.armature);
    // The lower piece leans on "upper" between 0 and the cut: a copy of its own, under "lower".
    const copy = b.lower.children.find((c) => c.name.startsWith("upper~"));
    expect(copy).toBeDefined();
    expect(b.mesh.skeleton.bones).toHaveLength(3);
    expect(b.skeletons[0]).toBe(b.mesh.skeleton);
    expect(Array.isArray(b.mesh.material)).toBe(true);
    expect(b.slices.set([across(0.3)], null, false)).toBe(false);

    b.slices.dispose();
    expect(b.upper.parent).toBe(b.lower);
    expect(b.lower.children.some((c) => c.name.startsWith("upper~"))).toBe(false);
    expect(b.mesh.geometry).toBe(original);
    expect(b.mesh.skeleton).toBe(b.skeleton);
    expect(b.skeletons[0]).toBe(b.skeleton);
  });

  it("bursts a body into chunks by its id, the same way every time", () => {
    const pieces = (seed: string) => {
      const b = body();
      b.slices.set([], seed, false);
      return b.mesh.skeleton.bones.map((bone) => bone.name).join(",");
    };
    expect(pieces("npc-1")).toBe(pieces("npc-1"));
    const b = body();
    b.slices.set([], "npc-1", false);
    expect(b.mesh.geometry.groups[1].count).toBeGreaterThan(0);
  });
});
