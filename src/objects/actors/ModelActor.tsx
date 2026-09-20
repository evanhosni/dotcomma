import { useGLTF } from "@react-three/drei";
import { Suspense, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { TaskQueue } from "../../utils/task-queue/TaskQueue";
import { framePhaseFromCoords } from "../../utils/utils";
import { createColliders } from "./colliders/collider";
import { BoxCollider, CapsuleCollider, SphereCollider, TrimeshCollider } from "./colliders/Colliders";
import {
  acquireModelClone,
  acquirePooledModelClone,
  PooledModelClone,
  reclaimModelClone,
  releaseModelClone,
} from "./modelClonePool";
import { AnimationControl } from "./state/types";
import { ActorAttributes } from "../types";
import { ActorProps } from "./spawning/types";
import { RootState } from "@react-three/fiber";
import { ActorFrameContext, DEFAULT_RENDER_DISTANCE, MAX_COLLIDER_RENDER_DISTANCE, useActorLifecycle } from "./Actor";
import { getServerTime } from "../../net/connection";
import { INTERP_DELAY_MS } from "../../net/entities/interpolation";
import { useKinematicMover, type ColliderSpec, type MoveIntent } from "./kinematicMover";

export { MAX_COLLIDER_RENDER_DISTANCE };

// Animation LOD: mixers run at half rate past this fraction of renderDistance;
// skipped time accumulates (capped) so loops stay continuous.
const ANIM_HALF_RATE_FRACTION = 0.4;
const MAX_ANIM_CATCHUP = 0.5;

const taskQueue = new TaskQueue();

// Debug "E = toggle animations" for instances without a state machine. ONE
// shared listener — one per instance made every keypress O(spawns).
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

export interface ModelActorAttributes extends ActorAttributes {
  model: string;
  scale?: THREE.Vector3Tuple;
  /** Colliders never move (default true; movers pass false). */
  collidersNeverMove?: boolean;
  /** One trimesh over the whole model instead of per-node colliders. */
  wholeTrimesh?: boolean;
  excludeColliderNames?: string[];
  /** "fixed" (default) = GLTF colliders, never moves; "kinematic" = moved by
   *  the owner's ctx.move intent (synced: parked at the server's pose). */
  body?: "none" | "fixed" | "kinematic";
  /** Kinematic body shape (default capsule r0.5 h2). */
  collider?: ColliderSpec;
  /** Kinematic: "ground" = walkers (gravity, snap, slopes), "free" = flyers. */
  movement?: "ground" | "free";
}

export interface ModelActorProps extends ActorProps<ModelActorAttributes> {
  /** Body CENTER; written every frame by a kinematic ModelActor, unused otherwise. */
  positionRef?: React.MutableRefObject<THREE.Vector3>;
  groupRef?: React.MutableRefObject<THREE.Group | null>;
  animationControl?: AnimationControl;
  /** The one frame callback an owner gets — never add a useFrame in the owner. */
  onFrame?: (state: RootState, delta: number, ctx: ActorFrameContext) => void;
}

interface ColliderState {
  capsuleColliders: any[];
  sphereColliders: any[];
  boxColliders: any[];
  trimeshColliders: any[];
}

export const ModelActor = ({
  model,
  coordinates,
  id,
  descriptorId,
  serverSynced,
  scale = [1, 1, 1],
  rotation = [0, 0, 0],
  positionRef: ownerPositionRef,
  groupRef: ownerGroupRef,
  body,
  collider,
  movement = "ground",
  renderDistance = DEFAULT_RENDER_DISTANCE,
  despawnDistance,
  frustumPadding,
  onDestroy,
  animationControl,
  collidersNeverMove = true,
  wholeTrimesh = false,
  excludeColliderNames,
  quantization,
  onFrame,
}: ModelActorProps) => {
  const staticPositionRef = useRef(new THREE.Vector3(...coordinates));
  const positionRef = ownerPositionRef ?? staticPositionRef;
  const selfPositioned = !ownerPositionRef;
  const gltf = useGLTF(model);

  // Pool HIT is taken synchronously in render; a MISS renders null and builds
  // on the task queue (20 fresh clones in one React commit was a hitch).
  const [pooled, setPooled] = useState<PooledModelClone | null>(() =>
    acquirePooledModelClone(model, quantization),
  );
  useEffect(() => {
    if (pooled) return;
    let cancelled = false;
    taskQueue.addTask(async () => {
      if (cancelled) return;
      setPooled(acquireModelClone(model, gltf, quantization));
    });
    return () => {
      cancelled = true;
    };
  }, [pooled, model, gltf, quantization]);

  const animDeltaRef = useRef(0);
  // Phase-offset per instance, or a whole spawn batch skips mixer updates on the same frames.
  const animFrameParityRef = useRef(framePhaseFromCoords(coordinates[0], coordinates[2], 2) === 1);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [colliders, setColliders] = useState<ColliderState | null>(null);

  // Lazy binding: beeble.glb carries 14 clips (298 tracks) of which 4 ever
  // play; eager binding pushed every unused track through the mixer per instance.
  const getOrCreateAction = (clipName: string): THREE.AnimationAction | null => {
    const mixer = pooled?.mixer;
    if (!pooled || !mixer) return null;
    let action = pooled.actions.get(clipName);
    if (!action) {
      const clip = pooled.animations.find((c: THREE.AnimationClip) => c.name === clipName);
      if (!clip) return null;
      action = mixer.clipAction(clip);
      pooled.actions.set(clipName, action);
    }
    return action;
  };

  const hasColliders =
    colliders !== null &&
    colliders.capsuleColliders.length +
      colliders.sphereColliders.length +
      colliders.boxColliders.length +
      colliders.trimeshColliders.length >
      0;

  // Synced animation is STATE (clip + server start time): every client plays it in phase.
  const syncAnimRef = useRef<AnimationControl>({ pendingCommand: null, dirty: false });
  const syncClipRef = useRef<string | null>(null);
  const syncClipT0Ref = useRef(0);
  const moveIntent = useRef<MoveIntent>({ vx: 0, vy: null, vz: 0 }).current;
  const isKinematic = body === "kinematic";

  const lifecycle = useActorLifecycle({
    id,
    descriptorId,
    serverSynced,
    coordinates,
    positionRef: isKinematic ? positionRef : ownerPositionRef,
    renderDistance,
    despawnDistance,
    onDestroy,
    frustumPadding,
    boundsRadius: pooled ? pooled.baseRadius * Math.max(scale[0], scale[1], scale[2]) : undefined,
    applyFade: (opacity) => {
      if (!pooled) return;
      const mats = pooled.materials;
      for (let i = 0; i < mats.length; i++) {
        mats[i].opacity = opacity;
        mats[i].transparent = opacity < 1;
      }
    },
    // Distance only — gating on the frustum rebuilt the Rapier colliders every time the player turned around.
    colliderDistance: hasColliders
      ? Math.min(MAX_COLLIDER_RENDER_DISTANCE, renderDistance / 2)
      : undefined,
    onFrame: (state, delta, ctx) => {
      // The owner's logic runs on every client; when the server simulates this
      // actor its outputs (intent, animation, transform) are overridden below.
      moveIntent.vx = 0;
      moveIntent.vz = 0;
      moveIntent.vy = null;
      ctx.move = moveIntent;
      onFrame?.(state, delta, ctx);
      const serverDriven = !!ctx.sync && ctx.sync.known;
      mover.step(delta, ctx, moveIntent, serverDriven);

      if (!pooled) return;

      let control: AnimationControl | undefined = animationControl;
      if (serverDriven) {
        if (animationControl) animationControl.dirty = false; // consume, never apply
        // Clip switches on the same DELAYED clock the pose is drawn on, so the
        // idle clip starts exactly as the interpolated body reaches the stop.
        const r = ctx.sync!.entity?.remote;
        const renderTime = getServerTime() - INTERP_DELAY_MS;
        if (
          r &&
          r.clip &&
          (r.clip !== syncClipRef.current || (r.clipT0 ?? 0) !== syncClipT0Ref.current) &&
          (!r.clipT0 || renderTime >= r.clipT0)
        ) {
          syncClipRef.current = r.clip;
          syncClipT0Ref.current = r.clipT0 ?? 0;
          syncAnimRef.current.pendingCommand = {
            clipName: r.clip,
            startTime: r.clipT0 ? Math.max(0, (renderTime - r.clipT0) / 1000) : 0,
            loop: r.once ? THREE.LoopOnce : THREE.LoopRepeat,
            clampWhenFinished: !!r.once,
          };
          syncAnimRef.current.dirty = true;
        }
        control = syncAnimRef.current;
      } else {
        syncClipRef.current = null;
      }

      // Commands are processed even while the mixer itself is LOD-skipped.
      if (control && pooled.mixer && control.dirty) {
        control.dirty = false;
        const cmd = control.pendingCommand;
        if (cmd) {
          const targetAction = getOrCreateAction(cmd.clipName);
          if (targetAction) {
            pooled.actions.forEach((action) => {
              action.stop();
            });
            targetAction.reset();
            if (cmd.startTime) {
              const duration = targetAction.getClip().duration;
              targetAction.time =
                cmd.loop === THREE.LoopOnce ? Math.min(cmd.startTime, duration) : cmd.startTime % duration;
            }
            targetAction.setLoop(cmd.loop ?? THREE.LoopRepeat, Infinity);
            targetAction.timeScale = cmd.timeScale ?? 1.0;
            targetAction.clampWhenFinished = cmd.clampWhenFinished ?? true;
            targetAction.play();
          } else {
            console.error(`animation "${cmd.clipName}" does not exist`);
          }
        }
      }

      const mixer = pooled.mixer;
      if (mixer && (control || isPlaying)) {
        animDeltaRef.current = Math.min(animDeltaRef.current + delta, MAX_ANIM_CATCHUP);
        animFrameParityRef.current = !animFrameParityRef.current;
        const halfRateDistance = renderDistance * ANIM_HALF_RATE_FRACTION;
        const skipFarFrame =
          ctx.distanceSq > halfRateDistance * halfRateDistance && animFrameParityRef.current;
        if (ctx.visible && !skipFarFrame) {
          mixer.update(animDeltaRef.current);
          animDeltaRef.current = 0;
        }
      }
    },
  });

  const mover = useKinematicMover({
    enabled: isKinematic,
    collider,
    movement,
    coordinates,
    positionRef,
    groupRef: lifecycle.groupRef,
  });

  useEffect(() => {
    if (!pooled) return;
    reclaimModelClone(pooled);

    // Also covers the StrictMode reclaim path, where no acquire reset the materials.
    for (const mat of pooled.materials) {
      mat.opacity = 0;
      mat.transparent = true;
    }
    lifecycle.resetLife();

    return () => releaseModelClone(pooled);
  }, [pooled]);

  useEffect(() => {
    if (animationControl || !pooled) return;

    const apply = () => {
      setIsPlaying(manualAnimationsPlaying);
      if (manualAnimationsPlaying) {
        for (const clip of pooled.animations ?? []) {
          const action = getOrCreateAction(clip.name);
          if (action) {
            action.paused = false;
            if (!action.isRunning()) action.play();
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

  useEffect(() => {
    const task = async () => {
      try {
        const built = await createColliders(gltf as any, scale, rotation, wholeTrimesh, model, excludeColliderNames);
        setColliders(built as ColliderState);
      } catch (error) {
        console.error("Error creating colliders:", error);
      }
    };

    taskQueue.addTask(task);
  }, [gltf]); // scale/rotation are stable per instance

  if (!pooled) return null;

  const setGroup = (el: THREE.Group | null) => {
    (lifecycle.groupRef as React.MutableRefObject<THREE.Group | null>).current = el;
    if (ownerGroupRef) ownerGroupRef.current = el;
  };

  return (
    <Suspense fallback={null}>
      {mover.element}
      <group ref={setGroup} visible={false} position={selfPositioned || isKinematic ? coordinates : undefined}>
        <primitive object={pooled.scene} scale={scale} rotation={rotation} />
      </group>
      {body !== "kinematic" && body !== "none" && lifecycle.collidersActive && colliders && (
        <>
          {colliders.capsuleColliders.map((collider, index) => (
            <CapsuleCollider key={index} {...collider} positionRef={positionRef} collidersNeverMove={collidersNeverMove} />
          ))}
          {colliders.sphereColliders.map((collider, index) => (
            <SphereCollider key={index} {...collider} positionRef={positionRef} collidersNeverMove={collidersNeverMove} />
          ))}
          {colliders.boxColliders.map((collider, index) => (
            <BoxCollider key={index} {...collider} positionRef={positionRef} collidersNeverMove={collidersNeverMove} />
          ))}
          {colliders.trimeshColliders.map((collider, index) => (
            <TrimeshCollider key={index} {...collider} positionRef={positionRef} collidersNeverMove={collidersNeverMove} />
          ))}
        </>
      )}
    </Suspense>
  );
};
