import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils";

// Vertex-colored geometry, shared by every object that bakes its parts into one mesh (buildings, doors,
// the tunnels' fittings): colors are vertex attributes so all of a kind share ONE material.

const _color = new THREE.Color();

/** Bakes `hex` as the vertex color of every vertex and drops the uv attribute, so every part merges
 *  with the uv-less sink geometries. */
export const bakeVertexColor = (geometry: THREE.BufferGeometry, hex: number): THREE.BufferGeometry => {
  _color.set(hex);
  const count = geometry.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = _color.r;
    colors[i * 3 + 1] = _color.g;
    colors[i * 3 + 2] = _color.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.deleteAttribute("uv");
  return geometry;
};

/** mergeGeometries returns null on mismatched attributes — fail loudly instead of caching a null. */
export const mergeOrThrow = (geos: THREE.BufferGeometry[], label: string): THREE.BufferGeometry => {
  const merged = mergeGeometries(geos, false);
  if (!merged) throw new Error(`Geometry merge failed: ${label}`);
  return merged;
};
