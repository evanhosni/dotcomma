import { useGLTF } from "@react-three/drei";
import { RootState, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { TaskQueue } from "../utils/task-queue/TaskQueue";
import { getDistance2DSq } from "../utils/utils";
import { createColliders } from "./colliders/collider";
import { BoxCollider, CapsuleCollider, SphereCollider, TrimeshCollider } from "./colliders/Colliders";
import { acquireModelClone, PooledModelClone, reclaimModelClone, releaseModelClone } from "./modelClonePool";
import { AnimationControl } from "./state/types";
import { GameObjectAttributes } from "./types";

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
// Scratch for instances whose positionRef is not yet populated — set/used
// synchronously within one updater call, never allocated per frame.
const _fallbackPosition = new THREE.Vector3();

// ── Shared frame driver ─────────────────────────────────────────────────────
// ONE frame subscriber for ALL mounted GameObjects (driven by ObjectPool's
// useFrame) instead of a useFrame per instance: with hundreds of actors
// mounted, per-instance hooks meant that many R3F subscriber invocations and
// subscription churn per spawn batch. Instances register a "latest closure"
// ref; the driver refreshes the shared frustum once, then runs each updater.

type GameObjectFrameUpdater = (state: RootState, delta: number) => void;
const frameUpdaters = new Set<React.MutableRefObject<GameObjectFrameUpdater>>();

/** Runs every mounted GameObject's per-frame work (fade, hard-kill, frustum
 *  visibility, collider gating, animation LOD). Called once per frame from
 *  ObjectPool's frame loop — which <Domain> always mounts, so any GameObject
 *  inside a domain tree is driven. */
export const driveGameObjectFrames = (state: RootState, delta: number): void => {
  if (frameUpdaters.size === 0) return;
  projScreenMatrix.multiplyMatrices(state.camera.projectionMatrix, state.camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projScreenMatrix);
  frameUpdaters.forEach((updater) => updater.current(state, delta));
};

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

/** The shared per-object base: every GLTF-model game object (and the actor
 *  components wrapping one) renders through <GameObject>, which owns the
 *  attributes and behavior common to all of them — render-distance fade +
 *  hard-kill, frustum culling, collision (collider creation/gating), model
 *  cloning, animation LOD, quantization, and GPU warm-up. Base attribute
 *  types live in objects/types.ts (GameObjectAttributes). */
export interface GameObjectProps extends GameObjectAttributes {
  model: string;
  coordinates: THREE.Vector3Tuple;
  id: string;
  scale?: THREE.Vector3Tuple;
  rotation?: THREE.Vector3Tuple;
  positionRef: React.MutableRefObject<THREE.Vector3>;
  despawnDistance?: number; // hard-kill distance; defaults to renderDistance * DELETE_OBJECT_BUFFER
  frustumPadding?: number;
  onDestroy: (id: string) => void;
  animationControl?: AnimationControl;
  isStatic?: boolean;
  wholeTrimesh?: boolean;
  excludeColliderNames?: string[];
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

  // Prepared clone from the pool — despawn/respawn churn reuses parked
  // clones (materials already patched, mixer bound, bounds measured) instead
  // of re-running the whole clone pipeline per mount. Acquired lazily during
  // render (useGLTF has resolved by here); released in the ownership effect.
  const cloneRef = useRef<PooledModelClone | null>(null);
  if (cloneRef.current === null) {
    cloneRef.current = acquireModelClone(model, gltf, quantization);
  }
  const pooled = cloneRef.current;
  const scene = pooled.scene;

  const boundsRef = useRef<THREE.Sphere>(new THREE.Sphere());
  const groupRef = useRef<THREE.Group>(null);
  const fadeRef = useRef({ opacity: 0, fadingOut: false });
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
  // The actions map lives on the pooled record, so a reused clone keeps its
  // already-bound actions.
  const getOrCreateAction = (clipName: string): THREE.AnimationAction | null => {
    const mixer = pooled.mixer;
    if (!mixer) return null;
    let action = pooled.actions.get(clipName);
    if (!action) {
      const clip = pooled.animations.find((c: THREE.AnimationClip) => c.name === clipName);
      if (!clip) return null;
      action = mixer.clipAction(clip);
      pooled.actions.set(clipName, action);
    }
    return action;
  };

  // Ownership + per-life reset. Creation-time work (material patching, GPU
  // warm draw, bounds measure) happened in the pool; here we only reset the
  // shared state this life mutates. reclaim/release are StrictMode-safe: the
  // dev remount's cleanup schedules a DEFERRED release that the immediate
  // re-setup cancels, so the clone never changes owner mid-remount.
  useEffect(() => {
    reclaimModelClone(pooled);

    // Fade starts invisible each life (also covers the StrictMode reclaim
    // path, where no acquire ran to reset the pooled materials).
    for (const mat of pooled.materials) {
      mat.opacity = 0;
      mat.transparent = true;
    }
    fadeRef.current.opacity = 0;
    fadeRef.current.fadingOut = false;
    appliedOpacityRef.current = -1;

    // Warm-up window for the creation-time forced draw (see modelClonePool);
    // on reuse the meshes' own frustum culling makes these frames ~free.
    warmFramesRef.current = 3;

    // scale omitted from deps: stable per instance, only used for the sphere
    boundsRef.current.radius = pooled.baseRadius * Math.max(scale[0], scale[1], scale[2]);

    return () => releaseModelClone(pooled);
  }, [pooled]);

  // E-key animation toggle (only when not driven by a state machine) —
  // subscribes to the ONE shared module-level keydown listener.
  useEffect(() => {
    if (animationControl) return;

    const apply = () => {
      setIsPlaying(manualAnimationsPlaying);
      if (manualAnimationsPlaying) {
        // Materialize + play every clip (original behavior: all clips
        // run together while the debug toggle is on)
        for (const clip of pooled.animations ?? []) {
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
        pooled.actions.forEach((action) => {
          action.paused = true;
        });
      }
    };

    ensureManualAnimationListener();
    manualAnimationSubscribers.add(apply);
    return () => {
      manualAnimationSubscribers.delete(apply);
    };
  }, [animationControl, pooled]);

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

  // Per-frame work (fade, hard-kill, frustum visibility, collider gating,
  // animation LOD) — run by the shared driver (driveGameObjectFrames), not a
  // per-instance useFrame. The ref is refreshed every render so the driver
  // always calls the closure over current props/state.
  const frameUpdaterRef = useRef<GameObjectFrameUpdater>(() => {});
  frameUpdaterRef.current = (_, delta) => {
    // onDestroy fires ONCE — re-firing every frame until the pool's next
    // batch actually unmounts us rewrote the despawn-ledger timestamp each
    // frame, delaying the eventual respawn cooldown.
    if (destroyedRef.current) return;

    const objectPosition =
      positionRef.current ?? _fallbackPosition.set(coordinates[0], coordinates[1], coordinates[2]);
    // The ONE distance for everything below (fade, kill, proximity, collider
    // gate, animation LOD) — 2D and squared: heights don't matter at these
    // radii and the values are only ever COMPARED (no sqrt).
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
      const mats = pooled.materials;
      for (let i = 0; i < mats.length; i++) {
        mats[i].opacity = fade.opacity;
        mats[i].transparent = fade.opacity < 1;
      }
    }

    // Update bounding sphere position - using boundsRef instead of global bounds
    boundsRef.current.center.copy(objectPosition);

    const paddedRadius = boundsRef.current.radius * frustumPadding;

    // For very large objects, add an additional check based on distance to
    // camera rather than just frustum. Uses the same 2D distance as the rest
    // of the loop — errs toward VISIBLE (never hides something the frustum
    // test alone would show).
    const proximityFactor = renderDistance / DEFAULT_RENDER_DISTANCE;
    const closeThreshold = boundsRef.current.radius * 3 * proximityFactor;
    const isCloseToCamera = distanceSq < closeThreshold * closeThreshold;

    // An object is visible if:
    // 1. It intersects with the padded frustum (using temporary larger radius), OR
    // 2. It's very close to the camera
    const originalRadius = boundsRef.current.radius;
    boundsRef.current.radius = paddedRadius; // Temporarily increase radius for check
    let isVisible = frustum.intersectsSphere(boundsRef.current) || isCloseToCamera;
    boundsRef.current.radius = originalRadius; // Restore original radius

    // Warm-up: stay visible for the first few frames after mount so the
    // meshes' forced first draw (uploadOnFirstDraw at clone creation) can
    // actually happen — an object mounted behind the player would otherwise
    // be hidden here before its programs/textures ever reach the GPU.
    if (warmFramesRef.current > 0) {
      warmFramesRef.current--;
      isVisible = true;
    }

    // Set visibility directly on the group ref — no React re-render; only
    // write on actual TRANSITIONS.
    if (groupRef.current && lastVisibleRef.current !== isVisible) {
      lastVisibleRef.current = isVisible;
      groupRef.current.visible = isVisible;
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
    if (animationControl && pooled.mixer && animationControl.dirty) {
      animationControl.dirty = false;
      const cmd = animationControl.pendingCommand;
      if (cmd) {
        const targetAction = getOrCreateAction(cmd.clipName);
        if (targetAction) {
          // Stop the materialized actions to clear the mixer (clips nothing
          // ever played were never bound — there's nothing else to stop)
          pooled.actions.forEach((action) => {
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
    const mixer = pooled.mixer;
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
  };

  useEffect(() => {
    frameUpdaters.add(frameUpdaterRef);
    return () => {
      frameUpdaters.delete(frameUpdaterRef);
    };
  }, []);

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
