import type { StateMachineConfig } from "../../../../src/objects/actors/state/types";
import { BEEBLE_SM } from "../../../../src/objects/actors/beeble/stateMachine";
import { BEEBLE_COLLIDER } from "../../../../src/objects/actors/beeble/spec";
import { BUILDING_ATTRS, SKYSCRAPER_ATTRS } from "../../../../src/objects/actors/building/variants";
import type { BuildingKindSpec } from "../physics/buildings.js";

/**
 * Actor descriptor id → what the server simulates. Everything imported is the
 * CLIENT's own file (esbuild follows the src/ imports): a behavior or shape is
 * written once. Adding a synced NPC = its descriptor id → { sm, body } here.
 */
export interface EntityKind {
  /** With `body`: a walker — machine + capsule run here, pose published authoritatively. */
  sm?: StateMachineConfig;
  body?: { radius: number; height: number };
  /** A building: sealed convex hull, static, replicated door state. */
  hull?: BuildingKindSpec;
}

export const KINDS: Readonly<Record<string, EntityKind>> = {
  beeble: { sm: BEEBLE_SM, body: BEEBLE_COLLIDER },
  building: { hull: { attrs: BUILDING_ATTRS } },
  skyscraper: { hull: { attrs: SKYSCRAPER_ATTRS } },
  "grass-building": { hull: { attrs: BUILDING_ATTRS } },
};

export const getKind = (id: string): EntityKind | undefined => KINDS[id];
