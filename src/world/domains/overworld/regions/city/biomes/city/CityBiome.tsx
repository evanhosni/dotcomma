import { BEEBLE_SPEC } from "../../../../../../../objects/actors/beeble/spec";
import { BUILDING_SPEC, SKYSCRAPER_SPEC } from "../../../../../../../objects/actors/building/spec";
import { SCROLLER_SPEC } from "../../../../../../../objects/actors/scroller/spec";
import { Bridges } from "../../../../../../../objects/dressing/bridges/Bridges";
import { PowerLines } from "../../../../../../../objects/dressing/power-lines/PowerLines";
import { RoadMarkers } from "../../../../../../../objects/dressing/road-markers/RoadMarkers";
import { FreewayLamps } from "../../../../../../../objects/dressing/street-lamps/FreewayLamps";
import { StreetLamps } from "../../../../../../../objects/dressing/street-lamps/StreetLamps";
import { TrafficLights } from "../../../../../../../objects/dressing/traffic-lights/TrafficLights";
import { Rooms } from "../../../../../../underground/Rooms";
import { Sewers } from "../../../../../../underground/Sewers";
import { Actor, Biome, content, Material, Quays } from "../../../../../../components";
import { CITY_BIOME_ID } from "../../../../../../constants";
import { CityLights } from "./CityLights";
import fragmentShader from "./shaders/fragment.glsl";

/** THE CITY. No <Noise>: its heights are the bespoke city branch of the shared vertex pipeline
 *  (block plateaus, streets and the belt freeway, keyed by this biome's id).
 *
 *  It does NOT blend: a 2u feather is a hard, deliberate edge — the belt freeway's centerline sits
 *  on the wall — against any neighbor, and the smaller side wins at a wall. Heights inherit it, so
 *  the plateau holds to the wall and the neighbor ramps. */
export const CityBiome = content(
  <Biome id={CITY_BIOME_ID} name="city" joinable blendWidth={2} additionalHeight={0}>
    <Material shader={fragmentShader} textures={{ sidewalktexture: "sidewalk.png", roadtexture: "road.jpg" }} />
    {/* Its own height code walls every river crossing it (the quays, the waterfront belt). */}
    <Quays />

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
    <Actor actor={SCROLLER_SPEC} />
  </Biome>,
);
