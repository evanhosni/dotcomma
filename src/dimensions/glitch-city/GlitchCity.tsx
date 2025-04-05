import { CustomCanvas } from "../../canvas/CustomCanvas";
import { Dimension, Region } from "../../world/types";
import { Dust } from "../dust/Dust";
import { City } from "./biomes/city/City";
import { Grass } from "./biomes/grass/Grass";
import { getMaterial } from "./getMaterial";
import { getVertexData } from "./getVertexData";

export const CityRegion: Region = {
  biomes: [City, Grass],
};

export const GrassRegion: Region = {
  biomes: [Grass],
};

export const DesertRegion: Region = {
  biomes: [Dust],
};

export const GlitchCity: Dimension = {
  name: "glitch-city",
  regions: [CityRegion /*, GrassRegion, DesertRegion*/],
  getVertexData: getVertexData,
  getMaterial: getMaterial,
  component: () => {
    return (
      <CustomCanvas dimension={GlitchCity}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1} />
      </CustomCanvas>
    );
  },
};
