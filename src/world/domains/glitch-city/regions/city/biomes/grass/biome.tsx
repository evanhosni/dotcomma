import { BuildingActor } from "../../../../../../../objects/actors/building/actor";
import { Foliage } from "../../../../../../../objects/foliage/Foliage";
import { GrassField } from "../../../../../../../objects/foliage/grass/GrassField";
import { Actors, Biome, Material, Terrain } from "../../../../../../components";
import { getMaterial } from "./material";

import { GRASS_BIOME_ID as CITY_GRASS_BIOME_ID } from "../../../../../../constants";
export { CITY_GRASS_BIOME_ID };

/** Duplicate of the grass region's GrassBiome (same id → registrations merge): keep them in sync. */
export const CityGrassBiome = () => (
  <Biome name="grass" id={CITY_GRASS_BIOME_ID} joinable blendable>
    <Terrain
      noise={{
        params: {
          type: "perlin",
          octaves: 3,
          persistence: 1,
          lacunarity: 1,
          exponentiation: 1,
          height: 100,
          scale: 100,
        },
      }}
    />
    <Material getMaterial={getMaterial} />
    <Actors>
      {/* Distinct id: "building" belongs to the city and descriptors dedupe by id */}
      <BuildingActor id="grass-building" biomeIds={[CITY_GRASS_BIOME_ID]} density={25} />
    </Actors>
    {/* createFoliage props beat <Foliage> group defaults, so GrassField's own renderDistance wins */}
    <Foliage>
      <GrassField
        density={8000000}
        slopeRange={[0, 28]} // the terrain shader fades the grass texture past ~0.25 rad
        slopeBlend={12}
        color="#6fff00"
        width={0.14}
        height={1.3}
        sway={0.5}
        quantization={0.2}
      />
    </Foliage>
  </Biome>
);
