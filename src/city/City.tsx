import { Canvas } from "@react-three/fiber";
import { Controls } from "../_/player/controls/Controls";
import { Terrain } from "../_/terrain/Terrain";

export const City = () => {
  return (
    <Canvas>
      <Controls />
      <Terrain />
    </Canvas>
  );
};
