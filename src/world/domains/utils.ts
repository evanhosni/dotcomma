import type { AnyActorDescriptor } from "../../objects/actors/spawning/types";
import type { SkyboxRecord } from "../sky/Skybox";
import { DomainConfig } from "../../utils/workers/vertexCompute";
import { DEFAULT_RIVER_TEXTURE, DEFAULT_TERRAIN_PARAMS } from "../defaults";
import { Region, TerrainParams } from "../types";
import { ActiveDomain } from "./types";

// Module-level active-domain accessors: what non-React code (workers, Player,
// material composition) reads instead of a static region list.

let active: ActiveDomain | null = null;
let resolveReady: (() => void) | null = null;
let readyPromise = new Promise<void>((resolve) => {
  resolveReady = resolve;
});

export const setActiveDomain = (domain: ActiveDomain) => {
  active = domain;
  if (resolveReady) {
    resolveReady();
    resolveReady = null;
  }
};

/** Unpublishes so whenDomainReady() blocks until the NEXT commit; runs while no <Domain> is mounted. */
export const resetActiveDomain = () => {
  active = null;
  readyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
};

export const whenDomainReady = (): Promise<void> => readyPromise;

export const getActiveRegions = (): Region[] => active?.regions ?? [];

export const getTerrainParams = (): TerrainParams => active?.params ?? DEFAULT_TERRAIN_PARAMS;

export const getRiverTexture = (): string => active?.riverTexture ?? DEFAULT_RIVER_TEXTURE;

const NO_SKYBOXES: SkyboxRecord[] = [];
export const getActiveSkyboxes = (): SkyboxRecord[] => active?.skyboxes ?? NO_SKYBOXES;

const NO_ACTORS: AnyActorDescriptor[] = [];
/** One descriptor per kind, spawning in the union of the biomes that mount it. */
export const getActiveActors = (): AnyActorDescriptor[] => active?.actors ?? NO_ACTORS;

/** Only valid after commit — await whenDomainReady() first. */
export const getActiveDomainConfig = (): DomainConfig => {
  if (!active) {
    throw new Error("getActiveDomainConfig() called before <Domain> committed — await whenDomainReady() first");
  }
  return active.config;
};
