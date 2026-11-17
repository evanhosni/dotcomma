import type { RootState } from "@react-three/fiber";
import { smoothstep } from "../../utils/math";
import { DAYLIGHT_MANHOLE_FAR, DAYLIGHT_MANHOLE_NEAR, DAYLIGHT_MOUTH_FAR, DAYLIGHT_MOUTH_NEAR, FOOTPRINT_BAND } from "../../generation/underground/constants";
import { SHAFT_HOLE_INSET } from "../../generation/underground/sewers/constants";
import { mouthCutCeiling, mouthFootprintCells, mouthFootprintRadius, mouthLightY } from "../../generation/underground/field";
import { TunnelSpace } from "../../generation/underground/field/TunnelSpace";
import type { MouthPiece, SkirtMask, UndergroundChunk } from "../../generation/underground/types";
import { LOD_FADE_SECONDS } from "../terrain/lod-swaps/constants";
import { lod1ShareAt } from "../terrain/store";
import { setLod1Sites } from "../terrain/lod";
import { MAX_TERRAIN_HOLES, MAX_TUNNEL_MASKS } from "../shaders/terrain-holes/constants";
import { setTerrainHoles } from "../shaders/terrain-holes/store";
import { type TerrainHole, type TunnelMask } from "../shaders/terrain-holes/types";
import { WORLD_CHUNK_SIZE } from "../chunks/constants";
import { isOpen, onToggle } from "./store";

/**
 * THE UNDERGROUND REGISTRY (main thread): every loaded tunnel chunk in THE player's TunnelSpace
 * (generation/underground/field/TunnelSpace.ts: the probe, the floor, the manhole columns, the liquid —
 * the same answers the server's NPCs move by), plus the client's own: the skirt masks, the mouths, and
 * the ONE per-frame driver every mounted tunnel feature calls (it runs once per frame whoever calls
 * first): the terrain's openings, the LOD1 sites and the entrance fades.
 */

/** The cut set is re-picked every so many frames, or at once when the loaded set or a fade changed. */
const HOLE_PICK_INTERVAL = 10;
/** Skirt masks are handed to the terrain within this of the camera. */
const MASK_REACH = 600;
/** An entrance fade moves at most one LOD fade per LOD fade: never faster than the swap under it. */
const FADE_RATE = 1 / LOD_FADE_SECONDS;

/** A mouth whose footprint reaches a loaded chunk: its entrance can show. */
interface MouthRecord {
  piece: MouthPiece;
  /** Every streaming chunk ("minX,minZ") its footprint spans. */
  cells: string[];
  /** Every one of them loaded: a LOD1 site (driveSites). */
  sited: boolean;
}

export const playerTunnels = new TunnelSpace(isOpen);
const chunks = new Set<UndergroundChunk>();
let masks: SkirtMask[] = [];
let mouths = new Map<string, MouthRecord>();
/** Every mouth of the loaded chunks' systems: each lights the tunnels around it. */
let lightMouths: MouthPiece[] = [];
/** The streaming chunk keys ("minX,minZ") loaded, of any style. */
const loadedCells = new Set<string>();
let version = 0;
const fades = new Map<string, number>();
let lod1SiteKey = "";
let sitesVersion = -1;
let frame = 0;
let lastDrivenTime = -1;
let lastPickVersion = -1;
let lastPickFrame = -Infinity;
let fadesMoved = false;

/** The streaming chunk key of a tunnel chunk ("minX,minZ"). */
const cellKeyOfChunk = (chunk: UndergroundChunk): string => `${chunk.centerX - WORLD_CHUNK_SIZE / 2},${chunk.centerZ - WORLD_CHUNK_SIZE / 2}`;

/** Rebuilds the client's merged sets (masks, mouths) after the loaded set changed. */
const rebuild = (): void => {
  const nextMouths = new Map<string, MouthRecord>();
  const lights = new Map<string, MouthPiece>();
  const maskKeys = new Set<string>();
  const nextMasks: SkirtMask[] = [];
  for (const c of chunks) {
    for (const m of c.masks) {
      const k = `${m.ax},${m.az},${m.bx},${m.bz}`;
      if (maskKeys.has(k)) continue;
      maskKeys.add(k);
      nextMasks.push(m);
    }
    const cell = cellKeyOfChunk(c);
    for (const m of c.mouths) {
      if (!lights.has(m.id)) lights.set(m.id, m);
      if (nextMouths.has(m.id)) continue;
      const cells = mouthFootprintCells(m);
      if (cells.includes(cell)) nextMouths.set(m.id, { piece: m, cells, sited: false });
    }
  }
  masks = nextMasks;
  mouths = nextMouths;
  lightMouths = Array.from(lights.values());
  version++;
};

/** Whether the streaming chunk ("minX,minZ") is loaded, of any style: what a border cap draws against. */
export const isCellLoaded = (key: string): boolean => loadedCells.has(key);

export const registerChunk = (chunk: UndergroundChunk): void => {
  chunks.add(chunk);
  playerTunnels.add(chunk);
  loadedCells.add(cellKeyOfChunk(chunk));
  rebuild();
};

export const unregisterChunk = (chunk: UndergroundChunk): void => {
  if (!chunks.delete(chunk)) return;
  playerTunnels.remove(chunk);
  loadedCells.delete(cellKeyOfChunk(chunk));
  rebuild();
  // The last chunk unloading (a domain switch) clears everything the terrain was told.
  if (chunks.size === 0) {
    fades.clear();
    setTerrainHoles([], []);
    setLod1Sites([]);
    lod1SiteKey = "";
  }
};

/** A toggle changes a closed manhole's shaft top for the probe: the compiled fields are stale. */
onToggle(() => playerTunnels.invalidateFields());

/** The daylight reaching a point in a tunnel from the loaded openings — the mesher's rule for its
 *  vertices (generation/underground/chunks/utils.ts daylightAt) without the ground term: full within a mouth's or a
 *  manhole's near reach of its light point, gone by its far one. What the player's personal light judges
 *  the dark by. 1 when nothing is loaded (above ground, as far as the tunnels know). */
export const entranceDaylightAt = (x: number, y: number, z: number): number => {
  if (chunks.size === 0) return 1;
  let light = 0;
  const add = (lx: number, ly: number, lz: number, near: number, far: number): void => {
    if (Math.abs(lx - x) > far || Math.abs(lz - z) > far || Math.abs(ly - y) > far) return;
    const v = 1 - smoothstep(near, far, Math.hypot(lx - x, ly - y, lz - z));
    if (v > light) light = v;
  };
  for (const e of playerTunnels.entrances.values()) add(e.x, e.y, e.z, DAYLIGHT_MANHOLE_NEAR, DAYLIGHT_MANHOLE_FAR);
  for (const m of lightMouths) add(m.ox, mouthLightY(m), m.oz, DAYLIGHT_MOUTH_NEAR, DAYLIGHT_MOUTH_FAR);
  return light;
};

/** The entrance fade of a mouth (0 until its ground is LOD1 and its cave loaded). */
export const entranceFadeOf = (id: string): number => fades.get(id) ?? 0;

/** Which mouths are LOD1 sites (every footprint chunk loaded) changes only with the loaded set: re-read
 *  per version, never per frame. The fades of unloaded mouths go with it. */
const driveSites = (): void => {
  if (version === sitesVersion) return;
  sitesVersion = version;
  const sites: { x: number; z: number }[] = [];
  const siteIds: string[] = [];
  for (const r of mouths.values()) {
    r.sited = r.cells.every((cell) => loadedCells.has(cell));
    if (r.sited) {
      sites.push({ x: r.piece.ox, z: r.piece.oz });
      siteIds.push(r.piece.id);
    }
  }
  const key = siteIds.sort().join("|");
  if (key !== lod1SiteKey) {
    lod1SiteKey = key;
    setLod1Sites(sites);
  }
  for (const id of fades.keys()) if (!mouths.has(id)) fades.delete(id);
};

/** The entrance fades: a LOD1 site's fade tracks the LOD1 swap's share under it, moving at most
 *  FADE_RATE per second; any other mouth's goes to 0. Allocation-free: it runs every frame. */
const driveFades = (delta: number): void => {
  driveSites();
  const step = FADE_RATE * delta;
  for (const r of mouths.values()) {
    const m = r.piece;
    const target = r.sited ? lod1ShareAt(m.ox, m.oz, 2 * m.r0) : 0;
    const current = fades.get(m.id) ?? 0;
    const next = Math.abs(target - current) <= step ? target : current + Math.sign(target - current) * step;
    if (next !== current) {
      fades.set(m.id, next);
      fadesMoved = true;
    }
  }
};

/** Hands the terrain the 16 nearest holes (shafts always; mouths while their fade is above 0) and the
 *  MAX_TUNNEL_MASKS nearest skirt masks within MASK_REACH. */
const pickHoles = (camX: number, camZ: number): void => {
  const holes: (TerrainHole & { d: number })[] = [];
  for (const s of playerTunnels.shafts) {
    holes.push({ kind: "shaft", id: s.id, ax: s.x, ay: s.bottom, az: s.z, bx: s.x, by: s.street + 1, bz: s.z, radius: s.radius - SHAFT_HOLE_INSET, share: 1, capHeight: 0, band: 0, lightY: 0, d: Math.hypot(s.x - camX, s.z - camZ) });
  }
  for (const r of mouths.values()) {
    const m = r.piece;
    const fade = fades.get(m.id) ?? 0;
    if (fade <= 0) continue;
    holes.push({
      kind: "mouth",
      id: m.id,
      ax: m.ox,
      ay: m.oy,
      az: m.oz,
      bx: m.ox + m.dx * m.length,
      by: m.oy - m.grade * m.length,
      bz: m.oz + m.dz * m.length,
      radius: mouthFootprintRadius(m) - FOOTPRINT_BAND,
      share: fade,
      capHeight: mouthCutCeiling(m),
      band: FOOTPRINT_BAND,
      lightY: mouthLightY(m),
      d: Math.hypot(m.ox - camX, m.oz - camZ),
    });
  }
  holes.sort((a, b) => a.d - b.d);
  const near: (TunnelMask & { d: number })[] = [];
  for (const m of masks) {
    const d = Math.hypot((m.ax + m.bx) / 2 - camX, (m.az + m.bz) / 2 - camZ);
    if (d < MASK_REACH) near.push({ ...m, d });
  }
  near.sort((a, b) => a.d - b.d);
  setTerrainHoles(holes.slice(0, MAX_TERRAIN_HOLES), near.slice(0, MAX_TUNNEL_MASKS));
};

/** The one underground driver: every mounted tunnel feature calls it each frame; it runs once per
 *  frame (the frame clock tells two features' hooks apart from two frames). */
export const driveUnderground = (state: RootState, delta: number): void => {
  const now = state.clock.elapsedTime;
  if (now === lastDrivenTime) return;
  lastDrivenTime = now;
  frame++;
  fadesMoved = false;
  driveFades(delta);
  const { x, z } = state.camera.position;
  if (version !== lastPickVersion || fadesMoved || frame - lastPickFrame >= HOLE_PICK_INTERVAL) {
    lastPickVersion = version;
    lastPickFrame = frame;
    pickHoles(x, z);
  }
};
