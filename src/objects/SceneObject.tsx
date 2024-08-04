import { Debug } from "@react-three/cannon";
import { useLoader } from "@react-three/fiber";
import { Suspense, useMemo } from "react";
import * as THREE from "three";
import { Mesh } from "three";
import { GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { CapsuleCollider, createCapsuleCollider } from "./colliders/capsuleCollider";
import { ConvexCollider, createConvexCollider } from "./colliders/convexCollider";
import { createSphereCollider, SphereCollider } from "./colliders/sphereCollider";
import { createTrimeshCollider, TrimeshCollider } from "./colliders/trimeshCollider";

const createColliders = (gltf: GLTF, scale: THREE.Vector3Tuple, rotation: THREE.Vector3Tuple) => {
  const capsuleColliders: any[] = [];
  const sphereColliders: any[] = [];
  const convexColliders: any[] = [];
  const trimeshColliders: any[] = [];

  gltf.scene.traverse((child) => {
    if (child instanceof Mesh && child.geometry) {
      if (!child.userData.collision) return;

      const mesh = child.clone();
      mesh.rotation.set(child.rotation.x, child.rotation.y, child.rotation.z);
      mesh.scale.multiply(new THREE.Vector3(...scale));

      if (child.userData.capsule) {
        const collider = createCapsuleCollider(mesh);
        capsuleColliders.push(collider);
        return;
      }

      if (child.userData.sphere) {
        const collider = createSphereCollider(mesh);
        sphereColliders.push(collider);
        return;
      }

      if (child.userData.convex) {
        const collider = createConvexCollider(mesh);
        convexColliders.push(collider);
        return;
      }

      const collider = createTrimeshCollider(mesh);
      trimeshColliders.push(collider);
    }
  });

  return { capsuleColliders, sphereColliders, convexColliders, trimeshColliders };
};

export const SceneObject = ({
  model,
  coordinates,
  scale = [1, 2, 1],
  rotation = [0, 0, 0],
}: {
  model: string;
  coordinates: THREE.Vector3Tuple;
  scale?: THREE.Vector3Tuple;
  rotation?: THREE.Vector3Tuple;
}) => {
  const gltf = useLoader(GLTFLoader, model);
  const scene = useMemo(() => gltf.scene.clone(true), [gltf]);

  const { capsuleColliders, sphereColliders, convexColliders, trimeshColliders } = useMemo(
    () => createColliders(gltf, scale, rotation),
    [gltf]
  );

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
          <CapsuleCollider key={index} {...collider} offset={coordinates} rotation={rotation} />
        ))}
        {sphereColliders.map((collider, index) => (
          <SphereCollider key={index} {...collider} offset={coordinates} rotation={rotation} />
        ))}
        {convexColliders.map((collider, index) => (
          <ConvexCollider key={index} {...collider} offset={coordinates} rotation={rotation} />
        ))}
        {trimeshColliders.map((collider, index) => (
          <TrimeshCollider key={index} {...collider} offset={coordinates} rotation={rotation} />
        ))}
      </Suspense>
    </Debug>
  );
};
