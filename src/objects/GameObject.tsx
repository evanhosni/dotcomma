import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { _quantization } from "../utils/quantization/quantization";
import { TaskQueue } from "../utils/task-queue/TaskQueue";
import { getDistance2D } from "../utils/utils";
import { createColliders } from "./colliders/collider";
import { BoxCollider, CapsuleCollider, SphereCollider, TrimeshCollider } from "./colliders/Colliders";
import { AnimationControl } from "./state/types";

export const MAX_COLLIDER_RENDER_DISTANCE = 500;
const DELETE_OBJECT_BUFFER = 1.2;
const DEFAULT_RENDER_DISTANCE = 500;
const DEFAULT_FRUSTUM_PADDING = 3;

const taskQueue = new TaskQueue();
const frustum = new THREE.Frustum();
const projScreenMatrix = new THREE.Matrix4();
let frustumUpdatedAt = -1;

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
  renderDistance?: number;
  frustumPadding?: number;
  onDestroy: (id: string) => void;
  animationControl?: AnimationControl;
  isStatic?: boolean;
  wholeTrimesh?: boolean;
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
  renderDistance = DEFAULT_RENDER_DISTANCE,
  frustumPadding = DEFAULT_FRUSTUM_PADDING,
  onDestroy,
  animationControl,
  isStatic = true,
  wholeTrimesh = false,
}: GameObjectProps) => {
  const { camera } = useThree();
  const gltf = useGLTF(model);
  const sceneRef = useRef<THREE.Group | null>(null);
  const boundsRef = useRef<THREE.Sphere>(new THREE.Sphere());
  const mountedRef = useRef<boolean>(true);
  const clonedModel = useMemo(() => cloneModelWithAnimations(gltf), [gltf]);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<THREE.AnimationAction[]>([]);
  const scene = clonedModel.scene;

  const groupRef = useRef<THREE.Group>(null);
  const shouldRenderCollidersRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [colliders, setColliders] = useState<ColliderState | null>(null);
  const [shouldRenderColliders, setShouldRenderColliders] = useState<boolean>(false);

  useEffect(() => {
    if (!scene) return;

    sceneRef.current = scene;

    // Optimize materials - make sure they're not transparent
    scene.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh || (child as THREE.SkinnedMesh).isSkinnedMesh) {
        const mesh = child as THREE.Mesh;
        if (mesh.material) {
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

          materials.forEach((mat) => {
            // Set properties that affect rendering performance
            mat.transparent = false;
            (mat as any).fog = false; // Disable fog calculations if not needed

            // Apply vertex quantization unless opted out
            if (!child.userData?.skipQuantization) {
              _quantization.patchMaterial(mat);
            }
          });

          mesh.frustumCulled = true; // Enable frustum culling
          mesh.castShadow = false; // Disable shadow casting if not needed
          mesh.receiveShadow = false; // Disable shadow receiving if not needed
        }
      }
    });

    // Set up animations efficiently
    if (clonedModel.animations && clonedModel.animations.length > 0) {
      const mixer = new THREE.AnimationMixer(scene);
      mixerRef.current = mixer;

      // Create actions once
      actionsRef.current = clonedModel.animations.map((clip) => {
        const action = mixer.clipAction(clip);
        action.paused = true;
        action.time = 0;
        action.play();
        return action;
      });
    }

    // Calculate bounding sphere efficiently
    const bbox = new THREE.Box3().setFromObject(scene);
    const center = new THREE.Vector3();
    bbox.getCenter(center);

    const size = new THREE.Vector3();
    bbox.getSize(size);

    const radius = Math.max(size.x, size.y, size.z) / 2;
    boundsRef.current.set(center, radius * Math.max(...scale));

    // Return cleanup function
    return () => {
      // Mark component as unmounted to prevent state updates
      mountedRef.current = false;

      // Stop animations
      if (mixerRef.current) {
        mixerRef.current.stopAllAction();
      }

      // Clear references to help garbage collection
      actionsRef.current = [];
      mixerRef.current = null;
      sceneRef.current = null;
    };
  }, [scene, clonedModel.animations]); // scale omitted: stable per instance, only used for bounding sphere

  // Add event listener for E key (only when not driven by state machine)
  useEffect(() => {
    if (animationControl) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "e") {
        setIsPlaying((prevState) => {
          const newState = !prevState;

          // Toggle all animations
          if (actionsRef.current.length > 0) {
            actionsRef.current.forEach((action) => {
              action.paused = !newState;

              // If resuming animations, ensure they're properly reset if they were stopped
              if (newState && !action.isRunning()) {
                action.play();
              }
            });
          }

          return newState;
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [animationControl]);

  // Handle animations and frustum culling
  useFrame((state, delta) => {
    const objectPosition = positionRef.current || new THREE.Vector3(...coordinates);
    const distance = getDistance2D(camera.position, objectPosition);

    if (distance > renderDistance * DELETE_OBJECT_BUFFER) {
      onDestroy(id);
      return;
    }

    // Update shared frustum once per frame (first GameObject instance wins)
    if (state.clock.elapsedTime !== frustumUpdatedAt) {
      frustumUpdatedAt = state.clock.elapsedTime;
      projScreenMatrix.multiplyMatrices(
        state.camera.projectionMatrix,
        state.camera.matrixWorldInverse
      );
      frustum.setFromProjectionMatrix(projScreenMatrix);
    }

    // Update bounding sphere position - using boundsRef instead of global bounds
    boundsRef.current.center.copy(objectPosition);

    const paddedRadius = boundsRef.current.radius * frustumPadding;

    // For very large objects, we can add an additional check
    // based on distance to camera rather than just frustum
    const objectRadiusWithScale = boundsRef.current.radius;
    const distanceToCamera = camera.position.distanceTo(objectPosition);

    // Scale the "close to camera" threshold by the object's render distance
    const proximityFactor = renderDistance / DEFAULT_RENDER_DISTANCE;

    const isCloseToCamera = distanceToCamera < objectRadiusWithScale * 3 * proximityFactor;

    // An object is visible if:
    // 1. It intersects with the padded frustum (using temporary larger radius), OR
    // 2. It's very close to the camera
    const originalRadius = boundsRef.current.radius;
    boundsRef.current.radius = paddedRadius; // Temporarily increase radius for check
    const isVisible = frustum.intersectsSphere(boundsRef.current) || isCloseToCamera;
    boundsRef.current.radius = originalRadius; // Restore original radius

    // Set visibility directly on the group ref — no React re-render
    if (groupRef.current) {
      groupRef.current.visible = isVisible;
    }

    // Also scale collider render distance based on object size
    const colliderRenderDistance = Math.min(MAX_COLLIDER_RENDER_DISTANCE, renderDistance / 2);

    const shouldShowColliders = distance < colliderRenderDistance && isVisible;
    if (shouldRenderCollidersRef.current !== shouldShowColliders) {
      shouldRenderCollidersRef.current = shouldShowColliders;
      setShouldRenderColliders(shouldShowColliders);
    }

    // State-machine-driven animation
    if (animationControl && mixerRef.current) {
      if (animationControl.dirty) {
        animationControl.dirty = false;
        const cmd = animationControl.pendingCommand;
        if (cmd && clonedModel.animations.length > 0) {
          const clipIndex = clonedModel.animations.findIndex(
            (clip: THREE.AnimationClip) => clip.name === cmd.clipName
          );
          if (clipIndex >= 0) {
            const targetAction = actionsRef.current[clipIndex];
            // Stop all actions first to clear the mixer
            for (const action of actionsRef.current) {
              action.stop();
            }
            // Play only the target
            targetAction.reset();
            targetAction.setLoop(cmd.loop ?? THREE.LoopRepeat, Infinity);
            targetAction.timeScale = cmd.timeScale ?? 1.0;
            targetAction.clampWhenFinished = cmd.clampWhenFinished ?? true;
            targetAction.play();
          } else {
            console.error(`animation "${cmd.clipName}" does not exist`);
          }
        }
      }
      mixerRef.current.update(delta);
    } else if (isPlaying && mixerRef.current) {
      // E-key toggle fallback (no animationControl)
      mixerRef.current.update(delta);
    }
  });

  useEffect(() => {
    const task = async () => {
      try {
        const colliders = await createColliders(gltf as any, scale, rotation, wholeTrimesh, model);
        setColliders(colliders as ColliderState);
      } catch (error) {
        console.error("Error creating colliders:", error);
      }
    };

    taskQueue.addTask(task);
  }, [gltf]); // scale/rotation omitted: stable per instance, only used for collider creation

  return (
    <Suspense fallback={null}>
      <group ref={groupRef} visible={false}>
        <primitive object={scene} scale={scale} rotation={rotation} />
      </group>
      {shouldRenderColliders && colliders && (
        <>
          {colliders.capsuleColliders.map((collider, index) => (
            <CapsuleCollider key={index} {...collider} positionRef={positionRef} isStatic={isStatic} />
          ))}
          {colliders.sphereColliders.map((collider, index) => (
            <SphereCollider key={index} {...collider} positionRef={positionRef} isStatic={isStatic} />
          ))}
          {colliders.boxColliders.map((collider, index) => (
            <BoxCollider key={index} {...collider} positionRef={positionRef} isStatic={isStatic} />
          ))}
          {colliders.trimeshColliders.map((collider, index) => (
            <TrimeshCollider key={index} {...collider} positionRef={positionRef} isStatic={isStatic} />
          ))}
        </>
      )}
    </Suspense>
  );
};
