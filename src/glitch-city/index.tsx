import { Canvas } from "@react-three/fiber";
import { Controls } from "../_/player/controls/Controls";
import {
  Terrain,
  TerrainHeight,
  TerrainNoiseParams,
} from "../_/terrain/Terrain";
import { City } from "./biomes/City";
import { River } from "./biomes/River";

const noise: TerrainNoiseParams = {
  octaves: 2,
  persistence: 1,
  lacunarity: 1,
  exponentiation: 1,
  height: 10,
  scale: 8,
  seed: 1,
};

const getHeight = (x: number, y: number) => {
  return TerrainHeight(noise, x, y);
};

const getMaterial = (x: number, y: number) => {
  return "material";
};

export const GlitchCity = () => {
  return (
    <Canvas>
      <Controls />
      <Terrain getHeight={getHeight} getMaterial={getMaterial} />
      <City />
      <River />
    </Canvas>
  );
};
