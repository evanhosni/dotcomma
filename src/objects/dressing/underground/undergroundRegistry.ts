import type { RootState } from "@react-three/fiber";
import type { LiquidLook } from "../../../vfx/underwater";
import { dropOldestHalf } from "../../../utils/workers/cellCache";
import { smoothstep } from "../../../utils/math/_math";
import { AXIS_LIFT, CHANNEL_DEPTH, DAYLIGHT_MANHOLE_FAR, DAYLIGHT_MANHOLE_NEAR, DAYLIGHT_MOUTH_FAR, DAYLIGHT_MOUTH_NEAR, FIELD_REACH, FOOTPRINT_BAND, LIQUID_BELOW_WALKWAY, MOUTH_HOLE_CAP_PAD, MOUTH_HOLE_CAP_RADII, SEWER_LIQUID_VISCOSITY, SHAFT_HOLE_INSET } from "../../../utils/workers/underground/constants";
import { liquidLevelOf } from "../../../utils/workers/underground/sewerMesh";
import { compileField, inFrontOfMouthOpening, mouthFootprintRadius, probeRockAlongY, rockEscapeAt, surfaceAboveAt, type FieldFn, type RockEscape } from "../../../utils/workers/underground/tunnelField";
import type { MouthPiece, ShaftPiece, SkirtMask, TunnelEntrance, TunnelPiece, UndergroundChunk } from "../../../utils/workers/underground/types";
import { LOD_FADE_SECONDS } from "../../../world/terrain/lodSwaps";
import { lod1ShareAt } from "../../../world/terrain/TerrainRenderer";
import { setLod1Sites } from "../../../world/terrain/lodQuadtree";
import { MAX_TERRAIN_HOLES, MAX_TUNNEL_MASKS, setTerrainHoles, type TerrainHole, type TunnelMask } from "../../../world/shaders/terrainHoles";
import { DRESSING_CHUNK_SIZE } from "../types";
import { driveFarMouths } from "./farMouths";
import { isOpen, onToggle } from "./undergroundToggles";

/**
 * THE UNDERGROUND REGISTRY (main thread): every loaded tunnel chunk's pieces, entrances and masks, a
 * spatial index with a compiled probe field per cell, and the ONE per-frame driver every mounted
 * tunnel feature calls (it runs once per frame whoever calls first): the terrain's openings, the
 * LOD1 sites, the entrance fades and the far mouths. The player reads probeUnderground and
 * manholeColumnAt every frame.
 */

/** The probe index's cell size. */
const CELL = 32;
/** Compiled fields kept per cell before the oldest half goes. */
const FIELDS_MAX = 1024;
/** The cut set is re-picked every so many frames, or at once when the loaded set or a fade changed. */
const HOLE_PICK_INTERVAL = 10;
/** Skirt masks are handed to the terrain within this of the camera. */
const MASK_REACH = 600;
/** An entrance fade moves at most one LOD fade per LOD fade: never faster than the swap under it. */
const FADE_RATE = 1 / LOD_FADE_SECONDS;
/** The liquid's swimming range: this far under its bottom to this far over its surface. */
const SWIM_ABOVE_SURFACE = 3;
/** The floor probe: steps down from the probe point to the first rock, then bisects. */
const FLOOR_STEP = 0.5;
const FLOOR_REACH = 30;
/** A manhole's column holds a point from this far under its box floor to this far over the street. */
const COLUMN_BELOW_FLOOR = 0.5;
const COLUMN_ABOVE_STREET = 1;

interface MouthRecord {
  id: string;
  /** From any chunk listing it (the same from every chunk). */
  mouth: UndergroundChunk["entranceMouths"][number];
  entrance: TunnelEntrance;
  piece: MouthPiece;
  /** Every footprint chunk loaded: a LOD1 site (driveSites). */
  sited: boolean;
}

const chunks = new Set<UndergroundChunk>();
/** Pieces of every loaded chunk, keyed so a piece two chunks list counts once. */
let pieces: TunnelPiece[] = [];
let shafts: ShaftPiece[] = [];
let entrances = new Map<string, TunnelEntrance>();
let masks: SkirtMask[] = [];
let mouths = new Map<string, MouthRecord>();
/** The dressing chunk keys ("minX,minZ") loaded, per style. */
const loadedCells = new Set<string>();
let version = 0;
let cellPieces = new Map<number, TunnelPiece[]>();
let cellFields = new Map<number, FieldFn>();
const fades = new Map<string, number>();
let lod1SiteKey = "";
let sitesVersion = -1;
let frame = 0;
let lastDrivenTime = -1;
let lastPickVersion = -1;
let lastPickFrame = -Infinity;
let fadesMoved = false;

const pieceKey = (p: TunnelPiece): string => {
  switch (p.kind) {
    case "tube":
      return `t|${p.ax},${p.ay},${p.az}|${p.bx},${p.by},${p.bz}`;
    case "mouth":
      return `m|${p.id}`;
    case "room":
      return `r|${p.ax},${p.az}|${p.bx},${p.bz}`;
    case "cone":
      return `c|${p.x},${p.y},${p.z}`;
    case "box":
      return `b|${p.cx},${p.cz},${p.floor},${p.halfX}`;
    case "pipe":
      return `p|${p.ax},${p.az}|${p.bx},${p.bz}`;
    case "shaft":
      return `s|${p.id}`;
  }
};

const cellKeyOf = (x: number, z: number): number => Math.floor(x / CELL) * 0x100000 + Math.floor(z / CELL);

/** Rebuilds the merged sets after the loaded set changed. */
const rebuild = (): void => {
  const byKey = new Map<string, TunnelPiece>();
  const nextEntrances = new Map<string, TunnelEntrance>();
  const nextMouths = new Map<string, MouthRecord>();
  const maskKeys = new Set<string>();
  const nextMasks: SkirtMask[] = [];
  for (const c of chunks) {
    for (const p of c.pieces) if (!byKey.has(pieceKey(p))) byKey.set(pieceKey(p), p);
    for (const e of c.systemEntrances) nextEntrances.set(e.id, e);
    for (const m of c.masks) {
      const k = `${m.ax},${m.az},${m.bx},${m.bz}`;
      if (maskKeys.has(k)) continue;
      maskKeys.add(k);
      nextMasks.push(m);
    }
    for (const em of c.entranceMouths) {
      if (nextMouths.has(em.id)) continue;
      const entrance = c.systemEntrances.find((e) => e.id === em.id);
      const piece = c.pieces.find((p): p is MouthPiece => p.kind === "mouth" && p.id === em.id);
      if (entrance && piece) nextMouths.set(em.id, { id: em.id, mouth: em, entrance, piece, sited: false });
    }
  }
  pieces = Array.from(byKey.values());
  shafts = pieces.filter((p): p is ShaftPiece => p.kind === "shaft");
  entrances = nextEntrances;
  masks = nextMasks;
  mouths = nextMouths;
  cellPieces = new Map();
  cellFields = new Map();
  version++;
};

/** The dressing chunk key an entrance's footprint list names ("minX,minZ"). */
const cellKeyOfChunk = (chunk: UndergroundChunk): string => `${chunk.centerX - DRESSING_CHUNK_SIZE / 2},${chunk.centerZ - DRESSING_CHUNK_SIZE / 2}`;

/** Whether the dressing chunk ("minX,minZ") is loaded, of any style: what a border cap draws against. */
export const isCellLoaded = (key: string): boolean => loadedCells.has(key);

export const registerChunk = (chunk: UndergroundChunk): void => {
  chunks.add(chunk);
  loadedCells.add(cellKeyOfChunk(chunk));
  rebuild();
};

export const unregisterChunk = (chunk: UndergroundChunk): void => {
  if (!chunks.delete(chunk)) return;
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
onToggle(() => {
  cellFields = new Map();
});

const shaftOpen = (s: ShaftPiece): boolean => isOpen(s.id);

/** The compiled probe field of the cell holding (x, z): the pieces in reach, without the formations. */
const fieldAt = (x: number, z: number): FieldFn => {
  const key = cellKeyOf(x, z);
  let f = cellFields.get(key);
  if (f) return f;
  let list = cellPieces.get(key);
  if (!list) {
    const minX = Math.floor(x / CELL) * CELL;
    const minZ = Math.floor(z / CELL) * CELL;
    list = pieces.filter((p) => p.kind !== "cone" && p.bounds.minX - FIELD_REACH <= minX + CELL && p.bounds.maxX + FIELD_REACH >= minX && p.bounds.minZ - FIELD_REACH <= minZ + CELL && p.bounds.maxZ + FIELD_REACH >= minZ);
    cellPieces.set(key, list);
  }
  if (cellFields.size >= FIELDS_MAX) dropOldestHalf(cellFields);
  f = compileField(list, { shaftOpen, withCones: false });
  cellFields.set(key, f);
  return f;
};

export interface UndergroundProbe {
  /** False while no tunnel chunk is loaded at all: the field is not known (the player keeps its last state). */
  known: boolean;
  /** The field at the point: negative in the air. */
  field: number;
  /** The first rock below the point; NaN out of the air. */
  floorY: number;
  /** The liquid level whose swimming range holds the point; NaN when none. */
  liquidY: number;
  /** That liquid's viscosity relative to water: a spring cave's water is water, the sewers' liquid is thick. */
  liquidViscosity: number;
  /** What the liquid looks like from under it. */
  liquidLook: LiquidLook;
}

const probe: UndergroundProbe = { known: false, field: FIELD_REACH, floorY: NaN, liquidY: NaN, liquidViscosity: 1, liquidLook: "water" };

/** The style of the chunk the last liquid level came from. */
let liquidStyle: UndergroundChunk["style"] = "sewer";

/** The liquid level at (x, z) from the loaded chunks' liquid triangles; NaN when none. */
export const liquidLevelAt = (x: number, z: number): number => {
  for (const c of chunks) {
    if (!c.liquid) continue;
    const level = liquidLevelOf(c.liquid, x - c.centerX, z - c.centerZ);
    if (!Number.isNaN(level)) {
      liquidStyle = c.style;
      return level;
    }
  }
  return NaN;
};

/** The field, the floor and the liquid at a point. The result object is SHARED: read it before the next call. */
export const probeUnderground = (x: number, y: number, z: number): UndergroundProbe => {
  const field = chunks.size === 0 ? FIELD_REACH : fieldAt(x, z)(x, y, z);
  probe.known = chunks.size > 0;
  probe.field = field;
  probe.floorY = NaN;
  probe.liquidY = NaN;
  if (field < 0) {
    probe.floorY = probeRockAlongY(fieldAt(x, z), x, y, z, -1, FLOOR_STEP, FLOOR_REACH);
    const level = liquidLevelAt(x, z);
    // The point's liquid: its surface stands over the floor under the point (a walkway stands over the
    // channel's surface; a room's pool floor lies 5u under it) and the point is not far above it.
    if (!Number.isNaN(level) && level > probe.floorY && y <= level + SWIM_ABOVE_SURFACE) {
      probe.liquidY = level;
      probe.liquidViscosity = liquidStyle === "sewer" ? SEWER_LIQUID_VISCOSITY : 1;
      probe.liquidLook = liquidStyle === "sewer" ? "sewage" : "water";
    }
  }
  return probe;
};

/** Where a point standing in rock gets out, with `clearance` of air to spare (tunnelField.ts rockEscapeAt);
 *  null when it is not in rock, or no way out is found. */
export const escapeFromRockAt = (x: number, y: number, z: number, clearance: number): RockEscape | null => (chunks.size === 0 ? null : rockEscapeAt(fieldAt(x, z), x, y, z, clearance));

/** Whether a point stands in front of a loaded mouth's opening (tunnelField.ts inFrontOfMouthOpening): the
 *  field reads rock there, but it is open air. */
export const inFrontOfOpeningAt = (x: number, y: number, z: number): boolean => {
  for (const p of pieces) {
    if (p.kind !== "mouth") continue;
    const b = p.bounds;
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
    if (inFrontOfMouthOpening(p, x, y, z)) return true;
  }
  return false;
};

/** The SURFACE of the air over a point that stands in rock, within `reach` up (0.25u steps, bisected
 *  to the rock's edge): the floor a player sank through, from the field the walls were meshed from.
 *  NaN when none (deep rock). */
export const airAboveAt = (x: number, y: number, z: number, reach: number): number => (chunks.size === 0 ? NaN : surfaceAboveAt(fieldAt(x, z), x, y, z, 0.25, reach));

/** The daylight reaching a point in a tunnel from the loaded entrances — the mesher's rule for its
 *  vertices (underground/chunkMesh.ts daylightAt) without the ground term: full within an entrance's
 *  near reach, gone by its far one. What the player's personal light judges the dark by. 1 when
 *  nothing is loaded (above ground, as far as the tunnels know). */
export const entranceDaylightAt = (x: number, y: number, z: number): number => {
  if (chunks.size === 0) return 1;
  let light = 0;
  for (const e of entrances.values()) {
    const mouth = e.kind === "mouth" ? mouths.get(e.id)?.piece : undefined;
    const far = e.kind === "mouth" ? DAYLIGHT_MOUTH_FAR : DAYLIGHT_MANHOLE_FAR;
    const near = e.kind === "mouth" ? DAYLIGHT_MOUTH_NEAR : DAYLIGHT_MANHOLE_NEAR;
    const ly = mouth ? mouth.oy + AXIS_LIFT * mouth.r0 : e.y;
    if (Math.abs(e.x - x) > far || Math.abs(e.z - z) > far || Math.abs(ly - y) > far) continue;
    const v = 1 - smoothstep(near, far, Math.hypot(e.x - x, ly - y, e.z - z));
    if (v > light) light = v;
  }
  return light;
};

/** The loaded manhole whose shaft column (its radius) holds the point, with its open state; null when none. */
export const manholeColumnAt = (x: number, z: number, feet: number): { entrance: TunnelEntrance; open: boolean } | null => {
  for (const e of entrances.values()) {
    if (e.kind !== "manhole" || !e.manhole) continue;
    const dx = x - e.x;
    const dz = z - e.z;
    if (dx * dx + dz * dz > e.radius * e.radius) continue;
    if (feet < e.manhole.floorY - COLUMN_BELOW_FLOOR || feet > e.manhole.streetY + COLUMN_ABOVE_STREET) continue;
    return { entrance: e, open: isOpen(e.id) };
  }
  return null;
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
    let loaded = true;
    for (const cell of r.mouth.cells) {
      if (!loadedCells.has(cell)) {
        loaded = false;
        break;
      }
    }
    r.sited = loaded;
    if (loaded) {
      sites.push({ x: r.entrance.x, z: r.entrance.z });
      siteIds.push(r.id);
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
    const target = r.sited ? lod1ShareAt(r.entrance.x, r.entrance.z, 2 * r.piece.r0) : 0;
    const current = fades.get(r.id) ?? 0;
    const next = Math.abs(target - current) <= step ? target : current + Math.sign(target - current) * step;
    if (next !== current) {
      fades.set(r.id, next);
      fadesMoved = true;
    }
  }
};

/** Hands the terrain the 16 nearest holes (shafts always; mouths while their fade is above 0) and the
 *  MAX_TUNNEL_MASKS nearest skirt masks within MASK_REACH. */
const pickHoles = (camX: number, camZ: number): void => {
  const holes: (TerrainHole & { d: number })[] = [];
  for (const s of shafts) {
    holes.push({ kind: "shaft", id: s.id, ax: s.x, ay: s.bottom, az: s.z, bx: s.x, by: s.street + 1, bz: s.z, radius: s.radius - SHAFT_HOLE_INSET, share: 1, capHeight: 0, band: 0, d: Math.hypot(s.x - camX, s.z - camZ) });
  }
  for (const r of mouths.values()) {
    const fade = fades.get(r.id) ?? 0;
    if (fade <= 0) continue;
    const m = r.piece;
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
      capHeight: m.r0 * MOUTH_HOLE_CAP_RADII + MOUTH_HOLE_CAP_PAD,
      band: FOOTPRINT_BAND,
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
  driveFarMouths(state.camera, entranceFadeOf);
};
