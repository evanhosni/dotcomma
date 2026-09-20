import { BuildingActor } from "../../../../../../../objects/actors/building/actor";
import { Foliage } from "../../../../../../../objects/foliage/Foliage";
import { GrassField } from "../../../../../../../objects/foliage/grass/GrassField";
import { Actors, Biome, Material, Terrain } from "../../../../../../components";
import { getMaterial } from "./material";
import { GRASS_BIOME } from "./spec";

import { GRASS_BIOME_ID } from "../../../../../../constants";
export { GRASS_BIOME_ID };

/** Grassland biome: rolling noise terrain covered in swaying billboard grass.
 *  Shares biome id 3 with the city region's CityGrassBiome, which re-exports
 *  this folder's spec.ts (flags + noise) and material — only the mounts may
 *  differ per region. */
export const GrassBiome = () => (
  <Biome spec={GRASS_BIOME}>
    <Terrain noise={GRASS_BIOME.noise} />
    <Material getMaterial={getMaterial} />
    <Actors>
      {/* Distinct id: "building" belongs to the city registration and descriptors dedupe by id. */}
      <BuildingActor id="grass-building" biomeIds={[GRASS_BIOME_ID]} density={25} />
    </Actors>
    {/* GrassField's own defaults beat a renderDistance set on this group. */}
    <Foliage>
      <GrassField
        density={8000000}
        slopeRange={[0, 28]} // terrain shader fades grass texture out past ~0.25 rad, keep blades on the green
        slopeBlend={12}
        color="#6fff00"
        width={0.14}
        height={1.3}
        sway={0.5}
      />
    </Foliage>
  </Biome>
);
