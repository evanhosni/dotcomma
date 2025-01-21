import { Debug } from "@react-three/cannon";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { TaskQueue } from "../utils/task-queue/TaskQueue";
import { BoxCollider, CapsuleCollider, SphereCollider, TrimeshCollider } from "./colliders/Colliders";
import { createColliders } from "./colliders/collider";

export const MAX_COLLIDER_RENDER_DISTANCE = 500;

const taskQueue = new TaskQueue();

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
  const { camera } = useThree();
  const gltf = useLoader(GLTFLoader, model);
  const scene = useMemo(() => gltf.scene.clone(true), [gltf]);

  const [colliders, setColliders] = useState<{
    capsuleColliders: any[];
    sphereColliders: any[];
    boxColliders: any[];
    trimeshColliders: any[];
  } | null>(null);

  const [shouldRenderColliders, setShouldRenderColliders] = useState(false);

  useFrame(() => {
    const objectPosition = new THREE.Vector3(...coordinates);
    const distance = camera.position.distanceTo(objectPosition);
    setShouldRenderColliders(distance < MAX_COLLIDER_RENDER_DISTANCE);
  });

  useEffect(() => {
    const task = async () => {
      try {
        const colliders = await createColliders(gltf, scale, rotation);
        setColliders(colliders);
      } catch (error) {
        console.error("Error creating colliders:", error);
      }
    };

    taskQueue.addTask(task);
  }, []);

  return (
    <Suspense fallback={null}>
      <Debug>
        <primitive
          object={scene}
          position={coordinates}
          scale={scale as THREE.Vector3Tuple}
          rotation={new THREE.Euler(...rotation)}
        />
        {shouldRenderColliders && colliders && (
          <>
            {colliders.capsuleColliders.map((collider, index) => (
              <CapsuleCollider key={index} {...collider} offset={coordinates} />
            ))}
            {colliders.sphereColliders.map((collider, index) => (
              <SphereCollider key={index} {...collider} offset={coordinates} />
            ))}
            {colliders.boxColliders.map((collider, index) => (
              <BoxCollider key={index} {...collider} offset={coordinates} />
            ))}
            {colliders.trimeshColliders.map((collider, index) => (
              <TrimeshCollider key={index} {...collider} offset={coordinates} />
            ))}
          </>
        )}
      </Debug>
    </Suspense>
  );
};

// <group position={coordinates} scale={scale} rotation={new THREE.Euler(...rotation)}>
// <Suspense fallback={null}>
//   <Debug>
//     <primitive object={scene} />
//     {shouldRenderColliders && colliders && (
//       <>
//         {colliders.capsuleColliders.map((collider, index) => (
//           <CapsuleCollider key={index} {...collider} offset={[0, 0, 0]} />
//         ))}
//         {colliders.sphereColliders.map((collider, index) => (
//           <SphereCollider key={index} {...collider} offset={[0, 0, 0]} />
//         ))}
//         {colliders.boxColliders.map((collider, index) => (
//           <BoxCollider key={index} {...collider} offset={[0, 0, 0]} />
//         ))}
//         {colliders.trimeshColliders.map((collider, index) => (
//           <TrimeshCollider key={index} {...collider} offset={[0, 0, 0]} />
//         ))}
//       </>
//     )}
//   </Debug>
// </Suspense>
// </group>
