import { Bridges } from "../../../../../../../objects/dressing/bridges/Bridges";
import { Dressing } from "../../../../../../../objects/dressing/Dressing";
import { PowerLines } from "../../../../../../../objects/dressing/power-lines/PowerLines";
import { RoadMarkers } from "../../../../../../../objects/dressing/road-markers/RoadMarkers";
import { FreewayLamps, StreetLamps } from "../../../../../../../objects/dressing/street-lamps/StreetLamps";
import { TrafficLights } from "../../../../../../../objects/dressing/traffic-lights/TrafficLights";
import { Biome, Material } from "../../../../../../components";
import { CityLights } from "./CityLights";
import fragmentShader from "./shaders/fragment.glsl";
import { CITY_BIOME } from "./spec";

export const CityBiome = () => (
  <Biome spec={CITY_BIOME}>
    <Material shader={fragmentShader} textures={{ sidewalktexture: "sidewalk.png", roadtexture: "road.jpg" }} />
    <Dressing>
      <StreetLamps />
      {/* The inter-city runs are city infrastructure too (like their markers and decks): they exist only between cities. */}
      <FreewayLamps />
      <RoadMarkers />
      <TrafficLights />
      <PowerLines />
      {/* Every road a river crosses is city infrastructure — including the inter-city runs' decks outside the biome. */}
      <Bridges />
    </Dressing>
    <CityLights />
  </Biome>
);
