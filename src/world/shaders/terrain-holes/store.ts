/**
 * TERRAIN OPENINGS: the per-pixel cuts the tunnels make in the ground. A hole is a manhole SHAFT (a
 * vertical cylinder, cut all the way down) or a cave mouth's FOOTPRINT (the capsule along its section,
 * only up to `capHeight` over the section's floor — the mountain above the opening stays, drawn by
 * the terrain over the entrance patch's same ground — cut by the entrance's screen-door share, whose
 * complement the entrance patch draws). A SKIRT pixel standing SKIRT_MASK_COVER under its own ground
 * inside a SKIRT MASK (a capsule over a run of tunnel) — or anywhere, while the camera is underground —
 * is discarded too: it can only be seen from inside the tunnel, and from outside the ground hides it;
 * a skirt pixel nearer its ground is the LOD-border gap's cover and stays (masks reaching the surface
 * cut dashes out of the skirts along every tunnel). Shared uniform OBJECTS: every terrain variant
 * reads the same set; only chunks touching a hole or mask compile the discard in
 * (world/terrain/material.ts).
 */
import type { TerrainHole, TunnelMask } from "./types";
import { TERRAIN_HOLE_UNIFORMS } from "./material";
import { MAX_TERRAIN_HOLES, MAX_TUNNEL_MASKS } from "./constants";

let holes: TerrainHole[] = [];
let masks: TunnelMask[] = [];
let version = 0;
let membership = "";
let cameraUnderground = false;

/** Bumped when the SET of holes or masks changes (a share moving does not): the chunks re-pick their variant. */
export const terrainHolesVersion = (): number => version;

export const setCameraUnderground = (underground: boolean): void => {
  if (underground === cameraUnderground) return;
  cameraUnderground = underground;
  TERRAIN_HOLE_UNIFORMS.uTunnelNoSkirts.value = underground ? 1 : 0;
};

export const isCameraUnderground = (): boolean => cameraUnderground;

/** The cut set, at most MAX_TERRAIN_HOLES and MAX_TUNNEL_MASKS (the caller orders them nearest first). */
export const setTerrainHoles = (nextHoles: readonly TerrainHole[], nextMasks: readonly TunnelMask[]): void => {
  holes = nextHoles.slice(0, MAX_TERRAIN_HOLES);
  masks = nextMasks.slice(0, MAX_TUNNEL_MASKS);
  const h = TERRAIN_HOLE_UNIFORMS.uTerrainHoles.value;
  holes.forEach((hole, i) => {
    const o = i * 12;
    h[o] = hole.ax;
    h[o + 1] = hole.ay;
    h[o + 2] = hole.az;
    h[o + 3] = hole.radius;
    h[o + 4] = hole.bx;
    h[o + 5] = hole.by;
    h[o + 6] = hole.bz;
    h[o + 7] = hole.share;
    h[o + 8] = hole.kind === "shaft" ? 1 : 0;
    h[o + 9] = hole.capHeight;
    h[o + 10] = hole.band;
    h[o + 11] = hole.lightY;
  });
  TERRAIN_HOLE_UNIFORMS.uTerrainHoleCount.value = holes.length;
  const m = TERRAIN_HOLE_UNIFORMS.uTunnelMasks.value;
  masks.forEach((mask, i) => {
    const o = i * 8;
    m[o] = mask.ax;
    m[o + 1] = mask.ay;
    m[o + 2] = mask.az;
    m[o + 3] = mask.radius;
    m[o + 4] = mask.bx;
    m[o + 5] = mask.by;
    m[o + 6] = mask.bz;
    m[o + 7] = mask.ceiling;
  });
  TERRAIN_HOLE_UNIFORMS.uTunnelMaskCount.value = masks.length;
  const key = holes.map((x) => x.id).join("|") + "#" + masks.map((x) => `${x.ax},${x.az},${x.bx},${x.bz}`).join("|");
  if (key !== membership) {
    membership = key;
    version++;
  }
};

/** Whether any hole or mask touches a square of the ground (by their horizontal extents). */
export const squareTouchesTerrainHoles = (minX: number, minZ: number, maxX: number, maxZ: number): boolean => {
  for (const h of holes) {
    if (Math.min(h.ax, h.bx) - h.radius <= maxX && Math.max(h.ax, h.bx) + h.radius >= minX && Math.min(h.az, h.bz) - h.radius <= maxZ && Math.max(h.az, h.bz) + h.radius >= minZ) return true;
  }
  for (const m of masks) {
    if (Math.min(m.ax, m.bx) - m.radius <= maxX && Math.max(m.ax, m.bx) + m.radius >= minX && Math.min(m.az, m.bz) - m.radius <= maxZ && Math.max(m.az, m.bz) + m.radius >= minZ) return true;
  }
  return false;
};
