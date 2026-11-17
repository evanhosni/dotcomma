import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils";
import type { MergedSkinnedPart } from "./types";

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
