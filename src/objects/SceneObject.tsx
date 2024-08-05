import { Debug } from "@react-three/cannon";
import { useLoader } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { BoxCollider } from "./colliders/boxCollider";
import { CapsuleCollider } from "./colliders/capsuleCollider";
import { createColliders } from "./colliders/createColliders";
import { SphereCollider } from "./colliders/sphereCollider";
import { TrimeshCollider } from "./colliders/trimeshCollider";

export const SceneObject = ({
  model,
  coordinates,
  scale = [1, 1, 1],
  rotation = [0, 0, 0],
}: {
  model: string;
  coordinates: THREE.Vector3Tuple;
  scale?: THREE.Vector3Tuple;
  rotation?: THREE.Vector3Tuple;
}) => {
  const gltf = useLoader(GLTFLoader, model);
  const scene = useMemo(() => gltf.scene.clone(true), [gltf]);

  const [colliders, setColliders] = useState<{
    capsuleColliders: any[];
    sphereColliders: any[];
    boxColliders: any[];
    trimeshColliders: any[];
  } | null>(null);

  useEffect(() => {
    const fetchColliders = async () => {
      const colliders = await createColliders(gltf, scale, rotation);
      setColliders(colliders);
    };

    fetchColliders();
  }, [gltf, scale, rotation]);

  if (!colliders) {
    return null;
  }

  const { capsuleColliders, sphereColliders, boxColliders, trimeshColliders } = colliders;

  return (
    <Debug>
      <Suspense fallback={null}>
        <primitive
          object={scene}
          position={[coordinates[0], coordinates[1], coordinates[2]]}
          scale={scale as THREE.Vector3Tuple}
          rotation={new THREE.Euler(...rotation)}
        />
        {capsuleColliders.map((collider, index) => (
          <CapsuleCollider key={index} {...collider} offset={coordinates} />
        ))}
        {sphereColliders.map((collider, index) => (
          <SphereCollider key={index} {...collider} offset={coordinates} />
        ))}
        {boxColliders.map((collider, index) => (
          <BoxCollider key={index} {...collider} offset={coordinates} />
        ))}
        {trimeshColliders.map((collider, index) => (
          <TrimeshCollider key={index} {...collider} offset={coordinates} />
        ))}
      </Suspense>
    </Debug>
  );
};
