// A per-module path: drei 9.87's index re-exports SpotLight, which imports LinearEncoding (removed in three r162).
import { useGLTF } from "@react-three/drei/core/useGLTF";
import { RootState, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { TaskQueue } from "../../utils/task-queue/TaskQueue";
import { framePhaseFromCoords } from "../../utils/utils";
import { warmPrograms } from "../../utils/warmPrograms";
import { ActorAttributes } from "../types";
import { ActorFrameContext, DEFAULT_RENDER_DISTANCE, MAX_COLLIDER_RENDER_DISTANCE, useActorLifecycle } from "./Actor";
import { AnimationPlayer, getOrCreateAction } from "./animationPlayer";
import { createColliders } from "./colliders/collider";
import { BoxCollider, CapsuleCollider, SphereCollider, TrimeshCollider } from "./colliders/Colliders";
import type { ModelColliders } from "./colliders/types";
import { useKinematicMover } from "./kinematicMover";
import {
  acquireModelClone,
  acquirePooledModelClone,
  PooledModelClone,
  reclaimModelClone,
  releaseModelClone,
} from "./modelClonePool";
import { DEFAULT_INTERACT_REACH, type ActorSimulationAttributes, type ModelAttributes } from "./spec";
import { ActorProps, ActorWarmupHooks } from "./spawning/types";
import { createMotionOutput } from "./state/motion";
import { machineHasTrigger } from "./state/runner";
import { MOUSE_RAYCAST_INTERVAL_FRAMES, useMouseEvents } from "./state/useMouseEvents";
import { useStateMachine } from "./state/useStateMachine";

// Animation LOD: mixers pause while frustum-culled and run at half rate past this
// fraction of the render distance; skipped time accumulates (capped) so loops stay continuous.
const ANIM_HALF_RATE_FRACTION = 0.4;
const MAX_ANIM_CATCHUP = 0.5;

const taskQueue = new TaskQueue();

// Debug "E = toggle animations" for instances without a state machine: ONE window
// listener — a listener per instance made every keypress O(spawns).
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

/**
 * THE GLTF ACTOR: a pooled model clone, its colliders, the animation mixer + LOD,
 * and the whole behavior wiring (state machine, mouse events, kinematic body,
 * animation channel) — so an NPC is a spec and a state machine and nothing else.
 * Everything else comes from the actor base. Owners get per-frame work through
 * the `onFrame` prop (`ctx.machine` / `ctx.motion`), never a useFrame.
 */

/** Settable on the spec (the Three-free fields, spec.ts) and overridable per mount; forwarded to every
 *  instance. `body`: "fixed" (default) — colliders from the GLTF; "kinematic" — a body moved by the
 *  machine's motion output (synced: parked at the server's pose); "none" — no colliders. */
export interface ModelActorAttributes extends ActorAttributes, ModelAttributes, ActorSimulationAttributes {}

export interface ModelActorProps extends ActorProps<ModelActorAttributes> {
  /** Body CENTER: ModelActor WRITES it every frame for kinematic bodies; an owner may pass its own ref to read it. */
  positionRef?: React.MutableRefObject<THREE.Vector3>;
  groupRef?: React.MutableRefObject<THREE.Group | null>;
  /** Runs after the machine ticked and before the body moves. */
  onFrame?: (state: RootState, delta: number, ctx: ActorFrameContext) => void;
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
  stateMachine,
  body,
  collider,
  movement = "ground",
  interactReach = DEFAULT_INTERACT_REACH,
  cursorOverride,
  renderDistance = DEFAULT_RENDER_DISTANCE,
  colliderDistance,
  despawnDistance,
  frustumPadding,
  onDestroy,
  collidersNeverMove = true,
  wholeTrimesh = false,
  excludeColliderNames,
  quantization,
  onFrame,
}: ModelActorProps) => {
  const isKinematic = body === "kinematic";
  const ownPositionRef = useRef(new THREE.Vector3(...coordinates));
  const positionRef = ownerPositionRef ?? ownPositionRef;
  const groupRef = useRef<THREE.Group | null>(null);
  const gltf = useGLTF(model);

  // Pool HIT is synchronous; a MISS renders null and builds through the shared queue
  // (same peek-then-queue pattern as <Building>) — otherwise a batch of 20 fresh clones
  // would run 20 full clone pipelines inside one React commit.
  const [pooled, setPooled] = useState<PooledModelClone | null>(() =>
    acquirePooledModelClone(model, quantization),
  );
  useEffect(() => {
    if (pooled) return;
    let cancelled = false;
    const taskId = taskQueue.addTask(
      async () => {
        if (cancelled) return;
        setPooled(acquireModelClone(model, gltf, quantization));
      },
      { at: { x: coordinates[0], z: coordinates[2] } },
    );
    return () => {
      cancelled = true;
      taskQueue.removeTask(taskId);
    };
  }, [pooled, model, gltf, quantization]);

  const machine = useStateMachine(stateMachine, positionRef, groupRef);
  const hasClickTrigger = !!stateMachine && machineHasTrigger(stateMachine, "mouse-left-click");
  const mouse = useMouseEvents(machine, groupRef, {
    reach: interactReach,
    shouldGrowCursor: cursorOverride ?? hasClickTrigger,
    framePhase: framePhaseFromCoords(coordinates[0], coordinates[2], MOUSE_RAYCAST_INTERVAL_FRAMES),
  });
  const localMotion = useRef(createMotionOutput()).current;
  const motion = machine ? machine.motion.out : localMotion;
  const animPlayer = useRef(new AnimationPlayer()).current;

  const animDeltaRef = useRef(0);
  // Half-rate parity is phase-offset per instance, or a whole batch skips the same frames.
  const animFrameParityRef = useRef(framePhaseFromCoords(coordinates[0], coordinates[2], 2) === 1);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [colliders, setColliders] = useState<ModelColliders | null>(null);

  const hasColliders =
    colliders !== null &&
    colliders.capsuleColliders.length +
      colliders.sphereColliders.length +
      colliders.boxColliders.length +
      colliders.trimeshColliders.length >
      0;

  /** Synced: the SERVER's channel, applied when the DELAYED render clock reaches its change time, so an
   *  idle clip starts exactly as the interpolated body stops. Local: the machine's own channel. */
  const applyAnimationChannel = (clone: PooledModelClone, state: RootState, ctx: ActorFrameContext, serverDriven: boolean): void => {
    if (serverDriven) {
      const anim = ctx.sync!.entity?.remote?.anim;
      if (anim && ctx.syncRenderTime >= anim.changedAt) animPlayer.apply(clone, anim, ctx.syncRenderTime);
    } else if (machine) {
      animPlayer.apply(clone, machine.animation.state, state.clock.elapsedTime * 1000);
    }
  };

  const advanceMixer = (mixer: THREE.AnimationMixer, delta: number, ctx: ActorFrameContext): void => {
    animDeltaRef.current = Math.min(animDeltaRef.current + delta, MAX_ANIM_CATCHUP);
    animFrameParityRef.current = !animFrameParityRef.current;
    const halfRateDistance = renderDistance * ANIM_HALF_RATE_FRACTION;
    const skipFarFrame = ctx.distanceSq > halfRateDistance * halfRateDistance && animFrameParityRef.current;
    if (ctx.visible && !skipFarFrame) {
      mixer.update(animDeltaRef.current);
      animDeltaRef.current = 0;
    }
  };

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
    fadeOut: true,
    // Colliders gate on DISTANCE only: gating on the frustum rebuilt the Rapier
    // colliders every time the player turned around.
    colliderDistance: hasColliders
      ? (colliderDistance ?? Math.min(MAX_COLLIDER_RENDER_DISTANCE, renderDistance / 2))
      : undefined,
    onFrame: (state, delta, ctx) => {
      const dt = Math.min(delta, 0.1);
      const serverDriven = !!ctx.sync && ctx.sync.known;

      // On a synced actor the machine only mirrors: its outputs are overridden by the server's.
      machine?.tick(state, dt, ctx.sync);
      mouse.tick(state.camera, ctx.distanceSq, ctx.sync);
      ctx.machine = machine;
      ctx.motion = motion;
      onFrame?.(state, delta, ctx);
      mover.step(delta, ctx, motion, serverDriven);

      if (!pooled) return;
      applyAnimationChannel(pooled, state, ctx, serverDriven);
      if (pooled.mixer && (machine || serverDriven || isPlaying)) advanceMixer(pooled.mixer, delta, ctx);
    },
  });

  const mover = useKinematicMover({
    // The capsule appears with the model (a pool miss renders nothing until its clone lands).
    enabled: isKinematic && pooled !== null,
    collider,
    movement,
    coordinates,
    positionRef,
    groupRef: lifecycle.groupRef,
  });

  // reclaim/release are StrictMode-safe: the dev remount's cleanup schedules a
  // DEFERRED release that the immediate re-setup cancels.
  useEffect(() => {
    if (!pooled) return;
    reclaimModelClone(pooled);
    lifecycle.resetLife();
    animPlayer.reset(); // a reused clone may be mid-clip from its previous life

    return () => releaseModelClone(pooled);
  }, [pooled]);

  useEffect(() => {
    if (stateMachine || !pooled) return;

    const apply = () => {
      setIsPlaying(manualAnimationsPlaying);
      if (manualAnimationsPlaying) {
        for (const clip of pooled.animations ?? []) {
          const action = getOrCreateAction(pooled, clip.name);
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
  }, [stateMachine, pooled]);

  useEffect(() => {
    const task = async () => {
      try {
        const built = await createColliders(gltf as any, scale, rotation, wholeTrimesh, model, excludeColliderNames);
        setColliders(built);
      } catch (error) {
        console.error("Error creating colliders:", error);
      }
    };

    taskQueue.addTask(task, { at: { x: coordinates[0], z: coordinates[2] } });
  }, [gltf]); // scale/rotation are stable per instance

  if (!pooled) return null;

  const setGroup = (el: THREE.Group | null) => {
    (lifecycle.groupRef as React.MutableRefObject<THREE.Group | null>).current = el;
    groupRef.current = el;
    if (ownerGroupRef) ownerGroupRef.current = el;
  };

  return (
    <Suspense fallback={null}>
      <group ref={setGroup} visible={false} position={coordinates}>
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

/** Load-time program warm-up (utils/warmPrograms.ts): one real clone per (model, quantization) is
 *  drawn once — skinning, morph targets and every material exactly as a spawn draws them — then
 *  parked in the clone pool, so the first spawn also skips the clone pipeline. */
const ModelActorWarmup = ({ descriptor }: { descriptor: Pick<ModelActorAttributes, "model" | "quantization"> }) => {
  const { model, quantization } = descriptor;
  const gltf = useGLTF(model);
  const scene = useThree((state) => state.scene);
  useEffect(() => {
    const clone = acquireModelClone(model, gltf, quantization);
    return warmPrograms(scene, [clone.scene], () => releaseModelClone(clone));
  }, [gltf, model, quantization, scene]);
  return null;
};
ModelActor.Warmup = ModelActorWarmup;
ModelActor.warmupKey = (descriptor: Pick<ModelActorAttributes, "model" | "quantization">) =>
  `${descriptor.model}|${descriptor.quantization ?? "global"}`;

/** Makes a custom wrapper — a component rendering `<ModelActor {...props} onFrame={…} />` — an actor
 *  member (actors/components.ts): it draws the same model, so it reuses ModelActor's load-time warm-up. */
export const withModelActorWarmup = <P,>(Wrapper: React.FC<P>): React.FC<P> & ActorWarmupHooks =>
  Object.assign(Wrapper, { Warmup: ModelActor.Warmup, warmupKey: ModelActor.warmupKey });
