import { BeebleSpawnable } from "../../../../../spawnables/beeble/spawnable";
import { SkyscraperSpawnable } from "../../../../../spawnables/building/skyscraper";
import { BuildingSpawnable } from "../../../../../spawnables/building/spawnable";
import { Biome, Material, Spawnables } from "../../../../components";
import { getMaterial } from "./material";

export const CITY_BIOME_ID = 1;

/** Urban biome: flat city grid with buildings and creatures. Height (flat,
 *  base-noise-cancelling) and road distances come from the city branch of the
 *  shared vertex pipeline (workers/vertexCompute.ts, keyed by biome id 1 +
 *  WorldConfig.cityConfig) — no `noise` config here. */
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
    </Spawnables>
  </Biome>
);
