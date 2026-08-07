import { BeebleActor } from "../../../../../actors/beeble/actor";
import { BuildingActor } from "../../../../../actors/building/actor";
import { SkyscraperActor } from "../../../../../actors/building/skyscraper";
import { Dressing } from "../../../../../dressing/Dressing";
import { PowerLines } from "../../../../../dressing/power-lines/PowerLines";
import { RoadMarkers } from "../../../../../dressing/road-markers/RoadMarkers";
import { StreetLamps } from "../../../../../dressing/street-lamps/StreetLamps";
import { TrafficLights } from "../../../../../dressing/traffic-lights/TrafficLights";
import { CityLights } from "../../../../../objects/city-lights/CityLights";
import { Actors, Biome, Material } from "../../../../components";
import { getMaterial } from "./material";

export const CITY_BIOME_ID = 1;

/** Urban biome: district city — staggered districts of rotated block grids
 *  (each a seeded multiple of 15°) separated by wide arterials, with
 *  polyomino blocks on flat plateaus, flatiron triangle super-cells, and
 *  roundabout super-cells (round block + ring road). Heights
 *  (base-noise-cancelling) and the road-distance field come from the city
 *  branch of the shared vertex pipeline (workers/vertexCompute.ts, keyed by
 *  biome id 1 + WorldConfig.cityConfig) — no `noise` config here.
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
