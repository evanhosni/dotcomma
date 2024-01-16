import { Sky } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Controls } from "../../_/player/controls/Controls";
import { Terrain } from "../../_/terrain/Terrain";
import { Biome } from "../../types/Biome";
import { getMaterial } from "./props/getMaterial";
import { getVertexData } from "./props/getVertexData";

export const DustProperties: Biome = {
  name: "dust",
  getVertexData: getVertexData,
  getMaterial: getMaterial,
};

export const Dust = () => {
  return (
    <Canvas>
      <Controls />
      <Sky />
      {/* TODO <Settings (gravity and such)/> */}
      <Terrain biome={DustProperties} />
    </Canvas>
  );
};
