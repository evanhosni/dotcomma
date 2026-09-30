import { BEEBLE_SPEC } from "../../../../../../../objects/actors/beeble/spec";
import { BUILDING_SPEC, SKYSCRAPER_SPEC } from "../../../../../../../objects/actors/building/spec";
import { CITY_BIOME_ID } from "../../../../../../constants";
import type { BiomeSpec } from "../../../../../../types";

/** No `noise`: city heights are the bespoke city branch of the shared vertex pipeline (keyed by biome id). */
export const CITY_BIOME: BiomeSpec = {
  id: CITY_BIOME_ID,
  name: "city",
  joinable: true,
  // The city does NOT blend: a 2u feather is a hard, deliberate edge (the belt
  // freeway's centerline, which sits on the wall) against any neighbor — the smaller side wins at a wall.
  // Heights inherit it too, so the plateau holds to the wall and the neighbor ramps.
  blendWidth: 2,
  // Everything that spawns here, and only here (a kind for several biomes is listed in each).
  actors: [{ actor: BEEBLE_SPEC }, { actor: BUILDING_SPEC }, { actor: SKYSCRAPER_SPEC }],
};
