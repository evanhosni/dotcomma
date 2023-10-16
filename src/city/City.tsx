import { Canvas } from "@react-three/fiber";
import { Controls } from "../_/player/controls/Controls";
import { Terrain } from "../_/terrain/Terrain";
import { Biome } from "../_/terrain/biomes";

const city_biome: Biome = {
  noise: {
    octaves: 2,
    persistence: 1,
    lacunarity: 1,
    exponentiation: 1,
    height: 10,
    scale: 8,
    // noise_type: string, //TODO bring this back if u ever find a use for having both perlin and simplex
    seed: 1,
  },
};

export const City = () => {
  return (
    <Canvas>
      <Controls />
      <Terrain biome={city_biome} />
    </Canvas>
  );
};
