/**
 * Road FRAGMENTS (computeVertexData step 8): tiny pieces of road — the city's land or a freeway off
 * it — that rivers have cut off from every other road, too small for anything to spawn on. On a
 * FRAGMENT_CELL lattice (world, a pure function of position), a piece of land is a fragment when it
 * holds at most FRAGMENT_MAX_CELLS points and no deck lands on it. Its vertices are drawn as the
 * river's bank (no pavement, no paint); height is untouched. Placement follows through the road
 * field (FRAGMENT_REMOVED_FIELD: no lamp band, no building band), and a building's own band
 * (≥ FRAGMENT_LAND_FIELD) is never land, so the flatten-pad engine's raw evaluation (which never
 * sees fragments) can't disagree. FRAGMENT_MAX_CELLS sits between the belt slivers found on an 8u
 * lattice over 4×20 km squares (64–3648u²) and the smallest island kept between two decks (7808u²).
 */

import { CITY_BIOME_ID } from "../../../world/constants";
import { FREEWAY_CORRIDOR_OUTER } from "../../../world/shaders/constants";
import { decksAround } from "../bridges/deckGround";
import { dropOldestHalf } from "../cellCache";
import { domainConfig } from "../computeConfig";
import { computeVertexDataRaw } from "../flattenPads";

const FRAGMENT_CELL = 8;
const FRAGMENT_MAX_CELLS = 78; // ≈ 5000u²
/** Land: a city vertex not painted as riverbed with a road field under a building's band, or an
 *  off-city freeway's painted corridor. */
const FRAGMENT_LAND_FIELD = 23;
/** Past the sidewalk band (and the lamp band): the road gives way to the ground, like under a deck. */
export const FRAGMENT_REMOVED_FIELD = 13;
/** Only land this near a river (factor-1 units past its footprint) and, in a city, this near its
 *  belt is checked: a fragment is the river's doing, and a city's inner quays join its streets. */
export const FRAGMENT_RIVER_REACH = 80;
const FRAGMENT_BELT_REACH = 60;
/** A deck's landed end this near a lattice point of a piece connects it. */
const FRAGMENT_DECK_REACH = 16;

/** Per lattice point: 0 = not land, 1 = land in a fragment, 2 = land in a piece that stays. */
const fragmentLattice = new Map<number, number>();
const FRAGMENT_LATTICE_MAX = 200000;
export const clearRoadFragments = (): void => fragmentLattice.clear();
const latticeKey = (ix: number, iz: number): number => ix * 4194304 + iz;
let evaluatingFragments = false;
let fragmentSdfSave = new Float64Array(0);
let fragmentPresenceSave = new Float64Array(0);

const latticeLand = (ix: number, iz: number): boolean => {
  const v = computeVertexDataRaw(ix * FRAGMENT_CELL, iz * FRAGMENT_CELL);
  return !(v.waterHeight > v.height) && isRoadLand(v.biomeId === CITY_BIOME_ID, v.riverBedDistance, v.distanceToRoadCenter);
};

/** Land as the terrain shader draws it: in a city, ground the riverbed does not cover or its
 *  pavement (the bed leaves a road field under ROAD_HALF_WIDTH + 5), short of a building's band;
 *  off it, a freeway's painted corridor. */
const isRoadLand = (inCity: boolean, riverBedDistance: number, road: number): boolean =>
  inCity
    ? road < FRAGMENT_LAND_FIELD && (riverBedDistance >= domainConfig!.river.halfWidth + domainConfig!.river.bank - 1 || road < domainConfig!.cityConfig.roadWidth + 5)
    : road < FREEWAY_CORRIDOR_OUTER;

/** The verdict of a lattice point's piece, flood-filling it (4-neighbors) if unknown. */
const latticeVerdict = (ix: number, iz: number): number => {
  const k0 = latticeKey(ix, iz);
  const known = fragmentLattice.get(k0);
  if (known !== undefined) return known;
  if (fragmentLattice.size > FRAGMENT_LATTICE_MAX) dropOldestHalf(fragmentLattice);
  if (!latticeLand(ix, iz)) {
    fragmentLattice.set(k0, 0);
    return 0;
  }
  const piece: number[] = [ix, iz];
  const seen = new Set<number>([k0]);
  let big = false;
  for (let h = 0; h < piece.length && !big; h += 2) {
    const px = piece[h];
    const pz = piece[h + 1];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const qx = px + dx;
      const qz = pz + dz;
      const k = latticeKey(qx, qz);
      if (seen.has(k)) continue;
      seen.add(k);
      const v = fragmentLattice.get(k);
      if (v === 2) {
        big = true;
        break;
      }
      if (v === 0 || (v === undefined && !latticeLand(qx, qz))) {
        if (v === undefined) fragmentLattice.set(k, 0);
        continue;
      }
      piece.push(qx, qz);
      if (piece.length / 2 > FRAGMENT_MAX_CELLS) {
        big = true;
        break;
      }
    }
  }
  if (!big) {
    // A deck landing on it connects it to the road across.
    for (let h = 0; h < piece.length && !big; h += 2) {
      const px = piece[h] * FRAGMENT_CELL;
      const pz = piece[h + 1] * FRAGMENT_CELL;
      for (const b of decksAround(px, pz)) {
        const p = b.path;
        if (Math.hypot(p[0].x - px, p[0].z - pz) < FRAGMENT_DECK_REACH || Math.hypot(p[p.length - 1].x - px, p[p.length - 1].z - pz) < FRAGMENT_DECK_REACH) {
          big = true;
          break;
        }
      }
    }
  }
  const verdict = big ? 2 : 1;
  for (let h = 0; h < piece.length; h += 2) fragmentLattice.set(latticeKey(piece[h], piece[h + 1]), verdict);
  return verdict;
};

/** Whether a land vertex lies in a road fragment: every land corner of its lattice square does. */
const roadFragmentAt = (x: number, z: number): boolean => {
  if (evaluatingFragments) return false;
  evaluatingFragments = true;
  try {
    const ix = Math.floor(x / FRAGMENT_CELL);
    const iz = Math.floor(z / FRAGMENT_CELL);
    let any = false;
    for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const v = latticeVerdict(ix + dx, iz + dz);
      if (v === 2) return false;
      if (v === 1) any = true;
    }
    return any;
  } finally {
    evaluatingFragments = false;
  }
};

/** Whether a vertex near a river is road land in a fragment. The flood fill evaluates other points
 *  (and may enumerate a cell's decks, which writes the result buffers), so the vertex's slot fields
 *  `sdf` / `presence` are kept aside around it. */
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
): boolean => {
  const land = isRoadLand(inCity, riverBedDistance, roadField);
  const nearBelt = inCity ? biomeBoundaryDistance < domainConfig!.cityConfig.freewayWidth + FRAGMENT_BELT_REACH : true;
  if (!land || !nearBelt || submerged) return false;
  if (fragmentSdfSave.length !== sdf.length) fragmentSdfSave = new Float64Array(sdf.length);
  if (fragmentPresenceSave.length !== presence.length) fragmentPresenceSave = new Float64Array(presence.length);
  fragmentSdfSave.set(sdf);
  fragmentPresenceSave.set(presence);
  const fragment = roadFragmentAt(x, z);
  sdf.set(fragmentSdfSave);
  presence.set(fragmentPresenceSave);
  return fragment;
};
