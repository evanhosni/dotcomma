import type { DomainConfig } from "../../utils/workers/vertexCompute";
import { GLITCH_CITY_CONFIG } from "./glitch-city/config";
import type { DomainId } from "./types";

/**
 * SHARED DOMAIN CONFIGS by id — the Three-free descriptions the SERVER
 * simulates on (physicsWorld.ts) and the <Domain> commit verifies itself
 * against in dev. A domain without an entry has no server-side terrain (its
 * walkers run their machines but stay put); the home page needs none.
 */
export const DOMAIN_CONFIGS: Partial<Record<DomainId, DomainConfig>> = {
  "glitch-city": GLITCH_CITY_CONFIG,
};
