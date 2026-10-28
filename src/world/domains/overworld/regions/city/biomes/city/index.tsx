import { BEEBLE_SPEC } from "../../../../../../../objects/actors/beeble/spec";
import { BUILDING_SPEC, SKYSCRAPER_SPEC } from "../../../../../../../objects/actors/building/spec";
import { Bridges } from "../../../../../../../objects/dressing/bridges";
import { PowerLines } from "../../../../../../../objects/dressing/power-lines";
import { RoadMarkers } from "../../../../../../../objects/dressing/road-markers";
import { FreewayLamps, StreetLamps } from "../../../../../../../objects/dressing/street-lamps";
import { TrafficLights } from "../../../../../../../objects/dressing/traffic-lights";
import { Rooms, Sewers } from "../../../../../../underground";
import { Actor, Biome, content, Material } from "../../../../../../components";
import { CITY_BIOME_ID } from "../../../../../../constants";
import { CityLights } from "./lights";
import fragmentShader from "./shaders/fragment.glsl";

/** THE CITY. No <Noise>: its heights are the bespoke city branch of the shared vertex pipeline
 *  (block plateaus, streets and the belt freeway, keyed by this biome's id).
 *
 *  It does NOT blend: a 2u feather is a hard, deliberate edge — the belt freeway's centerline sits
 *  on the wall — against any neighbor, and the smaller side wins at a wall. Heights inherit it, so
 *  the plateau holds to the wall and the neighbor ramps. */
export const CityBiome = content(
  <Biome id={CITY_BIOME_ID} name="city" joinable blendWidth={2}>
    <Material shader={fragmentShader} textures={{ sidewalktexture: "sidewalk.png", roadtexture: "road.jpg" }} />

    <Sewers>
      <Rooms>
        <Actor actor={BEEBLE_SPEC} />
      </Rooms>
    </Sewers>

    <StreetLamps />
    {/* The inter-city runs are city infrastructure too (like their markers and decks): they exist only between cities. */}
    <FreewayLamps />
    <RoadMarkers />
    <TrafficLights />
    <PowerLines />
    {/* Every road a river crosses is city infrastructure — the inter-city runs' decks outside the biome included. */}
    <Bridges />
    <CityLights />

    <Actor actor={BEEBLE_SPEC} />
    <Actor actor={BUILDING_SPEC} />
    <Actor actor={SKYSCRAPER_SPEC} />
  </Biome>,
);
