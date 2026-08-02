import { GrassField } from "../../objects/vegetation/GrassField";
import { Biome } from "../../world/types";
import { getMaterial } from "./getMaterial";
import { getVertexData } from "./getVertexData";

const GRASS_BIOME_ID = 3;

/** Swaying billboard grass covering the walkable parts of the biome. */
const GrassCover = () => (
  <GrassField
    biomeIds={[GRASS_BIOME_ID]}
    density={8000000}
    slopeRange={[0, 28]} // terrain shader fades grass texture out past ~0.25 rad, keep blades on the green
    slopeBlend={12}
    color="#6fff00"
    bladeWidth={0.14}
    bladeHeight={1.3}
    sway={0.5}
    renderDistance={1000}
  />
);

export const Grass: Biome = {
  name: "grass",
  id: GRASS_BIOME_ID,
  getVertexData: getVertexData,
  getMaterial: getMaterial,
  joinable: true,
  blendable: true,
  components: [GrassCover],
};
