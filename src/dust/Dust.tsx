import { Canvas } from "@react-three/fiber";
import { Controls } from "../_/player/controls/Controls";

export const Dust = () => {
  return (
    <Canvas>
      <Controls />
      <mesh>
        <sphereGeometry />
        <meshStandardMaterial />
      </mesh>
    </Canvas>
  );
};
