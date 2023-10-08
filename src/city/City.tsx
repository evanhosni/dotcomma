import { Canvas } from "@react-three/fiber";

export const City = () => {
  return (
    <Canvas>
      <mesh>
        <boxGeometry />
        <meshStandardMaterial />
      </mesh>
    </Canvas>
  );
};
