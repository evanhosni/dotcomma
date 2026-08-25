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

/** Urban biome: district city — staggered districts of rotated block grids
 *  (each a seeded multiple of 15°) separated by wide arterials, with
 *  polyomino blocks on flat plateaus, flatiron triangle super-cells, and
 *  roundabout super-cells (round block + ring road). Heights
 *  (block plateaus riding the regional base noise) and the road-distance field come from the city
 *  branch of the shared vertex pipeline (workers/vertexCompute.ts, keyed by
 *  biome id 1 + DomainConfig.cityConfig) — no `noise` config here.
 *
 *  Content comes in the two spawn classes:
 *  - ACTORS: per-object spawns with identity/state/interaction (creatures,
 *    buildings) — one React component each via ObjectPool.
 *  - DRESSING: mass stateless scenery (lamps, markers, signals, power
 *    lines) — instanced chunks, placement enumerated off-thread. */
export const CityBiome = () => (
  <Biome name="city" id={CITY_BIOME_ID} joinable blendable={false} blendWidth={3}>
    <Material getMaterial={getMaterial} />

    <Actors>
      <BeebleActor />
      {/* <BigBeebleActor />
      <XLElementActor />
      <XXLElementActor /> */}
      <BuildingActor biomeIds={[CITY_BIOME_ID]} />
      <SkyscraperActor biomeIds={[CITY_BIOME_ID]} />
    </Actors>

    <Dressing>
      <StreetLamps />
      <RoadMarkers />
      <TrafficLights chance={0.45} />
      <PowerLines />
    </Dressing>

    {/* One far-reaching beacon light at each city's voronoi center */}
    <CityLights />
  </Biome>
);
