import { useLoader } from "@react-three/fiber";
import { Suspense, useMemo } from "react";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";

export const Apartment = ({ coordinates }: { coordinates: number[] }) => {
  const gltf = useLoader(GLTFLoader, "/models/apartment.glb");
  const scene = useMemo(() => gltf.scene.clone(true), [gltf]);

  return (
    <Suspense fallback={null}>
      <primitive object={scene} position={[coordinates![0], coordinates![1], coordinates![2]]} />
    </Suspense>
  );
};
