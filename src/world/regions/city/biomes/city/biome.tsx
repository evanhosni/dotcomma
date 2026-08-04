import { ApartmentSpawnable } from "../../../../../spawnables/apartment/spawnable";
import { BeebleSpawnable } from "../../../../../spawnables/beeble/spawnable";
import { BigBeebleSpawnable } from "../../../../../spawnables/big-beeble/spawnable";
import { Building1Spawnable } from "../../../../../spawnables/building1/spawnable";
import { XLElementSpawnable } from "../../../../../spawnables/xl-element/spawnable";
import { XXLElementSpawnable } from "../../../../../spawnables/xxl-element/spawnable";
import { Biome, Material, Spawnables, Terrain } from "../../../../components";
import { getMaterial } from "./material";
import { getVertexData } from "./vertexData";

export const CITY_BIOME_ID = 1;

/** Urban biome: city grid with blocks, buildings, and creatures.
 *  Heights come from the city grid (WorldConfig.cityConfig in the workers,
 *  getVertexData on the main thread) — no biome noise. */
export const CityBiome = () => (
  <Biome name="city" id={CITY_BIOME_ID} joinable blendable={false} blendWidth={3}>
    <Terrain getVertexData={getVertexData} />
    <Material getMaterial={getMaterial} />
    <Spawnables>
      <BeebleSpawnable />
      <ApartmentSpawnable />
      <BigBeebleSpawnable />
      <XLElementSpawnable />
      <XXLElementSpawnable />
      <Building1Spawnable />
    </Spawnables>
  </Biome>
);
