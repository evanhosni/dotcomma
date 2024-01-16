import { Canvas } from "@react-three/fiber";
import { Controls } from "../../_/player/controls/Controls";
import { Terrain } from "../../_/terrain/Terrain";
import { Biome } from "../../types/Biome";
import { getMaterial } from "./props/getMaterial";
import { getVertexData } from "./props/getVertexData";

export const CityProperties: Biome = {
  name: "city",
  getVertexData: getVertexData,
  getMaterial: getMaterial,
};

export const City = () => {
  return (
    <Canvas style={{ backgroundColor: "black" }}>
      <Controls />
      {/* TODO <Settings (gravity and such)/> */}
      <Terrain biome={CityProperties} />
    </Canvas>
  );
};
