/**
 * ROCK placement: density fields per biome kept by slope (steeper ground keeps more), clear of roads
 * and cave openings, plus every rim and strewn spot of every cave mouth; each rock's whole look seeded
 * from its position and buried into the DRAWN ground. Three-free: the client draws from these, the
 * server builds the same colliders (objects/dressing/rocks/rockSpec.ts). The boulders in every
 * waterfall are the river's rule (rivers/waterfallRocks.ts), built on the same look.
 */

import { seedRand, smoothstep } from "../../math/_math";
import { seededStream } from "../../math/seededStream";
import type { RectXZ } from "../../math/types";
import { caveBiomeIds, snowParamsOf } from "../biomeFlags";
import { domainConfig } from "../computeConfig";
import { generateDensityPoints, slopeDegreesAt } from "../densityPoints";
import { mouthSpots } from "../underground/caves";
import { OPENING_RADIUS_MAX, STREWN_REACH_RADII } from "../underground/constants";
import { drawnGroundAt } from "../underground/drawnGround";
import { caveMouthsNear } from "../underground/systems";
import { insideMouthOpening, mouthSectionDistanceToRect } from "../underground/tunnelField";
import type { MouthPiece } from "../underground/types";
import { computeVertexData } from "../vertexCompute";

export interface RockField {
  /** Seed namespace of the density grid. */
  seedTag: string;
  biomeIds: number[];
  /** Rocks per 1,000,000 sq units before the slope keep. */
  density: number;
  footprint: number;
  sizeMin: number;
  sizeMax: number;
  /** The share of flat points kept, rising to all between startDeg and fullDeg of slope. */
  flatKeep: number;
  startDeg: number;
  fullDeg: number;
}

export interface RockPlacementParams {
  fields: RockField[];
  /** Past a road's or freeway's paved half width. */
  roadClear: number;
}

export const ROCK_SHAPE_COUNT = 8;

/** A rock's half sizes along its own axes, as shares of its size: the width axes and the height. */
const WIDTH_SHARE_MIN = 0.8;
const WIDTH_SHARE_MAX = 1.3;
const HEIGHT_SHARE_MIN = 0.5;
const HEIGHT_SHARE_MAX = 1.0;
/** The tilt about the rock's own z, radians. */
const PITCH_MAX = 0.35;
/** The share of its height a rock sinks under its lowest drawn ground. */
const BURY_MIN = 0.2;
const BURY_MAX = 0.5;
/** A mouth's rock cannot stand where the ground rises more than this many heights across it (the hood's face). */
const MOUTH_ROCK_RISE_HEIGHTS = 2;
/** A mouth's rocks reach this far from its opening point: the strewn reach of the widest opening, doubled, plus a pad. */
const MOUTH_ROCK_REACH = STREWN_REACH_RADII * OPENING_RADIUS_MAX * 2 + 20;
/** Mouths are fetched this far beyond their reach (a mouth's section runs into the mountain). */
const MOUTH_FETCH_PAD = 100;

export interface RockPoint {
  x: number;
  y: number;
  z: number;
  variant: number;
  /** Half sizes along the rock's own axes. */
  sx: number;
  sy: number;
  sz: number;
  yaw: number;
  pitch: number;
  /** 0–1 between the darker and the lighter rock color. */
  shade: number;
  /** The lowest drawn ground under its footprint. */
  ground: number;
  /** 1 when snow lies on its up-facing faces (its biome's `snow` flag), 0 bare (a boulder in a waterfall). */
  snow: number;
}

/** A rock's look, seeded from its position: shape, half sizes, yaw, tilt, shade and how deep it sinks. */
export interface RockLook {
  variant: number;
  sx: number;
  sy: number;
  sz: number;
  yaw: number;
  pitch: number;
  shade: number;
  /** The share of its height under its lowest ground. */
  bury: number;
}

export const rockLookAt = (x: number, z: number, size: number): RockLook => {
  const s = seededStream(`rock|${x}|${z}`);
  return {
    variant: s.intBetween(0, ROCK_SHAPE_COUNT - 1),
    sx: size * s.between(WIDTH_SHARE_MIN, WIDTH_SHARE_MAX),
    sy: size * s.between(HEIGHT_SHARE_MIN, HEIGHT_SHARE_MAX),
    sz: size * s.between(WIDTH_SHARE_MIN, WIDTH_SHARE_MAX),
    yaw: s.next() * Math.PI * 2,
    pitch: s.between(-PITCH_MAX, PITCH_MAX),
    shade: s.next(),
    bury: s.between(BURY_MIN, BURY_MAX),
  };
};

/** The five ground points a rock stands on: its middle and the four ends of its width axes. */
export const rockFootprint = (x: number, z: number, look: RockLook): [number, number][] => {
  // rotateY(yaw) maps local +x to (cos, −sin) and local +z to (sin, cos).
  const ax = Math.cos(look.yaw);
  const az = -Math.sin(look.yaw);
  const bx = Math.sin(look.yaw);
  const bz = Math.cos(look.yaw);
  return [
    [x, z],
    [x + ax * look.sx, z + az * look.sx],
    [x - ax * look.sx, z - az * look.sx],
    [x + bx * look.sz, z + bz * look.sz],
    [x - bx * look.sz, z - bz * look.sz],
  ];
};

/** A rock's centre height when its lowest ground holds `bury` of its height. */
export const rockRestingY = (lowestGround: number, look: RockLook): number => lowestGround + look.sy - 2 * look.sy * look.bury;

/** A RockPoint from a look standing at a centre height over its lowest ground. */
export const rockPointOf = (x: number, y: number, z: number, look: RockLook, ground: number, snow: number): RockPoint => ({
  x,
  y,
  z,
  variant: look.variant,
  sx: look.sx,
  sy: look.sy,
  sz: look.sz,
  yaw: look.yaw,
  pitch: look.pitch,
  shade: look.shade,
  ground,
  snow,
});

/** Whether the drawn ground at a point lies in a mouth's opening (its air), where no rock may stand. */
const inOpening = (mouths: readonly MouthPiece[], x: number, z: number): boolean => {
  if (mouths.length === 0) return false;
  const ground = drawnGroundAt(x, z);
  for (const m of mouths) if (insideMouthOpening(m, x, ground, z)) return true;
  return false;
};

/** Whether snow lies on a rock standing at a point: its biome's `snow` flag. */
const snowOnRockAt = (x: number, z: number): number => (snowParamsOf(computeVertexData(x, z).biomeId) ? 1 : 0);

/** A rock at a position: its look seeded from the position, buried so its lowest drawn ground holds
 *  BURY_MIN–BURY_MAX of its height; null when its footprint reaches over an opening, or (a mouth's rock)
 *  when the ground rises more than a rock height across it. */
const rockAt = (x: number, z: number, size: number, mouths: readonly MouthPiece[], mouthRock: boolean): RockPoint | null => {
  const look = rockLookAt(x, z, size);
  let lowest = Infinity;
  let highest = -Infinity;
  for (const [px, pz] of rockFootprint(x, z, look)) {
    if (inOpening(mouths, px, pz)) return null;
    const g = drawnGroundAt(px, pz);
    if (g < lowest) lowest = g;
    if (g > highest) highest = g;
  }
  if (mouthRock && highest - lowest > MOUTH_ROCK_RISE_HEIGHTS * look.sy) return null;
  return rockPointOf(x, rockRestingY(lowest, look), z, look, lowest, snowOnRockAt(x, z));
};

/** The mouths whose spots or opening can reach a chunk. */
const mouthsAround = (b: RectXZ): MouthPiece[] => {
  const ids = caveBiomeIds();
  if (ids.length === 0) return [];
  return caveMouthsNear(ids, b, MOUTH_ROCK_REACH + MOUTH_FETCH_PAD).filter((m) => mouthSectionDistanceToRect(m, b) < MOUTH_ROCK_REACH);
};

/** Every field rock of a chunk: the fields' points (kept by slope, clear of roads and openings) and the
 *  mouths' spots, each belonging to the chunk holding its position. The waterfalls' boulders are the
 *  river's (rivers/waterfallRocks.ts); the `rocks` enumerator joins the two. */
export const getRocks = (minX: number, minZ: number, maxX: number, maxZ: number, params: RockPlacementParams): RockPoint[] => {
  const b = { minX, minZ, maxX, maxZ };
  const mouths = mouthsAround(b);
  const city = domainConfig!.cityConfig;
  const out: RockPoint[] = [];
  for (const f of params.fields) {
    const points = generateDensityPoints(minX, minZ, maxX, maxZ, { seedTag: f.seedTag, density: f.density, footprint: f.footprint, biomeIds: f.biomeIds });
    for (const p of points) {
      const slope = slopeDegreesAt(p.x, p.z);
      const keep = f.flatKeep + (1 - f.flatKeep) * smoothstep(f.startDeg, f.fullDeg, slope);
      if (seedRand(`${f.seedTag}|keep|${p.x},${p.z}`) >= keep) continue;
      const vd = computeVertexData(p.x, p.z);
      if (vd.distanceToRoadCenter < city.roadWidth + params.roadClear || vd.distanceToFreewayCenter < city.freewayWidth + params.roadClear) continue;
      if (inOpening(mouths, p.x, p.z)) continue;
      const u = seedRand(`${f.seedTag}|size|${p.x},${p.z}`);
      const size = f.sizeMin + (f.sizeMax - f.sizeMin) * u * u * u;
      const rock = rockAt(p.x, p.z, size, mouths, false);
      if (rock) out.push(rock);
    }
  }
  for (const m of mouths) {
    for (const spot of mouthSpots(m)) {
      if (spot.x < minX || spot.x >= maxX || spot.z < minZ || spot.z >= maxZ) continue;
      const rock = rockAt(spot.x, spot.z, spot.size, mouths, true);
      if (rock) out.push(rock);
    }
  }
  return out;
};
