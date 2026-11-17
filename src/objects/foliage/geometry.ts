import * as THREE from "three";
import { _spawnFade } from "../../vfx/spawn-fade";
import { FOLIAGE_CHUNK_SIZE } from "./constants";
import { FoliageChunkResult } from "./worker";

const bladeQuads: { near: THREE.PlaneGeometry | null; low: THREE.PlaneGeometry | null } = { near: null, low: null };

/** The blade quad: 3 segments near (the wind bend curves), 1 far (foliageLod.ts BLADE_DETAIL_DISTANCE).
 *  Shared by every chunk of every field; never disposed. */
const bladeQuad = (low: boolean): THREE.PlaneGeometry => {
  const key = low ? "low" : "near";
  let quad = bladeQuads[key];
  if (!quad) {
    quad = new THREE.PlaneGeometry(1, 1, 1, low ? 1 : 3);
    quad.translate(0, 0.5, 0);
    bladeQuads[key] = quad;
  }
  return quad;
};

export const applyBladeDetail = (geo: THREE.BufferGeometry, low: boolean): void => {
  const base = bladeQuad(low);
  geo.setIndex(base.getIndex());
  geo.setAttribute("position", base.getAttribute("position"));
  geo.setAttribute("uv", base.getAttribute("uv"));
};

/** geometry.dispose() frees every ATTACHED attribute's GL buffer — detach the shared quad first. */
export const disposeChunkGeometry = (geo: THREE.BufferGeometry): void => {
  geo.deleteAttribute("position");
  geo.deleteAttribute("uv");
  geo.setIndex(null);
  geo.dispose();
};

export const removeChunkMesh = (group: THREE.Group | null, fades: _spawnFade.SpawnFadeSet, mesh: THREE.Mesh): void => {
  group?.remove(mesh);
  fades.delete(mesh);
  disposeChunkGeometry(mesh.geometry);
};

/** A chunk's instanced blades from a worker result, drawing `drawFraction` of its total; the culling
 *  sphere is in the mesh's own chunk-origin frame. */
export const buildChunkGeometry = (
  result: FoliageChunkResult,
  lowDetail: boolean,
  drawFraction: number,
  bladeHeight: number,
  sway: number,
): THREE.InstancedBufferGeometry => {
  const geo = new THREE.InstancedBufferGeometry();
  applyBladeDetail(geo, lowDetail);
  geo.setAttribute("offset", new THREE.InstancedBufferAttribute(result.offsets, 3));
  geo.setAttribute("instanceData", new THREE.InstancedBufferAttribute(result.instanceData, 3));
  geo.instanceCount = Math.min(result.count, Math.ceil(result.total * drawFraction));

  const half = FOLIAGE_CHUNK_SIZE / 2;
  const centerY = (result.minY + result.maxY + bladeHeight) / 2;
  const radiusY = (result.maxY - result.minY) / 2 + bladeHeight + Math.abs(sway) + 1;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(half, centerY, half), Math.sqrt(half * half * 2 + radiusY * radiusY));
  return geo;
};
