import { Debug } from "@react-three/cannon";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { BoxCollider, CapsuleCollider, SphereCollider, TrimeshCollider } from "./colliders/Colliders";
import { createColliders } from "./colliders/createColliders";

export const MAX_COLLIDER_RENDER_DISTANCE = 500;

type Task = () => Promise<void>; // TODO probably modularize this

class TaskQueue {
  private queue: Task[] = [];
  private isProcessing = false;
  // private throttleDelay = 30; // Delay between task executions in ms

  public addTask(task: Task) {
    this.queue.push(task);
    this.processQueue();
  }

  private async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      await task();
      // Throttle task execution to avoid spikes
      // await new Promise((resolve) => setTimeout(resolve, this.throttleDelay));
    }

    this.isProcessing = false;
  }
}

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

  // Use a ref to hold the current camera position
  const cameraPositionRef = useRef(camera.position.clone());

  useFrame(() => {
    // Update the camera position ref on every frame
    cameraPositionRef.current.copy(camera.position);
  });

  useEffect(() => {
    // Function to determine if colliders should be rendered
    const updateColliderRenderState = () => {
      const objectPosition = new THREE.Vector3(...coordinates);
      const distance = cameraPositionRef.current.distanceTo(objectPosition);
      setShouldRenderColliders(distance < MAX_COLLIDER_RENDER_DISTANCE);
    };

    // Initial update and set an interval for periodic checks
    updateColliderRenderState();
    const interval = setInterval(updateColliderRenderState, 1000); // Check every second

    // Cleanup interval on component unmount
    return () => clearInterval(interval);
  }, [coordinates]);

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
  }, [gltf, scale, rotation]);

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
