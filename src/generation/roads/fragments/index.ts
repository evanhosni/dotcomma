/**
 * Road FRAGMENTS and block ISLANDS (computeVertexData step 8): pieces too small for anything to spawn
 * on, found on a world lattice (a pure function of position) by a cached flood fill of raw
 * evaluations.
 *
 * A road FRAGMENT is a piece of road — the city's land or a freeway off it — that rivers have cut off
 * from every other road: at most FRAGMENT_MAX_CELLS points on the FRAGMENT_CELL lattice, and no deck
 * lands on it. Its vertices are drawn as the river's bank (no pavement, no paint); height is
 * untouched. Placement follows through the road field (FRAGMENT_REMOVED_FIELD: no lamp band, no
 * building band), and a building's own band (≥ FRAGMENT_LAND_FIELD) is never land, so the flatten-pad
 * engine's raw evaluation (which never sees fragments) can't disagree. FRAGMENT_MAX_CELLS sits between
 * the belt slivers found on an 8u lattice over 4×20 km squares (64–3648u²) and the smallest island
 * kept between two decks (7808u²).
 *
 * A block ISLAND is a piece of the city's block land (curb, sidewalk, plaza) that no building could
 * stand on: no point of it reaches a building's band, and it holds at most ISLAND_MAX_CELLS points of
 * the ISLAND_CELL lattice. The edge roads (belt, arterials, quays) leave them where they pinch a
 * corner of a block off (generation/roads/city/index.ts merges the REMNANT cells they leave, which covers the rest).
 * Its vertices become road at the road's own height (blockIslandAt, roadHeightAround), or the river's
 * bank where it stands in the sand.
 */
import { CITY_BIOME_ID } from "../../../world/constants";
import { FREEWAY_CORRIDOR_OUTER, RIVER_BED_FADE_INSET } from "../../../world/shaders/constants";
import { decksAround } from "../../bridges/ground";
import { dropOldestHalf } from "../../cache/utils";
import { domainConfig } from "../../store";
import { computeVertexDataRaw } from "../../placement/flatten-pads";
import { FRAGMENT_LAND_FIELD, ISLAND_LAND_FIELD, FRAGMENT_CELL, FRAGMENT_MAX_CELLS, FRAGMENT_DECK_REACH, ISLAND_CELL, ISLAND_MAX_CELLS, FRAGMENT_RIVER_REACH, FRAGMENT_BELT_REACH, ISLAND_BUILD_FIELD, ISLAND_CURB_FIELD, LATTICE_MAX, ISLAND_PIECE_MAX, ISLAND_BANK_RIM, ISLAND_WALK_STEP, ISLAND_FILL_RAYS, ISLAND_FILL_STEP, ISLAND_FILL_REACH } from "./constants";
import type { PieceLattice } from "./types";
import { LAND, ROAD, BANK, STAYS, KEEPS, RAMP, TO_BANK, TO_ROAD } from "./enums";

const latticeKey = (ix: number, iz: number): number => ix * 4194304 + iz;
let evaluatingPieces = false;
let pieceSdfSave = new Float64Array(0);
let piecePresenceSave = new Float64Array(0);

/** Land as the terrain shader draws it: in a city, ground the riverbed does not cover or its
 *  pavement (the bed leaves a road field under ROAD_HALF_WIDTH + 5), short of a building's band;
 *  off it, a freeway's painted corridor. */
const isRoadLand = (inCity: boolean, riverBedDistance: number, road: number): boolean =>
  inCity
    ? road < FRAGMENT_LAND_FIELD && (riverBedDistance >= domainConfig!.river.halfWidth + domainConfig!.river.bank - 1 || road < domainConfig!.cityConfig.roadWidth + 5)
    : road < FREEWAY_CORRIDOR_OUTER;

/** Block land as the terrain shader draws it: the city's curb, sidewalk and plaza where no riverbed
 *  covers them (the bed shows from the plaza band on, ROAD_HALF_WIDTH + 5). */
const isBlockLand = (riverBedDistance: number, road: number): boolean =>
  road >= ISLAND_LAND_FIELD && (road < domainConfig!.cityConfig.roadWidth + 5 || riverBedDistance >= domainConfig!.river.halfWidth + domainConfig!.river.bank - RIVER_BED_FADE_INSET);

const fragments: PieceLattice = {
  cell: FRAGMENT_CELL,
  maxCells: FRAGMENT_MAX_CELLS,
  verdicts: new Map(),
  land: (x, z) => {
    const v = computeVertexDataRaw(x, z);
    return !(v.waterHeight > v.height) && isRoadLand(v.biomeId === CITY_BIOME_ID, v.riverBedDistance, v.distanceToRoadCenter) ? LAND : ROAD;
  },
  // A deck landing on it connects it to the road across.
  stays: (piece) => {
    for (let h = 0; h < piece.length; h += 2) {
      const px = piece[h] * FRAGMENT_CELL;
      const pz = piece[h + 1] * FRAGMENT_CELL;
      for (const b of decksAround(px, pz)) {
        const p = b.path;
        if (Math.hypot(p[0].x - px, p[0].z - pz) < FRAGMENT_DECK_REACH || Math.hypot(p[p.length - 1].x - px, p[p.length - 1].z - pz) < FRAGMENT_DECK_REACH) return true;
      }
    }
    return false;
  },
};

const islands: PieceLattice = {
  cell: ISLAND_CELL,
  maxCells: ISLAND_MAX_CELLS,
  verdicts: new Map(),
  // As step 8 leaves it: a road fragment there is the river's bank, not land.
  land: (x, z) => {
    const v = computeVertexDataRaw(x, z);
    const road = v.distanceToRoadCenter;
    const rv = domainConfig!.river;
    if (v.waterHeight > v.height) return BANK;
    if (v.biomeId !== CITY_BIOME_ID || !isBlockLand(v.riverBedDistance, road)) return road >= ISLAND_LAND_FIELD && v.riverBedDistance < rv.halfWidth + rv.bank - RIVER_BED_FADE_INSET ? BANK : ROAD;
    if (
      v.distanceToRiverCenter < rv.halfWidth + rv.bank + FRAGMENT_RIVER_REACH &&
      isRoadLand(true, v.riverBedDistance, road) &&
      v.distanceToBiomeBoundaryCenter < domainConfig!.cityConfig.freewayWidth + FRAGMENT_BELT_REACH &&
      pieceRemovedAt(fragments, x, z) !== STAYS
    )
      return BANK;
    return road >= ISLAND_BUILD_FIELD ? KEEPS : road >= ISLAND_CURB_FIELD ? LAND : RAMP;
  },
  stays: () => false,
};

export const clearRoadFragments = (): void => {
  fragments.verdicts.clear();
  islands.verdicts.clear();
};

/** The verdict of a lattice point's piece, flood-filling it (4-neighbors) if unknown. */
const latticeVerdict = (lat: PieceLattice, ix: number, iz: number): number => {
  const verdicts = lat.verdicts;
  const k0 = latticeKey(ix, iz);
  const known = verdicts.get(k0);
  if (known !== undefined) return known;
  if (verdicts.size > LATTICE_MAX) dropOldestHalf(verdicts);
  const land0 = lat.land(ix * lat.cell, iz * lat.cell);
  if (land0 === ROAD || land0 === BANK) {
    verdicts.set(k0, land0);
    return land0;
  }
  const piece: number[] = [ix, iz];
  const seen = new Set<number>([k0]);
  let big = land0 === KEEPS;
  let rimRoad = 0;
  let rimBank = 0;
  let landCells = land0 === RAMP ? 0 : 1;
  for (let h = 0; h < piece.length && !big; h += 2) {
    const px = piece[h];
    const pz = piece[h + 1];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const qx = px + dx;
      const qz = pz + dz;
      const k = latticeKey(qx, qz);
      if (seen.has(k)) continue;
      seen.add(k);
      let v = verdicts.get(k);
      if (v === STAYS) {
        big = true;
        break;
      }
      if (v === undefined) {
        const land = lat.land(qx * lat.cell, qz * lat.cell);
        if (land === ROAD || land === BANK) verdicts.set(k, (v = land));
        else if (land === KEEPS) {
          big = true;
          break;
        } else if (land === LAND) landCells++;
      }
      if (v === ROAD) rimRoad++;
      if (v === BANK) rimBank++;
      if (v === ROAD || v === BANK) continue;
      piece.push(qx, qz);
      if (landCells > lat.maxCells || piece.length / 2 > ISLAND_PIECE_MAX) {
        big = true;
        break;
      }
    }
  }
  if (!big) big = landCells === 0 || lat.stays(piece);
  // To the bank only a piece standing in the sand: a sidewalk strip between a road and the bed (a
  // quay's riverside sidewalk, cut short by junctions) borders both about equally, and stays.
  const verdict = big ? STAYS : rimBank > ISLAND_BANK_RIM * rimRoad ? TO_BANK : rimBank > 0 ? STAYS : TO_ROAD;
  for (let h = 0; h < piece.length; h += 2) verdicts.set(latticeKey(piece[h], piece[h + 1]), verdict);
  return verdict;
};

/** Whether a land point lies in a removed piece (TO_ROAD / TO_BANK; STAYS when not): every land
 *  corner of its lattice square does. With `bare`, also where no corner is land: a road there is
 *  narrower than the lattice's diagonal (11.3u, under any road's own width) — a speck of a removed
 *  piece's corridor fringe left standing on the bank. */
const pieceRemovedAt = (lat: PieceLattice, x: number, z: number, bare = false): number => {
  const ix = Math.floor(x / lat.cell);
  const iz = Math.floor(z / lat.cell);
  let removed = STAYS;
  for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const v = latticeVerdict(lat, ix + dx, iz + dz);
    if (v === STAYS) return STAYS;
    if (v === TO_ROAD || v === TO_BANK) removed = v;
  }
  return removed === STAYS && bare ? TO_ROAD : removed;
};

/** pieceRemovedAt for the current vertex. The flood fill evaluates other points (and may enumerate a
 *  cell's decks, which writes the result buffers), so the vertex's slot fields `sdf` / `presence` are
 *  kept aside around it. */
const inRemovedPiece = (lat: PieceLattice, x: number, z: number, sdf: Float64Array, presence: Float64Array, bare: boolean): number => {
  if (evaluatingPieces) return STAYS;
  if (pieceSdfSave.length !== sdf.length) pieceSdfSave = new Float64Array(sdf.length);
  if (piecePresenceSave.length !== presence.length) piecePresenceSave = new Float64Array(presence.length);
  pieceSdfSave.set(sdf);
  piecePresenceSave.set(presence);
  evaluatingPieces = true;
  try {
    return pieceRemovedAt(lat, x, z, bare);
  } finally {
    evaluatingPieces = false;
    sdf.set(pieceSdfSave);
    presence.set(piecePresenceSave);
  }
};

/** Whether a vertex near a river is road land in a fragment. */
export const inRoadFragment = (
  x: number,
  z: number,
  inCity: boolean,
  riverBedDistance: number,
  roadField: number,
  biomeBoundaryDistance: number,
  submerged: boolean,
  sdf: Float64Array,
  presence: Float64Array,
  bare: boolean,
): boolean => {
  const land = isRoadLand(inCity, riverBedDistance, roadField);
  const nearBelt = inCity ? biomeBoundaryDistance < domainConfig!.cityConfig.freewayWidth + FRAGMENT_BELT_REACH : true;
  if (!land || !nearBelt || submerged) return false;
  return inRemovedPiece(fragments, x, z, sdf, presence, bare) !== STAYS;
};
const landAlong = (x: number, z: number, px: number, pz: number): boolean => {
  const n = Math.ceil(Math.hypot(px - x, pz - z) / ISLAND_WALK_STEP);
  for (let i = 1; i < n; i++) {
    const v = islands.land(x + ((px - x) * i) / n, z + ((pz - z) * i) / n);
    if (v === ROAD || v === BANK) return false;
  }
  return true;
};

/** The island verdict at a land vertex: that of the lattice points around it its land reaches in a
 *  straight line — its square's corners, and for curb and sidewalk (`wide`) the ring of lattice points
 *  around them too, so land thinner than the lattice goes with its island. Removed only when it reaches
 *  a removed piece and no piece that stays: by its square's corners alone, a block's sidewalk sharing a
 *  square with an island went with it, and the block's outline came out in lattice steps. Land with no
 *  land lattice point anywhere in that ring, between roads only, is a sliver thinner than the lattice —
 *  a curb ridge where two roads' fields meet, which the terrain's triangles drew as a row of teeth —
 *  and goes to road. */
const islandRemovedAt = (x: number, z: number, wide: boolean): number => {
  const cell = islands.cell;
  const ix = Math.floor(x / cell);
  const iz = Math.floor(z / cell);
  let anyRemoved = false;
  let anyLand = false;
  let anyBank = false;
  for (const a of [-1, 0, 1, 2]) for (const b of [-1, 0, 1, 2]) {
    const v = latticeVerdict(islands, ix + a, iz + b);
    if (v === TO_ROAD || v === TO_BANK) anyRemoved = true;
    if (v === TO_ROAD || v === TO_BANK || v === STAYS) anyLand = true;
    if (v === BANK) anyBank = true;
  }
  if (!anyLand) return anyBank ? STAYS : TO_ROAD;
  if (!anyRemoved) return STAYS;
  const span = wide ? [-1, 0, 1, 2] : [0, 1];
  let removed = STAYS;
  let nearest = Infinity;
  for (const a of span) {
    for (const b of span) {
      const v = latticeVerdict(islands, ix + a, iz + b);
      if (v !== STAYS && v !== TO_ROAD && v !== TO_BANK) continue;
      const px = (ix + a) * cell;
      const pz = (iz + b) * cell;
      if (!landAlong(x, z, px, pz)) continue;
      if (v === STAYS) return STAYS;
      const d = Math.hypot(px - x, pz - z);
      if (d < nearest) {
        nearest = d;
        removed = v;
      }
    }
  }
  return removed;
};
const roadHeightAround = (x: number, z: number): number => {
  let sum = 0;
  let weights = 0;
  for (let r = 0; r < ISLAND_FILL_RAYS; r++) {
    const a = (r / ISLAND_FILL_RAYS) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    for (let d = ISLAND_FILL_STEP; d <= ISLAND_FILL_REACH; d += ISLAND_FILL_STEP) {
      const px = x + dx * d;
      const pz = z + dz * d;
      const v = computeVertexDataRaw(px, pz);
      if (v.distanceToRoadCenter >= ISLAND_LAND_FIELD) continue;
      const w = 1 / (d * d * d * d);
      sum += w * v.height;
      weights += w;
      break;
    }
  }
  return weights > 0 ? sum / weights : NaN;
};
/** What blockIslandAt found for a vertex going TO_ROAD: the road's height there (NaN: none in reach). */
export const islandRoad = { height: NaN };

/** Whether a city vertex is block land in an island (see the header): TO_ROAD, TO_BANK, or 0. The flood
 *  fill evaluates other points (and may enumerate a cell's decks, which writes the result buffers), so
 *  the vertex's slot fields `sdf` / `presence` are kept aside around it. */
export const blockIslandAt = (x: number, z: number, riverBedDistance: number, roadField: number, submerged: boolean, sdf: Float64Array, presence: Float64Array): number => {
  if (submerged || roadField >= ISLAND_BUILD_FIELD || !isBlockLand(riverBedDistance, roadField) || evaluatingPieces) return 0;
  if (pieceSdfSave.length !== sdf.length) pieceSdfSave = new Float64Array(sdf.length);
  if (piecePresenceSave.length !== presence.length) piecePresenceSave = new Float64Array(presence.length);
  pieceSdfSave.set(sdf);
  piecePresenceSave.set(presence);
  evaluatingPieces = true;
  try {
    const removed = islandRemovedAt(x, z, roadField >= ISLAND_CURB_FIELD);
    // The road's own dip ramp stays road beside an island going to the bank.
    if (removed === STAYS || (removed === TO_BANK && roadField < ISLAND_CURB_FIELD)) return 0;
    if (removed === TO_ROAD) islandRoad.height = roadHeightAround(x, z);
    return removed;
  } finally {
    evaluatingPieces = false;
    sdf.set(pieceSdfSave);
    presence.set(piecePresenceSave);
  }
};
