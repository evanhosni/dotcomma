import Noise from "noise-ts";
import { seedRand } from "../math/_math";
import type { PointXZ } from "../math/types";
import { domainConfig } from "./computeConfig";
import type { BiomeNoiseConfig, TerrainNoiseParams } from "./types";

const noiseInstance = new Noise(seedRand("bierce"));

export const simplex2 = (x: number, y: number) => noiseInstance.simplex2(x, y);
export const perlin2 = (x: number, y: number) => noiseInstance.perlin2(x, y);

// Memoized per params object: recomputing 2**-persistence per call added a pow per noise call.
const noiseParamsCache = new WeakMap<TerrainNoiseParams, { G: number; norm: number }>();
const getNoiseConsts = (params: TerrainNoiseParams) => {
  let c = noiseParamsCache.get(params);
  if (!c) {
    const G = 2.0 ** -params.persistence;
    let amplitude = 1.0;
    let norm = 0;
    for (let o = 0; o < params.octaves; o++) {
      norm += amplitude;
      amplitude *= G;
    }
    c = { G, norm };
    noiseParamsCache.set(params, c);
  }
  return c;
};

export const terrainNoise = (params: TerrainNoiseParams, x: number, y: number): number => {
  const xs = x / params.scale;
  const ys = y / params.scale;
  const { G, norm } = getNoiseConsts(params);
  const isSimplex = params.type === "simplex";
  let amplitude = 1.0;
  let frequency = 1.0;
  let total = 0;
  for (let o = 0; o < params.octaves; o++) {
    const noiseValue =
      (isSimplex ? simplex2(xs * frequency, ys * frequency) : perlin2(xs * frequency, ys * frequency)) *
        0.5 +
      0.5;
    total += noiseValue * amplitude;
    amplitude *= G;
    frequency *= params.lacunarity;
  }
  total /= norm;
  total -= 0.5;
  // Integer exponents skip pow() — identical results.
  const e = params.exponentiation;
  const shaped = e === 2 ? total * total : e === 1 ? total : Math.pow(total, e);
  return shaped * params.height;
};

/** A biome's declarative height (its <Terrain noise> config) at a world point, before presence.
 *  `depth` feeds the dome: the point's depth inside its biome (zoneBlend.ts domeDepthAt). A caller
 *  without a wall pass (the river network's terrain proxy) gets the height at the biome's edge: with
 *  the dome in the proxy, its high-ground rule cut 3.4% of all river length and moved rivers well
 *  outside the mountains (MEASURED); the offset alone keeps rivers out of the rock. */
export const biomeNoiseHeight = (config: BiomeNoiseConfig, x: number, z: number, depth = 0): number => {
  let h = terrainNoise(config.params, x, z);
  if (config.absNeg) h = Math.abs(h) * -1;
  if (config.scale !== undefined) h *= config.scale;
  const dome = config.dome;
  if (dome) {
    const u = Math.min(1, depth / dome.reach);
    // Squared: gentle foothills, the steepest ground under the summit.
    const rise = u * u;
    const floor = dome.noiseFloor ?? 1;
    h = h * (floor + (1 - floor) * rise) + dome.height * rise;
  }
  if (config.offset !== undefined) h += config.offset;
  return h;
};

/** World → warped space: the road-noise domain warp every grid and wall is laid out in. */
export const warp = (x: number, z: number): PointXZ => ({
  x: x + terrainNoise(domainConfig!.roadNoiseParams, z, 0),
  z: z + terrainNoise(domainConfig!.roadNoiseParams, x, 0),
});

/** Inverts the road-noise warp by fixed-point iteration (a smooth, large-scale warp). */
export const unwarp = (wx: number, wz: number): PointXZ => {
  let x = wx;
  let z = wz;
  for (let it = 0; it < 3; it++) {
    x = wx - terrainNoise(domainConfig!.roadNoiseParams, z, 0);
    z = wz - terrainNoise(domainConfig!.roadNoiseParams, x, 0);
  }
  return { x, z };
};
