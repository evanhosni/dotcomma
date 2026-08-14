import { DomainConfig } from "../../utils/workers/vertexCompute";
import { DEFAULT_RIVER_TEXTURE, DEFAULT_TERRAIN_PARAMS } from "../defaults";
import { Region, TerrainParams } from "../types";
import { ActiveDomain } from "./types";

/**
 * Module-level "active domain" accessors.
 *
 * The <Domain> component tree registers regions/biomes/rules declaratively
 * and commits the assembled data here. Non-React code (worker init, the
 * voronoi client, Player raycasts, terrain material composition) reads from
 * these accessors instead of importing a static region list.
 */

let active: ActiveDomain | null = null;
let resolveReady: (() => void) | null = null;
let readyPromise = new Promise<void>((resolve) => {
  resolveReady = resolve;
});

/** Called by <Domain> on every commit (registrations changed). */
export const setActiveDomain = (domain: ActiveDomain) => {
  active = domain;
  if (resolveReady) {
    resolveReady();
    resolveReady = null;
  }
};

/** Domain switch (resetDomainSystems): unpublish the outgoing domain so
 *  whenDomainReady() callers wait for the NEXT commit instead of reading the
 *  stale config. Must run while no <Domain> is mounted. */
export const resetActiveDomain = () => {
  active = null;
  readyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
};

/** Resolves once the first <Domain> commit has happened. */
export const whenDomainReady = (): Promise<void> => readyPromise;

export const isDomainReady = (): boolean => active !== null;

export const getActiveRegions = (): Region[] => active?.regions ?? [];

export const getTerrainParams = (): TerrainParams => active?.params ?? DEFAULT_TERRAIN_PARAMS;

export const getRiverTexture = (): string => active?.riverTexture ?? DEFAULT_RIVER_TEXTURE;

/** Serializable config for terrain/spawn/grass workers. Only valid after commit. */
export const getActiveDomainConfig = (): DomainConfig => {
  if (!active) {
    throw new Error("getActiveDomainConfig() called before <Domain> committed — await whenDomainReady() first");
  }
  return active.config;
};
