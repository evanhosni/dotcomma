import { Physics } from "@react-three/cannon";
import { Sky } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Player } from "../../_/player/Player";
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
      <Physics>
        <Player vertexData={getVertexData} />
        <Sky />
        {/* TODO <Settings (gravity and such)/> */}
        <Terrain biome={DustProperties} />
      </Physics>
    </Canvas>
  );
};
