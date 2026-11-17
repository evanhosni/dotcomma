import * as THREE from "three";

/** A chunk's OWN geometry object over the feature's shared attributes and index (the same GL buffers).
 *  three keys a vertex array object by (geometry, program) and re-points every attribute of an
 *  InstancedMesh whose instanceMatrix differs from the last draw through that VAO: chunks sharing ONE
 *  geometry re-ran setupVertexAttributes on every draw (MEASURED in the city: ~113 vertexAttribPointer +
 *  bindBuffer calls a frame for 19 instanced draws). Released with the chunk (disposeChunkObject). */
export const chunkGeometryView = (shared: THREE.BufferGeometry): THREE.BufferGeometry => {
  if (shared.userData.chunkView) return shared;
  const view = new THREE.BufferGeometry();
  view.index = shared.index;
  for (const name of Object.keys(shared.attributes)) view.setAttribute(name, shared.attributes[name]);
  view.morphAttributes = shared.morphAttributes;
  view.morphTargetsRelative = shared.morphTargetsRelative;
  for (const g of shared.groups) view.addGroup(g.start, g.count, g.materialIndex);
  view.setDrawRange(shared.drawRange.start, shared.drawRange.count);
  view.userData.chunkView = true;
  return view;
};

/** Frees only the view's own VAO: a plain dispose() would delete the SHARED attribute buffers too. */
const releaseChunkGeometryView = (geometry: THREE.BufferGeometry): void => {
  if (!geometry.userData.chunkView) return;
  geometry.index = null;
  geometry.attributes = {};
  geometry.morphAttributes = {};
  geometry.dispose();
};

/** Instance buffers only — shared geometries/materials belong to the system that owns them. */
export const disposeChunkObject = (object: THREE.Object3D): void => {
  object.traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh) {
      (o as THREE.InstancedMesh).dispose();
      releaseChunkGeometryView((o as THREE.InstancedMesh).geometry);
    }
    // A per-chunk merged mesh (the bridge ribbons) marks itself the owner of its geometry.
    else if ((o as THREE.Mesh).isMesh && o.userData.ownsGeometry) (o as THREE.Mesh).geometry.dispose();
  });
};
