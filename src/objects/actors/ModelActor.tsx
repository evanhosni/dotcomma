import { useGLTF } from "@react-three/drei";
import { RootState } from "@react-three/fiber";
import { Suspense, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { TaskQueue } from "../../utils/task-queue/TaskQueue";
import { framePhaseFromCoords } from "../../utils/utils";
import { ActorAttributes } from "../types";
import { ActorFrameContext, DEFAULT_RENDER_DISTANCE, MAX_COLLIDER_RENDER_DISTANCE, useActorLifecycle } from "./Actor";
import { AnimationPlayer, getOrCreateAction } from "./animationPlayer";
import { createColliders } from "./colliders/collider";
import { BoxCollider, CapsuleCollider, SphereCollider, TrimeshCollider } from "./colliders/Colliders";
import { useKinematicMover } from "./kinematicMover";
import {
  acquireModelClone,
  acquirePooledModelClone,
  PooledModelClone,
  reclaimModelClone,
  releaseModelClone,
} from "./modelClonePool";
import type { BodyKind, ColliderSpec, MovementKind } from "./spec";
import { ActorProps } from "./spawning/types";
import { createMotionOutput } from "./state/motion";
import type { StateMachineConfig } from "./state/types";
import { useMouseEvents } from "./state/useMouseEvents";
import { useStateMachine } from "./state/useStateMachine";

export { MAX_COLLIDER_RENDER_DISTANCE };

// Animation LOD: mixers pause while frustum-culled and run at half rate past this
// fraction of the render distance; skipped time accumulates (capped) so loops stay continuous.
const ANIM_HALF_RATE_FRACTION = 0.4;
const MAX_ANIM_CATCHUP = 0.5;
const MOUSE_THROTTLE_FRAMES = 3;

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

/** Settable on the descriptor, forwarded to every instance. The simulation
 *  attributes (stateMachine, body, collider, movement) come from the SPEC via describeActor. */
export interface ModelActorAttributes extends ActorAttributes {
  model: string;
  scale?: THREE.Vector3Tuple;
  /** Default true; movers pass false. */
  collidersNeverMove?: boolean;
  /** One trimesh over the whole model instead of per-node colliders. */
  wholeTrimesh?: boolean;
  excludeColliderNames?: string[];
  /** Synced instances run it on the server and mirror its state here; local ones run it here. */
  stateMachine?: StateMachineConfig;
  /** "fixed" (default) — colliders from the GLTF; "kinematic" — a body moved by the
   *  machine's motion output (synced: parked at the server's pose); "none" — no colliders. */
  body?: BodyKind;
  /** Kinematic body shape (default capsule r0.5 h2). */
  collider?: ColliderSpec;
  /** Kinematic: "ground" (gravity, snap, slopes) or "free" (flyers). */
  movement?: MovementKind;
}

export interface ModelActorProps extends ActorProps<ModelActorAttributes> {
  /** Body CENTER: ModelActor WRITES it every frame for kinematic bodies; an owner may pass its own ref to read it. */
  positionRef?: React.MutableRefObject<THREE.Vector3>;
  groupRef?: React.MutableRefObject<THREE.Group | null>;
  /** Runs after the machine ticked and before the body moves. */
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
  stateMachine,
  body,
  collider,
  movement = "ground",
  cursorOverride,
  renderDistance = DEFAULT_RENDER_DISTANCE,
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
  // (same peek-then-queue pattern as <Building>): a batch of 20 fresh clones used to
  // run 20 full clone pipelines inside one React commit.
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

  const machine = useStateMachine(stateMachine, positionRef, groupRef);
  const hasClickTrigger = !!stateMachine && stateMachine.triggers.some((t) => t.id === "mouse-left-click");
  const mouse = useMouseEvents(machine, groupRef, {
    shouldGrowCursor: cursorOverride ?? hasClickTrigger,
    framePhase: framePhaseFromCoords(coordinates[0], coordinates[2], MOUSE_THROTTLE_FRAMES),
  });
  const localMotion = useRef(createMotionOutput()).current;
  const motion = machine ? machine.motion.out : localMotion;
  const animPlayer = useRef(new AnimationPlayer()).current;

  const animDeltaRef = useRef(0);
  // Half-rate parity is phase-offset per instance, or a whole batch skips the same frames.
  const animFrameParityRef = useRef(framePhaseFromCoords(coordinates[0], coordinates[2], 2) === 1);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [colliders, setColliders] = useState<ColliderState | null>(null);

  const hasColliders =
    colliders !== null &&
    colliders.capsuleColliders.length +
      colliders.sphereColliders.length +
      colliders.boxColliders.length +
      colliders.trimeshColliders.length >
      0;

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
    // Colliders gate on DISTANCE only: gating on the frustum rebuilt the Rapier
    // colliders every time the player turned around.
    colliderDistance: hasColliders
      ? Math.min(MAX_COLLIDER_RENDER_DISTANCE, renderDistance / 2)
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

      // Synced: the SERVER's channel, applied when the DELAYED render clock reaches its
      // change time, so an idle clip starts exactly as the interpolated body stops.
      if (serverDriven) {
        const anim = ctx.sync!.entity?.remote?.anim;
        if (anim && ctx.syncRenderTime >= anim.changedAt) animPlayer.apply(pooled, anim, ctx.syncRenderTime);
      } else if (machine) {
        animPlayer.apply(pooled, machine.animation.state, state.clock.elapsedTime * 1000);
      }

      const mixer = pooled.mixer;
      if (mixer && (machine || serverDriven || isPlaying)) {
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

  // reclaim/release are StrictMode-safe: the dev remount's cleanup schedules a
  // DEFERRED release that the immediate re-setup cancels.
  useEffect(() => {
    if (!pooled) return;
    reclaimModelClone(pooled);

    // Also covers the StrictMode reclaim path, where no acquire reset the materials.
    for (const mat of pooled.materials) {
      mat.opacity = 0;
      mat.transparent = true;
    }
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
    groupRef.current = el;
    if (ownerGroupRef) ownerGroupRef.current = el;
  };

  return (
    <Suspense fallback={null}>
      {mover.element}
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
