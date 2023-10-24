import { Canvas } from "@react-three/fiber";
import { TerrainNoiseParams, _noise } from "../_/noise";
import { Controls } from "../_/player/controls/Controls";
import { Terrain } from "../_/terrain/Terrain";
import { City } from "./biomes/City";

const noise: TerrainNoiseParams = {
  type: "perlin",
  octaves: 1,
  persistence: 1,
  lacunarity: 1,
  exponentiation: 1,
  height: 20,
  scale: 50,
};

const getHeight = (x: number, y: number) => {
  if (_noise.terrain(noise, x, y) > 10) {
    return _noise.terrain(noise, x, y);
  } else {
    return City.getHeight(x, y);
  }
};

const getMaterial = (x: number, y: number) => {
  return "material";
};

export const GlitchCity = () => {
  return (
    <Canvas>
      <Controls />
      {/* TODO <Settings (gravity and such)/> */}
      <Terrain getHeight={getHeight} getMaterial={getMaterial} />
      <City />
    </Canvas>
  );
};
