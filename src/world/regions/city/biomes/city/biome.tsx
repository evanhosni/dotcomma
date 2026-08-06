import { RoadMarkers } from "../../../../../objects/road-markers/RoadMarkers";
import { BeebleSpawnable } from "../../../../../spawnables/beeble/spawnable";
import { SkyscraperSpawnable } from "../../../../../spawnables/building/skyscraper";
import { BuildingSpawnable } from "../../../../../spawnables/building/spawnable";
import { StreetLightSpawnable } from "../../../../../spawnables/street-light/spawnable";
import { Biome, Material, Spawnables } from "../../../../components";
import { getMaterial } from "./material";

export const CITY_BIOME_ID = 1;

/** Urban biome: district city — staggered districts of rotated block grids
 *  (each a seeded multiple of 15°) separated by wide arterials, with
 *  polyomino blocks on flat plateaus, flatiron triangle super-cells, and
 *  roundabout super-cells (round block + ring road) — plus buildings and
 *  creatures. Heights (base-noise-cancelling) and the road-distance field
 *  come from the city branch of the shared vertex pipeline
 *  (workers/vertexCompute.ts, keyed by biome id 1 + WorldConfig.cityConfig)
 *  — no `noise` config here. */
export const CityBiome = () => (
  <Biome name="city" id={CITY_BIOME_ID} joinable blendable={false} blendWidth={3}>
    <Material getMaterial={getMaterial} />
    <Spawnables>
      <BeebleSpawnable />
      {/* <BigBeebleSpawnable />
      <XLElementSpawnable />
      <XXLElementSpawnable /> */}
      <BuildingSpawnable biomeIds={[CITY_BIOME_ID]} />
      <SkyscraperSpawnable biomeIds={[CITY_BIOME_ID]} />
      <StreetLightSpawnable biomeIds={[CITY_BIOME_ID]} />
    </Spawnables>
    {/* Raised pavement markers along road centerlines (3D studs, no paint) */}
    <RoadMarkers />
  </Biome>
);
