import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils";
import type { MergedSkinnedPart } from "./types";
import { ANIMATED_BOUNDS_INFLATE } from "../state/constants";

// Skinned siblings differing only in their triangles (skeleton, bind, material, node transform,
// attribute + morph layout all equal) are ONE draw: beeble.glb's 10 meshes on 3 materials would be 10
// skinned draws per beeble — 18% of the city's draw calls (merged: +5.7% fps). Merged
// geometry is shared by every clone, like the GLTF's own (never disposed).
const mergedSkinnedGeometries = new Map<string, THREE.BufferGeometry>();

const skinnedMergeKey = (m: THREE.SkinnedMesh): string => {
  const g = m.geometry;
  return [
    m.parent?.uuid,
    m.skeleton.uuid,
    (m.material as THREE.Material).uuid,
    m.position.toArray().join(","),
    m.quaternion.toArray().join(","),
    m.scale.toArray().join(","),
    m.bindMatrix.elements.join(","),
    m.userData.skipQuantization ? 1 : 0, // the rest of userData is GLTF extras (names)
    Object.keys(g.attributes).sort().map((k) => `${k}:${g.attributes[k].itemSize}`).join(","),
    Object.keys(g.morphAttributes).sort().map((k) => `${k}:${g.morphAttributes[k].length}`).join(","),
    g.morphTargetsRelative,
    g.index ? 1 : 0,
    JSON.stringify(m.morphTargetDictionary ?? null),
    (m.morphTargetInfluences ?? []).join(","),
  ].join("|");
};

const mergedGeometryOf = (members: THREE.SkinnedMesh[]): THREE.BufferGeometry | null => {
  const cacheKey = members.map((m) => m.geometry.uuid).join("+");
  const cached = mergedSkinnedGeometries.get(cacheKey);
  if (cached) return cached;
  const merged = mergeGeometries(members.map((m) => m.geometry), false);
  if (!merged) return null;
  const parts: MergedSkinnedPart[] = [];
  let start = 0;
  for (const m of members) {
    const probe = m.geometry.clone(); // the source geometry's cached bounds stay untouched
    probe.computeBoundingSphere();
    const s = probe.boundingSphere!;
    const count = m.geometry.getAttribute("position").count;
    parts.push({ start, count, center: [s.center.x, s.center.y, s.center.z], radius: s.radius });
    start += count;
  }
  merged.userData.mergedSkinnedParts = parts;
  mergedSkinnedGeometries.set(cacheKey, merged);
  return merged;
};

/** Largest member first (the mouse raycast tests triangles in index order, largest mesh first). */
export const mergeSkinnedSiblings = (skinned: THREE.SkinnedMesh[]): THREE.SkinnedMesh[] => {
  const groups = new Map<string, THREE.SkinnedMesh[]>();
  for (const m of skinned) {
    if (!m.skeleton || Array.isArray(m.material)) continue;
    const key = skinnedMergeKey(m);
    const list = groups.get(key);
    if (list) list.push(m);
    else groups.set(key, [m]);
  }
  const result: THREE.SkinnedMesh[] = [];
  for (const m of skinned) if (!m.skeleton || Array.isArray(m.material)) result.push(m);
  groups.forEach((members) => {
    if (members.length === 1) {
      result.push(members[0]);
      return;
    }
    const sorted = [...members].sort((a, b) => (b.geometry.index?.count ?? 0) - (a.geometry.index?.count ?? 0));
    const geometry = mergedGeometryOf(sorted);
    if (!geometry) {
      result.push(...members);
      return;
    }
    const first = sorted[0];
    const merged = new THREE.SkinnedMesh(geometry, first.material);
    merged.name = first.name;
    merged.userData = { ...first.userData };
    merged.position.copy(first.position);
    merged.quaternion.copy(first.quaternion);
    merged.scale.copy(first.scale);
    merged.updateMatrix();
    if (first.morphTargetDictionary) merged.morphTargetDictionary = { ...first.morphTargetDictionary };
    if (first.morphTargetInfluences) merged.morphTargetInfluences = [...first.morphTargetInfluences];
    merged.bind(first.skeleton, first.bindMatrix);
    const parent = first.parent!;
    for (const m of members) parent.remove(m);
    parent.add(merged);
    result.push(merged);
  });
  return result;
};

// ─── picking: the crosshair against a posed model (an NPC's, a remote player's) ───

const _worldSphere = new THREE.Sphere();
const _invMatrix = new THREE.Matrix4();
const _localRay = new THREE.Ray();
const _tA = new THREE.Vector3();
const _tB = new THREE.Vector3();
const _tC = new THREE.Vector3();
const _hitPt = new THREE.Vector3();

/** Largest-first so the body mesh (most likely hit) is tested before tiny face meshes. */
export const collectSkinnedMeshes = (group: THREE.Group, out: THREE.SkinnedMesh[]): void => {
  group.traverse((child) => {
    if ((child as THREE.SkinnedMesh).isSkinnedMesh) out.push(child as THREE.SkinnedMesh);
  });
  out.sort((a, b) => (b.geometry.index?.count ?? 0) - (a.geometry.index?.count ?? 0));
};

/** Ray distance to the first triangle hit, testing meshes until one is hit within `reach`; Infinity if none.
 *  Manual ray-triangle test: three's intersectObject silently drops valid hits for SkinnedMeshes mounted
 *  after the initial batch (cause unknown — geometry, bones and matrices are all correct). Same data,
 *  reliable hits. */
export const rayHitDistance = (ray: THREE.Ray, meshes: THREE.SkinnedMesh[], reach: number): number => {
  let hitDist = Infinity;
  for (let m = 0; m < meshes.length && hitDist > reach; m++) {
    const mesh = meshes[m];
    const geo = mesh.geometry;
    if (!geo.index) continue;

    if (!geo.boundingSphere) geo.computeBoundingSphere();
    _worldSphere.copy(geo.boundingSphere!).applyMatrix4(mesh.matrixWorld);
    _worldSphere.radius *= ANIMATED_BOUNDS_INFLATE;
    if (!ray.intersectsSphere(_worldSphere)) continue;

    _invMatrix.copy(mesh.matrixWorld).invert();
    _localRay.copy(ray).applyMatrix4(_invMatrix);

    const idx = geo.index;
    for (let i = 0, l = idx.count; i < l; i += 3) {
      mesh.getVertexPosition(idx.getX(i), _tA);
      mesh.getVertexPosition(idx.getX(i + 1), _tB);
      mesh.getVertexPosition(idx.getX(i + 2), _tC);
      if (_localRay.intersectTriangle(_tA, _tB, _tC, false, _hitPt)) {
        _hitPt.applyMatrix4(mesh.matrixWorld);
        hitDist = ray.origin.distanceTo(_hitPt);
        break;
      }
    }
  }
  return hitDist;
};
