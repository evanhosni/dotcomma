import { BEEBLE_SPEC } from "./beeble/spec";
import { BUILDING_SPEC, GRASS_BUILDING_SPEC, SKYSCRAPER_SPEC } from "./building/spec";
import type { ActorSpec } from "./spec";

/**
 * Every actor kind the SERVER simulates, by descriptor id — the one list the
 * server imports (through the esbuild bundle). Adding an NPC is its `spec.ts`
 * plus ONE line here; describeActor refuses a descriptor whose spec is missing
 * or differs, so a forgotten line fails at module load in dev.
 * Three-free, React-free — never import a component or a descriptor here.
 */
export const ACTOR_SPECS: Readonly<Record<string, ActorSpec>> = Object.freeze({
  [BEEBLE_SPEC.id]: BEEBLE_SPEC,
  [BUILDING_SPEC.id]: BUILDING_SPEC,
  [SKYSCRAPER_SPEC.id]: SKYSCRAPER_SPEC,
  [GRASS_BUILDING_SPEC.id]: GRASS_BUILDING_SPEC,
});

export const getActorSpec = (id: string): ActorSpec | undefined => ACTOR_SPECS[id];
