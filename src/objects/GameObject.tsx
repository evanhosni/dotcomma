import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
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

useGLTF.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.6/");

// Helper function to properly clone a model with animations
function cloneModelWithAnimations(gltf: any): {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
  nodes: Record<string, any>;
  materials: Record<string, any>;
} {
  const clone = {
    scene: gltf.scene.clone(true),
    animations: gltf.animations,
    nodes: { ...gltf.nodes },
    materials: { ...gltf.materials },
  };

  // Clone the skeletons/bones properly
  const skinnedMeshes: Record<string, THREE.SkinnedMesh> = {};

  gltf.scene.traverse((node: any) => {
    if (node.isSkinnedMesh) {
      skinnedMeshes[node.name] = node as THREE.SkinnedMesh;
    }
  });

  clone.scene.traverse((node: any) => {
    if (node.isSkinnedMesh) {
      const originalMesh = skinnedMeshes[node.name];
      if (originalMesh && originalMesh.skeleton) {
        node.skeleton = originalMesh.skeleton.clone();

        // Update bone references
        if (node.skeleton && node.skeleton.bones) {
          const newBones: THREE.Bone[] = [];
          node.skeleton.bones.forEach((originalBone: THREE.Bone) => {
            // Find the corresponding bone in the cloned scene
            let newBone: THREE.Bone | null = null;
            clone.scene.traverse((clonedNode: any) => {
              if (clonedNode.isBone && clonedNode.name === originalBone.name) {
                newBone = clonedNode as THREE.Bone;
              }
            });
            if (newBone) {
              newBones.push(newBone);
            }
          });
          // Replace the bones in the skeleton
          node.skeleton.bones = newBones;
        }

        // Clone and assign material
        if (originalMesh.material) {
          node.material = (originalMesh.material as THREE.Material).clone();
          // Make material visible immediately (removed opacity setting here)
        }

        // Ensure bind matrices are updated
        if (node.skeleton.boneInverses) {
          node.skeleton.boneInverses = node.skeleton.boneInverses.map((matrix: THREE.Matrix4) => matrix.clone());
        }
      }
    } else if (node.isMesh) {
      // For regular meshes, just clone the material
      if (node.material) {
        node.material = node.material.clone();
        // Make material visible immediately (removed opacity setting here)
      }
    }
  });

  return clone;
}

interface GameObjectProps {
  model: string;
  coordinates: THREE.Vector3Tuple;
  id: string;
  scale?: THREE.Vector3Tuple;
  rotation?: THREE.Vector3Tuple;
  positionRef: React.MutableRefObject<THREE.Vector3>;
  render_distance?: number;
  onDestroy: (id: string) => void;
}

interface ColliderState {
  capsuleColliders: any[];
  sphereColliders: any[];
  boxColliders: any[];
  trimeshColliders: any[];
}

export const GameObject = ({
  model,
  coordinates,
  id,
  scale = [1, 1, 1],
  rotation = [0, 0, 0],
  positionRef,
  render_distance = OBJECT_RENDER_DISTANCE,
  onDestroy,
}: GameObjectProps) => {
  const { camera } = useThree();
  const gltf = useGLTF(model);
  const sceneRef = useRef<THREE.Group | null>(null);

  // Use our custom cloning function instead of simple clone
  const clonedModel = useMemo(() => cloneModelWithAnimations(gltf), [gltf]);
  const scene = clonedModel.scene;

  // Set creation timestamp to use for randomizing animation start times
  const creationTimestamp = useRef<number>(Date.now());

  // Remove fade opacity state and keep materials visible
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<THREE.AnimationAction[]>([]);

  const true_render_distance = Math.max(OBJECT_RENDER_DISTANCE, render_distance);

  const [colliders, setColliders] = useState<ColliderState | null>(null);
  const [shouldRender, setShouldRender] = useState<boolean>(false);
  const [shouldRenderColliders, setShouldRenderColliders] = useState<boolean>(false);

  // Initialize materials, animations, and bounding sphere on first render
  useEffect(() => {
    if (scene) {
      sceneRef.current = scene;

      // Make all materials visible immediately
      scene.traverse((child: any) => {
        if (((child as any).isMesh || (child as any).isSkinnedMesh) && child.material) {
          child.material.transparent = false; // No need for transparency
          // Remove opacity settings to show immediately
        }
      });

      // Set up animations if they exist
      if (scene && clonedModel.animations && clonedModel.animations.length > 0) {
        const mixer = new THREE.AnimationMixer(scene);
        mixerRef.current = mixer;

        // Start each animation immediately with a random offset
        clonedModel.animations.forEach((clip: THREE.AnimationClip) => {
          const action = mixer.clipAction(clip);

          // Each animation should start immediately but at a different time offset
          // to create variation between instances
          const randomOffset = Math.random() * clip.duration;
          action.time = randomOffset;
          action.play();

          actionsRef.current.push(action);
        });
      }

      // Create bounding sphere
      const bbox = new THREE.Box3().setFromObject(scene);
      const center = bbox.getCenter(new THREE.Vector3());
      const size = bbox.getSize(new THREE.Vector3());
      const radius = Math.max(size.x, size.y, size.z) / 2;
      bounds.set(center, radius * Math.max(...scale));
    }
  }, [scene, scale, clonedModel.animations]);

  // Handle animations and frustum culling
  useFrame((_, delta) => {
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
    setShouldRender(true); //TODO set this to isVisible once you fix the check. maybe make bounds visible for debugging
    setShouldRenderColliders(distance < MAX_COLLIDER_RENDER_DISTANCE && isVisible);

    // Update animations
    if (mixerRef.current) {
      mixerRef.current.update(delta);
    }
  });

  useEffect(() => {
    const task = async () => {
      try {
        const colliders = await createColliders(gltf, scale, rotation);
        setColliders(colliders as ColliderState);
      } catch (error) {
        console.error("Error creating colliders:", error);
      }
    };

    taskQueue.addTask(task);

    // Clean up animations when component unmounts
    return () => {
      if (mixerRef.current) {
        mixerRef.current.stopAllAction();
      }
    };
  }, [gltf, scale, rotation]);

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
