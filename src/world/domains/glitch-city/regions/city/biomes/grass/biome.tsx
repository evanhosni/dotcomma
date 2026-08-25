import { BuildingActor } from "../../../../../../../objects/actors/building/actor";
import { Foliage } from "../../../../../../../objects/foliage/Foliage";
import { GrassField } from "../../../../../../../objects/foliage/grass/GrassField";
import { Actors, Biome, Material, Terrain } from "../../../../../../components";
import { getMaterial } from "./material";

import { GRASS_BIOME_ID as CITY_GRASS_BIOME_ID } from "../../../../../../constants";
export { CITY_GRASS_BIOME_ID };

/** Grassland biome as it appears inside the city region (rolling noise
 *  terrain covered in swaying billboard grass). Shares biome id 3 with the
 *  grass region's GrassBiome — registrations for the same id are merged, so
 *  keep the two in sync if you change terrain/material settings. */
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
      {/* Sparse country buildings — flattenGround pads level the rolling
          terrain under each one. Distinct id: "building" belongs to the city
          registration and descriptors dedupe by id. (Kept in sync with the
          grass region's duplicate of this biome.) */}
      <BuildingActor id="grass-building" biomeIds={[CITY_GRASS_BIOME_ID]} density={25} />
    </Actors>
    {/* GrassField's baked default (500) governs the render distance — a
        renderDistance on this group is shadowed by the field's own defaults
        (createFoliage spreads them as props, which beat group context). */}
    <Foliage>
      <GrassField
        density={8000000}
        slopeRange={[0, 28]} // terrain shader fades grass texture out past ~0.25 rad, keep blades on the green
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
