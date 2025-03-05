import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
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
  const fadeStartTime = useRef(Date.now());
  const [opacity, setOpacity] = useState(0);

  const true_render_distance = Math.max(OBJECT_RENDER_DISTANCE, render_distance);

  const [colliders, setColliders] = useState<{
    capsuleColliders: any[];
    sphereColliders: any[];
    boxColliders: any[];
    trimeshColliders: any[];
  } | null>(null);

  const [shouldRender, setShouldRender] = useState(false);
  const [shouldRenderColliders, setShouldRenderColliders] = useState(false);

  // Initialize materials and bounding sphere on first render
  useEffect(() => {
    if (scene) {
      // Set up materials for fade effect
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          // Clone the material to avoid affecting other instances
          child.material = child.material.clone();
          child.material.transparent = true;
          child.material.opacity = 0;
        }
      });

      // Create bounding sphere
      const bbox = new THREE.Box3().setFromObject(scene);
      const center = bbox.getCenter(new THREE.Vector3());
      const size = bbox.getSize(new THREE.Vector3());
      const radius = Math.max(size.x, size.y, size.z) / 2;
      bounds.set(center, radius * Math.max(...scale));
    }
  }, [scene, scale]);

  // Handle fade-in effect
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

    // Calculate fade progress
    const elapsedTime = (Date.now() - fadeStartTime.current) / 1000;
    const newOpacity = Math.min(elapsedTime, 1);

    if (newOpacity !== opacity) {
      setOpacity(newOpacity);
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          child.material.opacity = newOpacity;
        }
      });
    }
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
