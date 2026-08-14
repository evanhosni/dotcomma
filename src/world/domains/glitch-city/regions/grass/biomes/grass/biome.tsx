import { BuildingActor } from "../../../../../../../objects/actors/building/actor";
import { Foliage } from "../../../../../../../objects/foliage/Foliage";
import { GrassField } from "../../../../../../../objects/foliage/grass/GrassField";
import { Actors, Biome, Material, Terrain } from "../../../../../../components";
import { getMaterial } from "./material";

export const GRASS_BIOME_ID = 3;

/** Grassland biome: rolling noise terrain covered in swaying billboard grass.
 *  Shares biome id 3 with the city region's CityGrassBiome — registrations for
 *  the same id are merged, so keep the two in sync if you change
 *  terrain/material settings. */
export const GrassBiome = () => (
  <Biome name="grass" id={GRASS_BIOME_ID} joinable blendable>
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
          terrain under each one (the generic pad system's first non-city
          use). Distinct id: "building" belongs to the city registration and
          descriptors dedupe by id. */}
      <BuildingActor id="grass-building" biomeIds={[GRASS_BIOME_ID]} density={25} />
    </Actors>
    <Foliage renderDistance={1000}>
      <GrassField
        density={8000000}
        slopeRange={[0, 28]} // terrain shader fades grass texture out past ~0.25 rad, keep blades on the green
        slopeBlend={12}
        color="#6fff00"
        bladeWidth={0.14}
        bladeHeight={1.3}
        sway={0.5}
      />
    </Foliage>
  </Biome>
);
