import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { patchStandardMaterialLampGlow } from "../sky/lampGlow";
import { _quantization } from "../utils/quantization/quantization";
import { TaskQueue } from "../utils/task-queue/TaskQueue";
import { uploadOnFirstDraw } from "../utils/uploadOnFirstDraw";
import { getDistance2DSq } from "../utils/utils";
import { createColliders } from "./colliders/collider";
import { BoxCollider, CapsuleCollider, SphereCollider, TrimeshCollider } from "./colliders/Colliders";
import { AnimationControl } from "./state/types";
import { frustumHiddenObjects } from "./frustumVisibility";

export const MAX_COLLIDER_RENDER_DISTANCE = 500;
const DELETE_OBJECT_BUFFER = 1.2;
const FADE_DURATION = 1;
const DEFAULT_RENDER_DISTANCE = 500;
const DEFAULT_FRUSTUM_PADDING = 3;
// Animation LOD: mixers pause while frustum-culled and run at half rate past
// this fraction of the render distance. Skipped time accumulates (capped) so
// looping animations stay continuous when the object reappears.
const ANIM_HALF_RATE_FRACTION = 0.4;
const MAX_ANIM_CATCHUP = 0.5;

const taskQueue = new TaskQueue();
const frustum = new THREE.Frustum();
const projScreenMatrix = new THREE.Matrix4();
let frustumUpdatedAt = -1;

// Debug "E = toggle animations" (only for instances NOT driven by a state
// machine): ONE shared window listener + flag instead of a keydown listener
// per instance — hundreds of mounted spawns each registering their own
// listener made every keypress O(spawns) even when nothing used the feature.
let manualAnimationsPlaying = false;
const manualAnimationSubscribers = new Set<() => void>();
let manualAnimationListenerAttached = false;
const ensureManualAnimationListener = (): void => {
  if (manualAnimationListenerAttached) return;
  manualAnimationListenerAttached = true;
  window.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key.toLowerCase() !== "e") return;
    manualAnimationsPlaying = !manualAnimationsPlaying;
    manualAnimationSubscribers.forEach((apply) => apply());
  });
};

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

  // Single pass over the clone: index bones by name (the old per-bone
  // re-traversal was O(bones × scene nodes) and caused spawn-batch hitches)
  const clonedBones = new Map<string, THREE.Bone>();
  const clonedSkinned: THREE.SkinnedMesh[] = [];

  // Material clones are deduped by SOURCE material: a model like beeble.glb
  // has 10 meshes sharing a handful of materials, and cloning per MESH meant
  // that many extra materials to patch, fade-drive, and dispose per instance.
  const materialCloneMap = new Map<THREE.Material, THREE.Material>();
  const cloneMaterialShared = (mat: THREE.Material): THREE.Material => {
    let cloned = materialCloneMap.get(mat);
    if (!cloned) {
      cloned = mat.clone();
      materialCloneMap.set(mat, cloned);
    }
    return cloned;
  };

  clone.scene.traverse((node: any) => {
    if (node.isBone) {
      clonedBones.set(node.name, node as THREE.Bone);
    }
    if (node.isSkinnedMesh) {
      clonedSkinned.push(node as THREE.SkinnedMesh);
    } else if (node.isMesh && node.material) {
      // For regular meshes, just clone the material (shared by source)
      node.material = cloneMaterialShared(node.material);
    }
  });

  // Skeletons are deduped by SOURCE skeleton, mirroring SkeletonUtils.clone:
  // beeble.glb has 10 skinned meshes all bound to ONE 24-joint skeleton, and
  // a per-mesh skeleton.clone() created 10 skeletons → 10× Skeleton.update()
  // + 10 bone-texture uploads per instance per frame. One clone per source
  // skeleton (bones rebound to the cloned bone instances by name), bound to
  // each mesh with its own bindMatrix.
  const skeletonMap = new Map<THREE.Skeleton, THREE.Skeleton>();

  for (const node of clonedSkinned) {
    const originalMesh = skinnedMeshes[node.name];
    if (!originalMesh || !originalMesh.skeleton) continue;

    const srcSkeleton = originalMesh.skeleton;
    let skeleton = skeletonMap.get(srcSkeleton);
    if (!skeleton) {
      const bones = srcSkeleton.bones.map((bone: THREE.Bone) => clonedBones.get(bone.name) ?? bone);
      const boneInverses = srcSkeleton.boneInverses.map((matrix: THREE.Matrix4) => matrix.clone());
      skeleton = new THREE.Skeleton(bones, boneInverses);
      skeletonMap.set(srcSkeleton, skeleton);
    }
    node.bind(skeleton, node.bindMatrix);

    // Clone and assign material (shared by source)
    if (originalMesh.material) {
      node.material = cloneMaterialShared(originalMesh.material as THREE.Material);
    }
  }

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
  despawnDistance?: number; // hard-kill distance; defaults to renderDistance * DELETE_OBJECT_BUFFER
  frustumPadding?: number;
  onDestroy: (id: string) => void;
  animationControl?: AnimationControl;
  isStatic?: boolean;
  wholeTrimesh?: boolean;
  excludeColliderNames?: string[];
  quantization?: number; // per-object vertex quantization grid size; defaults to the global grid
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
  despawnDistance,
  frustumPadding = DEFAULT_FRUSTUM_PADDING,
  onDestroy,
  animationControl,
  isStatic = true,
  wholeTrimesh = false,
  excludeColliderNames,
  quantization,
}: GameObjectProps) => {
  const { camera } = useThree();
  const gltf = useGLTF(model);
  const sceneRef = useRef<THREE.Group | null>(null);
  const boundsRef = useRef<THREE.Sphere>(new THREE.Sphere());
  const mountedRef = useRef<boolean>(true);
  const clonedModel = useMemo(() => cloneModelWithAnimations(gltf), [gltf]);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<Map<string, THREE.AnimationAction>>(new Map());
  const scene = clonedModel.scene;

  const groupRef = useRef<THREE.Group>(null);
  const fadeRef = useRef({ opacity: 0, fadingOut: false });
  const materialsRef = useRef<THREE.Material[]>([]);
  const appliedOpacityRef = useRef(-1);
  const animDeltaRef = useRef(0);
  const animFrameParityRef = useRef(false);
  const shouldRenderCollidersRef = useRef(false);
  const lastVisibleRef = useRef<boolean | null>(null);
  const warmFramesRef = useRef(0);
  const destroyedRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [colliders, setColliders] = useState<ColliderState | null>(null);
  const [shouldRenderColliders, setShouldRenderColliders] = useState<boolean>(false);

  // Actions are created LAZILY by clip name: beeble.glb carries 14 clips
  // (298 tracks) of which the state machine ever plays 4 — eagerly binding
  // every clip put all the unused tracks through the mixer's property-binding
  // graph for every instance. Nothing binds a clip until something plays it.
  const getOrCreateAction = (clipName: string): THREE.AnimationAction | null => {
    const mixer = mixerRef.current;
    if (!mixer) return null;
    let action = actionsRef.current.get(clipName);
    if (!action) {
      const clip = clonedModel.animations.find((c: THREE.AnimationClip) => c.name === clipName);
      if (!clip) return null;
      action = mixer.clipAction(clip);
      actionsRef.current.set(clipName, action);
    }
    return action;
  };

  useEffect(() => {
    if (!scene) return;

    sceneRef.current = scene;

    // Collect all materials for fade control and optimize. Meshes share
    // material clones (deduped by source in cloneModelWithAnimations), so
    // dedupe here too: each unique clone gets patched exactly once and the
    // fade loop writes each material once, not once per mesh using it.
    const materialSet = new Set<THREE.Material>();
    scene.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh || (child as THREE.SkinnedMesh).isSkinnedMesh) {
        const mesh = child as THREE.Mesh;
        if (mesh.material) {
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

          materials.forEach((mat) => {
            if (materialSet.has(mat)) return;
            materialSet.add(mat);
            mat.transparent = true;
            mat.opacity = 0;
            (mat as any).fog = false;

            if (!child.userData?.skipQuantization) {
              _quantization.patchMaterial(mat, quantization);
            }
            // Street-lamp glow — NPCs/objects near a lamp brighten like the
            // terrain and buildings do (grid lookup, no real lights)
            patchStandardMaterialLampGlow(mat);
          });

          mesh.frustumCulled = true;
          mesh.castShadow = false;
          mesh.receiveShadow = false;
          // Warm the GPU at mount: force one real draw so this model type's
          // shader programs link and its textures/buffers upload NOW (mount is
          // staggered by spawn batches) instead of inside gl.render the frame
          // the player first LOOKS at one — measured as the remaining 50-90ms
          // render-internal spikes. warmFramesRef below keeps the group
          // visible long enough for that draw to actually happen.
          uploadOnFirstDraw(mesh);
        }
      }
    });
    materialsRef.current = Array.from(materialSet);
    warmFramesRef.current = 3;

    // Set up the mixer only — actions are created lazily (getOrCreateAction)
    if (clonedModel.animations && clonedModel.animations.length > 0) {
      mixerRef.current = new THREE.AnimationMixer(scene);
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

      if (groupRef.current) {
        frustumHiddenObjects.delete(groupRef.current);
      }

      // Stop animations
      if (mixerRef.current) {
        mixerRef.current.stopAllAction();
      }

      // Dispose per-instance GPU resources: the material clones and each
      // shared cloned skeleton's bone texture. Geometry is SHARED with the
      // source GLTF scene — never dispose it here.
      for (const mat of materialsRef.current) {
        mat.dispose();
      }
      const skeletons = new Set<THREE.Skeleton>();
      scene.traverse((node: any) => {
        if (node.isSkinnedMesh && node.skeleton) skeletons.add(node.skeleton);
      });
      skeletons.forEach((skeleton) => skeleton.dispose());

      // Clear references to help garbage collection
      actionsRef.current.clear();
      materialsRef.current = [];
      mixerRef.current = null;
      sceneRef.current = null;
    };
  }, [scene, clonedModel.animations, quantization]); // scale omitted: stable per instance, only used for bounding sphere

  // E-key animation toggle (only when not driven by a state machine) —
  // subscribes to the ONE shared module-level keydown listener.
  useEffect(() => {
    if (animationControl) return;

    const apply = () => {
      setIsPlaying(manualAnimationsPlaying);
      if (manualAnimationsPlaying) {
        // Materialize + play every clip (original behavior: all clips
        // run together while the debug toggle is on)
        for (const clip of clonedModel.animations ?? []) {
          const action = getOrCreateAction(clip.name);
          if (action) {
            action.paused = false;
            // If resuming animations, ensure they're properly reset if they were stopped
            if (!action.isRunning()) {
              action.play();
            }
          }
        }
      } else {
        actionsRef.current.forEach((action) => {
          action.paused = true;
        });
      }
    };

    ensureManualAnimationListener();
    manualAnimationSubscribers.add(apply);
    return () => {
      manualAnimationSubscribers.delete(apply);
    };
  }, [animationControl, clonedModel]);

  // The pool unmounts a destroyed object on its next batch — up to several
  // frames after onDestroy. Whether this instance has colliders at all is
  // known from the (cached) collider result; collider-less models (beeble)
  // skip the collider-gate state machinery entirely.
  const hasColliders =
    colliders !== null &&
    colliders.capsuleColliders.length +
      colliders.sphereColliders.length +
      colliders.boxColliders.length +
      colliders.trimeshColliders.length >
      0;

  // Handle animations and frustum culling
  useFrame((state, delta) => {
    // onDestroy fires ONCE — re-firing every frame until the pool's next
    // batch actually unmounts us rewrote the despawn-ledger timestamp each
    // frame, delaying the eventual respawn cooldown.
    if (destroyedRef.current) return;

    const objectPosition = positionRef.current || new THREE.Vector3(...coordinates);
    // Distances are only ever COMPARED here — stay in squared space (no sqrt)
    const distanceSq = getDistance2DSq(camera.position, objectPosition);

    // Fade in/out
    const fade = fadeRef.current;
    if (distanceSq > renderDistance * renderDistance && !fade.fadingOut) {
      fade.fadingOut = true;
    } else if (distanceSq <= renderDistance * renderDistance && fade.fadingOut) {
      fade.fadingOut = false;
    }

    // Hard kill safety net
    const killDistance = despawnDistance ?? renderDistance * DELETE_OBJECT_BUFFER;
    if (distanceSq > killDistance * killDistance) {
      destroyedRef.current = true;
      onDestroy(id);
      return;
    }

    if (fade.fadingOut) {
      fade.opacity = Math.max(0, fade.opacity - delta / FADE_DURATION);
      if (fade.opacity <= 0) {
        destroyedRef.current = true;
        onDestroy(id);
        return;
      }
    } else {
      fade.opacity = Math.min(1, fade.opacity + delta / FADE_DURATION);
    }

    // Apply fade to materials — only when the opacity actually changed
    // (steady-state objects skip the whole loop)
    if (fade.opacity !== appliedOpacityRef.current) {
      appliedOpacityRef.current = fade.opacity;
      const mats = materialsRef.current;
      for (let i = 0; i < mats.length; i++) {
        mats[i].opacity = fade.opacity;
        mats[i].transparent = fade.opacity < 1;
      }
    }

    // Update shared frustum once per frame (first GameObject instance wins)
    if (state.clock.elapsedTime !== frustumUpdatedAt) {
      frustumUpdatedAt = state.clock.elapsedTime;
      projScreenMatrix.multiplyMatrices(state.camera.projectionMatrix, state.camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projScreenMatrix);
    }

    // Update bounding sphere position - using boundsRef instead of global bounds
    boundsRef.current.center.copy(objectPosition);

    const paddedRadius = boundsRef.current.radius * frustumPadding;

    // For very large objects, we can add an additional check
    // based on distance to camera rather than just frustum
    const objectRadiusWithScale = boundsRef.current.radius;
    const distanceToCameraSq = camera.position.distanceToSquared(objectPosition);

    // Scale the "close to camera" threshold by the object's render distance
    const proximityFactor = renderDistance / DEFAULT_RENDER_DISTANCE;
    const closeThreshold = objectRadiusWithScale * 3 * proximityFactor;

    const isCloseToCamera = distanceToCameraSq < closeThreshold * closeThreshold;

    // An object is visible if:
    // 1. It intersects with the padded frustum (using temporary larger radius), OR
    // 2. It's very close to the camera
    const originalRadius = boundsRef.current.radius;
    boundsRef.current.radius = paddedRadius; // Temporarily increase radius for check
    let isVisible = frustum.intersectsSphere(boundsRef.current) || isCloseToCamera;
    boundsRef.current.radius = originalRadius; // Restore original radius

    // Warm-up: stay visible for the first few frames after mount so the
    // meshes' forced first draw (uploadOnFirstDraw in the mount effect) can
    // actually happen — an object mounted behind the player would otherwise
    // be hidden here before its programs/textures ever reach the GPU.
    if (warmFramesRef.current > 0) {
      warmFramesRef.current--;
      isVisible = true;
    }

    // Set visibility directly on the group ref — no React re-render. Only
    // touch the shared Set (and the group) on actual TRANSITIONS: steady-state
    // add/delete of every object every frame was measurable Set churn.
    if (groupRef.current && lastVisibleRef.current !== isVisible) {
      lastVisibleRef.current = isVisible;
      groupRef.current.visible = isVisible;
      if (isVisible) {
        frustumHiddenObjects.delete(groupRef.current);
      } else {
        frustumHiddenObjects.add(groupRef.current);
      }
    }

    // Colliders gate on DISTANCE only — physics must not depend on where the
    // camera points (gating on the frustum result unmounted and rebuilt the
    // Rapier colliders every time the player turned around).
    if (hasColliders) {
      // Also scale collider render distance based on object size
      const colliderRenderDistance = Math.min(MAX_COLLIDER_RENDER_DISTANCE, renderDistance / 2);

      const shouldShowColliders = distanceSq < colliderRenderDistance * colliderRenderDistance;
      if (shouldRenderCollidersRef.current !== shouldShowColliders) {
        shouldRenderCollidersRef.current = shouldShowColliders;
        setShouldRenderColliders(shouldShowColliders);
      }
    }

    // State-machine-driven animation commands (cheap — always processed so
    // state changes apply even while the mixer itself is LOD-skipped)
    if (animationControl && mixerRef.current && animationControl.dirty) {
      animationControl.dirty = false;
      const cmd = animationControl.pendingCommand;
      if (cmd) {
        const targetAction = getOrCreateAction(cmd.clipName);
        if (targetAction) {
          // Stop the materialized actions to clear the mixer (clips nothing
          // ever played were never bound — there's nothing else to stop)
          actionsRef.current.forEach((action) => {
            action.stop();
          });
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

    // Animation LOD: skinned/keyframe updates are the per-frame CPU cost of
    // animated spawns. Skip entirely while frustum-culled; halve the rate at
    // distance. Delta accumulates so loops stay continuous on reappear.
    const mixer = mixerRef.current;
    if (mixer && (animationControl || isPlaying)) {
      animDeltaRef.current = Math.min(animDeltaRef.current + delta, MAX_ANIM_CATCHUP);
      animFrameParityRef.current = !animFrameParityRef.current;
      const halfRateDistance = renderDistance * ANIM_HALF_RATE_FRACTION;
      const skipFarFrame = distanceSq > halfRateDistance * halfRateDistance && animFrameParityRef.current;
      if (isVisible && !skipFarFrame) {
        mixer.update(animDeltaRef.current);
        animDeltaRef.current = 0;
      }
    }
  });

  useEffect(() => {
    const task = async () => {
      try {
        const colliders = await createColliders(gltf as any, scale, rotation, wholeTrimesh, model, excludeColliderNames);
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
