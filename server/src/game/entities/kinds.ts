import type { StateMachineConfig } from "../../../../src/objects/actors/state/types";
import { BEEBLE_SM } from "../../../../src/objects/actors/beeble/stateMachine";
import { BEEBLE_COLLIDER } from "../../../../src/objects/actors/beeble/spec";
import { BUILDING_ATTRS, SKYSCRAPER_ATTRS } from "../../../../src/objects/actors/building/variants";
import type { BuildingKindSpec } from "../physics/buildings.js";

/**
 * ENTITY KINDS — what the server simulates for each actor DESCRIPTOR id.
 *
 * Everything here is the CLIENT'S file, imported straight from src/ (the
 * server is bundled with esbuild, which follows those imports): the state
 * machine config, the body spec (beeble/spec.ts — the capsule the descriptor
 * mounts), the building variant attributes (building/variants.ts — the plan
 * the hull is built from). A behavior or a shape is written ONCE, in the
 * actor's folder, and runs here as the one authority; the client only mirrors.
 * See src/objects/actors/state/runner.ts for the contract a config must follow.
 *
 * - `sm` + `body`: a walker — its machine runs here and its capsule moves on
 *   the server physics world (physics/world.ts) with the shared character
 *   resolver; position published authoritatively (x, y AND z).
 * - `hull`: a building — a sealed convex hull collider at its origin, so
 *   walkers can't enter it; static, with replicated `state` (doors).
 * - neither: static, replicated state + interactions only.
 *
 * Adding a synced NPC: its descriptor id → { sm, body } here.
 */
export interface EntityKind {
  sm?: StateMachineConfig;
  body?: { radius: number; height: number };
  hull?: BuildingKindSpec;
}

export const KINDS: Readonly<Record<string, EntityKind>> = {
  beeble: { sm: BEEBLE_SM, body: BEEBLE_COLLIDER },
  building: { hull: { attrs: BUILDING_ATTRS } },
  skyscraper: { hull: { attrs: SKYSCRAPER_ATTRS } },
  "grass-building": { hull: { attrs: BUILDING_ATTRS } },
};

export const getKind = (id: string): EntityKind | undefined => KINDS[id];
