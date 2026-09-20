import { BeebleActor } from "../../../../../../../objects/actors/beeble/actor";
import { BuildingActor } from "../../../../../../../objects/actors/building/actor";
import { SkyscraperActor } from "../../../../../../../objects/actors/building/skyscraper";
import { Dressing } from "../../../../../../../objects/dressing/Dressing";
import { PowerLines } from "../../../../../../../objects/dressing/power-lines/PowerLines";
import { RoadMarkers } from "../../../../../../../objects/dressing/road-markers/RoadMarkers";
import { StreetLamps } from "../../../../../../../objects/dressing/street-lamps/StreetLamps";
import { TrafficLights } from "../../../../../../../objects/dressing/traffic-lights/TrafficLights";
import { CityLights } from "./CityLights";
import { Actors, Biome, Material } from "../../../../../../components";
import { getMaterial } from "./material";

import { CITY_BIOME_ID } from "../../../../../../constants";
export { CITY_BIOME_ID };

/** No `noise`: city heights are the city branch of vertexCompute.ts (see CLAUDE.md). */
export const CityBiome = () => (
  <Biome name="city" id={CITY_BIOME_ID} joinable blendable={false} blendWidth={3}>
    <Material getMaterial={getMaterial} />

    <Actors>
      <BeebleActor />
      <BuildingActor biomeIds={[CITY_BIOME_ID]} />
      <SkyscraperActor biomeIds={[CITY_BIOME_ID]} />
    </Actors>

    <Dressing>
      <StreetLamps />
      <RoadMarkers />
      <TrafficLights chance={0.45} />
      <PowerLines />
    </Dressing>

    <CityLights />
  </Biome>
);
