import { BuildingActor } from "../../../../../../../objects/actors/building/actor";
import { Foliage } from "../../../../../../../objects/foliage/Foliage";
import { GrassField } from "../../../../../../../objects/foliage/grass/GrassField";
import { Actors, Biome, Material, Terrain } from "../../../../../../components";
import { getMaterial } from "./material";
import { CITY_GRASS_BIOME } from "./spec";

import { GRASS_BIOME_ID as CITY_GRASS_BIOME_ID } from "../../../../../../constants";
export { CITY_GRASS_BIOME_ID };

/** Grassland biome as it appears inside the city region (rolling noise
 *  terrain covered in swaying billboard grass). Shares biome id 3 with the
 *  grass region's GrassBiome — flags + noise come from ONE spec (re-exported
 *  from the grass region's folder), so the terrain can't drift; the mounts
 *  below are what may legitimately differ per region. */
export const CityGrassBiome = () => (
  <Biome spec={CITY_GRASS_BIOME}>
    <Terrain noise={CITY_GRASS_BIOME.noise} />
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
