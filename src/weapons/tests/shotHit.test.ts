import * as THREE from "three";
import { EXIT_WOUND_SCALE } from "../constants";
import type { ShotTarget } from "../types";
import { shotHitsOf } from "../utils";

/** A unit cube skinned to one bone named "body", standing at `x`. */
const cubeAt = (x: number): THREE.SkinnedMesh => {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const count = geometry.getAttribute("position").count;
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Array(count * 4).fill(0), 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(Array.from({ length: count * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  const bone = new THREE.Bone();
  bone.name = "body";
  mesh.add(bone);
  mesh.position.x = x;
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([bone]));
  return mesh;
};

const targetOf = (id: string, mesh: THREE.SkinnedMesh): ShotTarget => ({ kind: "npc", id, origin: mesh.position, meshes: [mesh] });
const along = (x: number): THREE.Ray => new THREE.Ray(new THREE.Vector3(x, 0, -5), new THREE.Vector3(0, 0, 1));

describe("shotHitsOf", () => {
  it("holes a body where the bullet enters and where it leaves, on the bone, in its space", () => {
    const [hit] = shotHitsOf(along(0.1), 100, [targetOf("a", cubeAt(0))], 0.1);
    expect(hit.id).toBe("a");
    expect(hit.at[2]).toBeCloseTo(-0.5);
    expect(hit.wounds).toHaveLength(1);
    const { entry, exit } = hit.wounds[0];
    expect(entry).toMatchObject({ b: ["body"], w: [1], r: 0.1 });
    expect(entry.x).toBeCloseTo(0.1);
    expect(entry.z).toBeCloseTo(-0.5);
    expect(exit!.z).toBeCloseTo(0.5);
    // Outward: toward the shooter at the entry, on along the bullet at the exit.
    expect(entry.nz).toBeCloseTo(-1);
    expect(exit!.nz).toBeCloseTo(1);
    expect(exit!.r).toBeCloseTo(0.1 * EXIT_WOUND_SCALE);
  });

  it("goes through every body on the line, nearest first, and nothing past the world's first solid surface or off the line", () => {
    const near = cubeAt(0);
    const far = cubeAt(0);
    far.position.z = 3;
    far.updateMatrixWorld(true);
    expect(shotHitsOf(along(0), 100, [targetOf("far", far), targetOf("near", near)], 0.1).map((h) => h.id)).toEqual(["near", "far"]);
    expect(shotHitsOf(along(0), 6, [targetOf("far", far), targetOf("near", near)], 0.1).map((h) => h.id)).toEqual(["near"]);
    expect(shotHitsOf(along(2), 100, [targetOf("near", near)], 0.1)).toEqual([]);
  });
});
