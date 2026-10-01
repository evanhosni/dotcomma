import { actorCatalogOf } from "../../objects/actors/catalog";
import type { ActorSpec } from "../../objects/actors/spec";
import type { DomainConfig } from "../../utils/workers/vertexCompute";
import type { RegionSpec } from "../types";
import { HOME_REGIONS } from "./home/regions";
import { OVERWORLD_CONFIG } from "./overworld/config";
import { OVERWORLD_REGIONS } from "./overworld/regions";
import type { DomainId } from "./types";

/** Every domain's region list (voronoi order) — the lists its domain.tsx renders. Three-free. */
export const DOMAIN_REGIONS: Readonly<Record<DomainId, readonly RegionSpec[]>> = {
  home: HOME_REGIONS,
  overworld: OVERWORLD_REGIONS,
};

/**
 * SHARED DOMAIN CONFIGS by id — the Three-free descriptions the SERVER
 * simulates on (physicsWorld.ts) and the <Domain> commit verifies itself
 * against in dev. A domain without an entry has no server-side terrain (its
 * walkers run their machines but stay put); the home page needs none.
 */
export const DOMAIN_CONFIGS: Partial<Record<DomainId, DomainConfig>> = {
  overworld: OVERWORLD_CONFIG,
};

/** THE actor catalog: every kind a domain's biomes place that the server simulates (objects/actors/catalog.ts). */
export const ACTOR_CATALOG = actorCatalogOf(Object.values(DOMAIN_REGIONS));

export const getActorSpec = (id: string): ActorSpec | undefined => ACTOR_CATALOG[id];
