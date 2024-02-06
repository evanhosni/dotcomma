import { Physics } from "@react-three/cannon";
import { Canvas } from "@react-three/fiber";
import { Player } from "../../_/player/Player";
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
      <Physics>
        <Player vertexData={getVertexData} />
        {/* TODO <Settings (gravity and such)/> */}
        <Terrain biome={CityProperties} />
      </Physics>
    </Canvas>
  );
};
