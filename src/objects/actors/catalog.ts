import { BEEBLE_SPEC } from "./beeble/spec";
import { BUILDING_SPEC, GRASS_BUILDING_SPEC, SKYSCRAPER_SPEC } from "./building/spec";
import type { ActorSpec } from "./spec";

/**
 * THE ACTOR CATALOG — every actor kind the SERVER simulates, by descriptor id.
 *
 * This is the one list the server reads (server/src/game/entities/manager.ts
 * imports it straight from src/ through the esbuild bundle): a kind's state
 * machine runs here as the one authority, its body moves on the server
 * physics world, its hull keeps walkers out. Adding an NPC is its `spec.ts`
 * plus ONE line here; `describeActor` (world/components/Actor.tsx) refuses a
 * descriptor whose spec is missing or differs, so a forgotten line fails at
 * module load in dev, not as a silent "the server never moved it".
 *
 * Actors with nothing to simulate (a static model, no behavior) have no spec
 * and no entry: the server keeps a static record for them.
 *
 * Three-free, React-free — never import a component or a descriptor here.
 */
export const ACTOR_SPECS: Readonly<Record<string, ActorSpec>> = Object.freeze({
  [BEEBLE_SPEC.id]: BEEBLE_SPEC,
  [BUILDING_SPEC.id]: BUILDING_SPEC,
  [SKYSCRAPER_SPEC.id]: SKYSCRAPER_SPEC,
  [GRASS_BUILDING_SPEC.id]: GRASS_BUILDING_SPEC,
});

export const getActorSpec = (id: string): ActorSpec | undefined => ACTOR_SPECS[id];
