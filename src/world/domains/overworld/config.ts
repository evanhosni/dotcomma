import { DEFAULT_TERRAIN_PARAMS } from "../../defaults";
import { buildDomainConfigFromSpecs } from "../domainConfig";
import { OVERWORLD_REGIONS } from "./regions";

/**
 * The Three-free description of the overworld the SERVER's physics runs on, built
 * from the same spec list domain.tsx renders — regions, biomes, their noise and the
 * flatten-pad actors they place — so the two cannot drift (the <Domain> commit still
 * console.errors any differing key in dev).
 *
 * FROZEN with the addresses (address.ts): the seed, the region order and the grid
 * sizes decide which cell rolls which region/biome, so a change here moves every
 * place anyone has ever linked to.
 */
export const OVERWORLD_SEED = "123";

export const OVERWORLD_CONFIG = buildDomainConfigFromSpecs({
  params: { ...DEFAULT_TERRAIN_PARAMS, seed: OVERWORLD_SEED },
  regions: OVERWORLD_REGIONS,
});
