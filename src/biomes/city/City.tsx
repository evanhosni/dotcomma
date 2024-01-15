import { Canvas } from "@react-three/fiber";
import { Controls } from "../../_/player/controls/Controls";
import { Terrain } from "../../_/terrain/Terrain";
import { Biome } from "../../types/Biome";
import { getVertexData } from "./props/getVertexData";
import { material } from "./props/material";

export const CityProperties: Biome = {
  name: "city",
  getVertexData: getVertexData,
  material: material,
};

export const City = () => {
  return (
    <Canvas>
      <Controls />
      {/* TODO <Settings (gravity and such)/> */}
      <Terrain biome={CityProperties} />
    </Canvas>
  );
};
