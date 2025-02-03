import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { OBJECT_RENDER_DISTANCE } from "../utils/scatter/_scatter";
import { TaskQueue } from "../utils/task-queue/TaskQueue";
import { utils } from "../utils/utils";
import { createColliders } from "./colliders/collider";
import { BoxCollider, CapsuleCollider, SphereCollider, TrimeshCollider } from "./colliders/Colliders";

export const MAX_COLLIDER_RENDER_DISTANCE = 500;

const taskQueue = new TaskQueue();
const frustum = new THREE.Frustum();
const projScreenMatrix = new THREE.Matrix4();
const bounds = new THREE.Sphere();

export const GameObject = ({
  model,
  coordinates,
  id,
  scale = [1, 1, 1],
  rotation = [0, 0, 0],
  positionRef,
  render_distance = OBJECT_RENDER_DISTANCE,
  onDestroy,
}: {
  model: string;
  coordinates: THREE.Vector3Tuple;
  id: string;
  scale?: THREE.Vector3Tuple;
  rotation?: THREE.Vector3Tuple;
  positionRef: React.MutableRefObject<THREE.Vector3>;
  render_distance?: number;
  onDestroy: (id: string) => void;
}) => {
  const { camera } = useThree();
  const gltf = useLoader(GLTFLoader, model);
  const scene = useMemo(() => gltf.scene.clone(true), [gltf]);

  const true_render_distance = Math.max(OBJECT_RENDER_DISTANCE, render_distance);

  const [colliders, setColliders] = useState<{
    capsuleColliders: any[];
    sphereColliders: any[];
    boxColliders: any[];
    trimeshColliders: any[];
  } | null>(null);

  const [shouldRender, setShouldRender] = useState(false);
  const [shouldRenderColliders, setShouldRenderColliders] = useState(false);

  // Initialize bounding sphere on first render
  useEffect(() => {
    if (scene) {
      // Create a bounding box to help calculate the bounding sphere
      const bbox = new THREE.Box3().setFromObject(scene);
      const center = bbox.getCenter(new THREE.Vector3());
      const size = bbox.getSize(new THREE.Vector3());

      // Set the bounding sphere based on the bounding box
      const radius = Math.max(size.x, size.y, size.z) / 2;
      bounds.set(center, radius * Math.max(...scale)); // Adjust for scale
    }
  }, [scene, scale]);

  useFrame(() => {
    const objectPosition = positionRef.current || new THREE.Vector3(...coordinates);
    const distance = utils.getDistance2D(camera.position, objectPosition);

    if (distance > true_render_distance) {
      onDestroy(id);
      return;
    }

    // Update frustum for culling check
    projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreenMatrix);

    // Update bounding sphere position
    bounds.center.copy(objectPosition);

    // Check if object is within frustum
    const isVisible = frustum.intersectsSphere(bounds);
    setShouldRender(isVisible);
    setShouldRenderColliders(distance < MAX_COLLIDER_RENDER_DISTANCE && isVisible);
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

  if (!shouldRender) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <primitive object={scene} scale={scale} rotation={rotation} />
      {shouldRenderColliders && colliders && (
        <>
          {colliders.capsuleColliders.map((collider, index) => (
            <CapsuleCollider key={index} {...collider} positionRef={positionRef} />
          ))}
          {colliders.sphereColliders.map((collider, index) => (
            <SphereCollider key={index} {...collider} positionRef={positionRef} />
          ))}
          {colliders.boxColliders.map((collider, index) => (
            <BoxCollider key={index} {...collider} positionRef={positionRef} />
          ))}
          {colliders.trimeshColliders.map((collider, index) => (
            <TrimeshCollider key={index} {...collider} positionRef={positionRef} />
          ))}
        </>
      )}
    </Suspense>
  );
};
