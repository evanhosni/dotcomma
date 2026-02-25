import { CustomCanvas } from "../../canvas/CustomCanvas";
import { Dimension } from "../../world/types";
import { getMaterial } from "./getMaterial";
import { getVertexData } from "./getVertexData";
import { CityRegion } from "./regions/CityRegion";
import { DesertRegion } from "./regions/DesertRegion";
import { GrassRegion } from "./regions/GrassRegion";

export const GlitchCity: Dimension = {
  name: "glitch-city",
  regions: [CityRegion, DesertRegion /*, GrassRegion, DesertRegion*/],
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
