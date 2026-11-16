import * as THREE from "three";
import { uploadOnFirstDraw } from "../../../utils/uploadOnFirstDraw";
import type { RockPoint } from "../../../utils/workers/vertexCompute";
import type { ChunkBounds } from "../types";
import { ROCK_SHAPES } from "./shapes";

const _euler = new THREE.Euler();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

/** Every rock of the chunk baked into one flat-shaded geometry relative to the chunk's middle. */
export const buildRockMesh = (rocks: RockPoint[], bounds: ChunkBounds, material: THREE.Material): THREE.Mesh => {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  let triangles = 0;
  for (const r of rocks) triangles += ROCK_SHAPES[r.variant].indices.length / 3;
  const positions = new Float32Array(triangles * 9);
  const normals = new Float32Array(triangles * 9);
  const shades = new Float32Array(triangles * 3);
  const snows = new Float32Array(triangles * 3);
  let o = 0;
  for (const r of rocks) {
    const shape = ROCK_SHAPES[r.variant];
    _m.makeRotationFromEuler(_euler.set(0, r.yaw, r.pitch));
    const p = shape.positions;
    const idx = shape.indices;
    for (let t = 0; t < idx.length; t += 3) {
      const base = o;
      for (let k = 0; k < 3; k++) {
        const i = idx[t + k] * 3;
        _v.set(p[i] * r.sx, p[i + 1] * r.sy, p[i + 2] * r.sz).applyMatrix4(_m);
        positions[o * 3] = _v.x + r.x - cx;
        positions[o * 3 + 1] = _v.y + r.y;
        positions[o * 3 + 2] = _v.z + r.z - cz;
        shades[o] = r.shade;
        snows[o] = r.snow;
        o++;
      }
      const ax = positions[base * 3], ay = positions[base * 3 + 1], az = positions[base * 3 + 2];
      const bx = positions[base * 3 + 3], by = positions[base * 3 + 4], bz = positions[base * 3 + 5];
      const cxx = positions[base * 3 + 6], cy = positions[base * 3 + 7], czz = positions[base * 3 + 8];
      _n.set((by - ay) * (czz - az) - (bz - az) * (cy - ay), (bz - az) * (cxx - ax) - (bx - ax) * (czz - az), (bx - ax) * (cy - ay) - (by - ay) * (cxx - ax)).normalize();
      for (let k = 0; k < 3; k++) {
        normals[(base + k) * 3] = _n.x;
        normals[(base + k) * 3 + 1] = _n.y;
        normals[(base + k) * 3 + 2] = _n.z;
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("shade", new THREE.BufferAttribute(shades, 1));
  geometry.setAttribute("snow", new THREE.BufferAttribute(snows, 1));
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(cx, 0, cz);
  mesh.userData.ownsGeometry = true;
  uploadOnFirstDraw(mesh);
  return mesh;
};
