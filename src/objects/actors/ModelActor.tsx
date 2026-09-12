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

// Animation LOD: mixers pause while frustum-culled and run at half rate past
// this fraction of the render distance. Skipped time accumulates (capped) so
// looping animations stay continuous when the object reappears.
const ANIM_HALF_RATE_FRACTION = 0.4;
const MAX_ANIM_CATCHUP = 0.5;
const MOUSE_THROTTLE_FRAMES = 3;

const taskQueue = new TaskQueue();

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

/**
 * THE GLTF ACTOR: a model at a spawn point — and, when its spec gives it one,
 * a BEHAVIOR. Extends the actor base (./Actor.tsx): fade, hard-kill, frustum
 * culling, collider gating, warm-up, multiplayer placement and the shared
 * frame driver all come from useActorLifecycle. This component adds what is
 * GLTF-specific — the pooled model clone, its colliders, the animation mixer
 * + LOD — and OWNS the whole behavior wiring, so an NPC is a descriptor and a
 * state machine and nothing else:
 *
 *   - `stateMachine`: the runner (useStateMachine) and its mouse events
 *     (useMouseEvents), ticked from the ONE frame callback the base hands us;
 *   - `body: "kinematic"`: the capsule + the shared character resolver
 *     (kinematicMover.tsx), driven by the machine's `ctx.motion` output;
 *   - animation: the machine's `ctx.animation` channel applied to the mixer
 *     (animationPlayer.ts) — the SERVER's published channel state for synced
 *     actors, in phase on the delayed render clock; the local runner's for
 *     `serverSynced={false}` ones.
 *
 * A custom component built on <ModelActor> (one that needs its own scene
 * logic) still gets everything above; it passes `onFrame` for extra per-frame
 * work and reads `ctx.machine` / `ctx.motion` there. Base attribute types
 * live in objects/types.ts.
 */

/** Attributes of GLTF-model actors — settable on the descriptor, forwarded to
 *  every instance. The simulation ones (stateMachine, body, collider,
 *  movement) come from the actor's SPEC (./spec.ts) via describeActor. */
export interface ModelActorAttributes extends ActorAttributes {
  /** GLTF path (also preloaded by the pool). */
  model: string;
  /** Render scale, default [1,1,1]. */
  scale?: THREE.Vector3Tuple;
  /** Colliders never move (default true; movers pass false). */
  isStatic?: boolean;
  /** One trimesh over the whole model instead of per-node colliders. */
  wholeTrimesh?: boolean;
  /** GLTF node names to skip when building colliders. */
  excludeColliderNames?: string[];
  /** The behavior (state/runner.ts contract). Synced instances run it on the
   *  server and mirror its state here; local ones run it here. */
  stateMachine?: StateMachineConfig;
  /** How this model exists in the physics world (kinematicMover.tsx):
   *  "fixed" (default) — colliders from the GLTF, never moves;
   *  "kinematic" — a body moved by the state machine's motion output
   *  (synced: parked at the server's pose — the server simulates it);
   *  "none" — no colliders at all. */
  body?: BodyKind;
  /** Kinematic body shape (default capsule r0.5 h2). */
  collider?: ColliderSpec;
  /** Kinematic: "ground" (gravity, snap, slopes — walkers) or "free" (flyers). */
  movement?: MovementKind;
}

export interface ModelActorProps extends ActorProps<ModelActorAttributes> {
  /** Body CENTER position: for body "kinematic" ModelActor WRITES it every
   *  frame; a custom owner may pass its own ref to read it. */
  positionRef?: React.MutableRefObject<THREE.Vector3>;
  /** Receive the model group (bone lookups, custom visuals). */
  groupRef?: React.MutableRefObject<THREE.Group | null>;
  /** Owner's extra per-frame work, run inside the shared actor driver after
   *  the machine ticked and before the body moves — the one place an actor
   *  built on <ModelActor> gets a frame callback. Never add a useFrame in the
   *  owning component instead. */
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
  isStatic = true,
  wholeTrimesh = false,
  excludeColliderNames,
  quantization,
  onFrame,
}: ModelActorProps) => {
  const isKinematic = body === "kinematic";
  // Body CENTER for movers (the mover writes it, the machine reads it);
  // static actors sit at the spawn point.
  const ownPositionRef = useRef(new THREE.Vector3(...coordinates));
  const positionRef = ownerPositionRef ?? ownPositionRef;
  const groupRef = useRef<THREE.Group | null>(null);
  const gltf = useGLTF(model);

  // Prepared clone from the pool — despawn/respawn churn reuses parked clones
  // (materials already patched, mixer bound, bounds measured) instead of
  // re-running the whole clone pipeline per mount. A POOL HIT is taken
  // synchronously during render (the common steady-state case); a MISS —
  // the first N simultaneous mounts of a model — renders null and builds the
  // clone through the shared task queue, the same peek-then-queue pattern as
  // <Building>: a spawn batch of 20 fresh beebles used to run 20 full
  // scene-clone + material-patch + bounds pipelines inside one React commit.
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

  // ── behavior ──────────────────────────────────────────────────────────────
  const machine = useStateMachine(stateMachine, positionRef, groupRef);
  const hasClickTrigger = !!stateMachine && stateMachine.triggers.some((t) => t.id === "mouse-left-click");
  const mouse = useMouseEvents(machine, groupRef, {
    shouldGrowCursor: cursorOverride ?? hasClickTrigger,
    framePhase: framePhaseFromCoords(coordinates[0], coordinates[2], MOUSE_THROTTLE_FRAMES),
  });
  // Motion the mover resolves: the machine's output, or a scratch output a
  // custom owner may write in its onFrame (ctx.motion).
  const localMotion = useRef(createMotionOutput()).current;
  const motion = machine ? machine.motion.out : localMotion;
  const animPlayer = useRef(new AnimationPlayer()).current;

  const animDeltaRef = useRef(0);
  // Half-rate parity is PHASE-OFFSET per instance: starting every actor at
  // `false` made a whole spawn batch run (and skip) its mixer updates on the
  // same frames — the lockstep the codebase's phase-offset rule exists for.
  const animFrameParityRef = useRef(framePhaseFromCoords(coordinates[0], coordinates[2], 2) === 1);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [colliders, setColliders] = useState<ColliderState | null>(null);

  // Whether this instance has colliders at all is known from the (cached)
  // collider result; collider-less models (beeble) skip the gate entirely.
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
    // Until the clone lands nothing renders, so the frustum test is moot.
    boundsRadius: pooled ? pooled.baseRadius * Math.max(scale[0], scale[1], scale[2]) : undefined,
    applyFade: (opacity) => {
      if (!pooled) return;
      const mats = pooled.materials;
      for (let i = 0; i < mats.length; i++) {
        mats[i].opacity = opacity;
        mats[i].transparent = opacity < 1;
      }
    },
    // Colliders gate on DISTANCE only — physics must not depend on where the
    // camera points (gating on the frustum result unmounted and rebuilt the
    // Rapier colliders every time the player turned around).
    colliderDistance: hasColliders
      ? Math.min(MAX_COLLIDER_RENDER_DISTANCE, renderDistance / 2)
      : undefined,
    onFrame: (state, delta, ctx) => {
      const dt = Math.min(delta, 0.1);
      const puppet = !!ctx.sync && ctx.sync.known;

      // Behavior first (machine → motion/animation outputs), mouse events,
      // then the owner's extra work. On a synced actor the machine only
      // mirrors: its outputs are overridden by the server's below.
      machine?.tick(state, dt, ctx.sync);
      mouse.tick(state.camera, ctx.distanceSq, ctx.sync);
      ctx.machine = machine;
      ctx.motion = motion;
      onFrame?.(state, delta, ctx);
      mover.step(delta, ctx, motion, puppet);

      if (!pooled) return;

      // Animation: the channel state → the mixer, on the clock the state's
      // times are expressed in. Synced: the SERVER's channel, applied when
      // the DELAYED render clock reaches its change time, so a beeble's idle
      // clip starts exactly as its interpolated body reaches the spot where
      // the server stopped it — not INTERP_DELAY_MS earlier. Local: the
      // runner's own channel on the local clock the runner was ticked with.
      if (puppet) {
        const anim = ctx.sync!.entity?.remote?.anim;
        if (anim && ctx.syncRenderTime >= anim.changedAt) animPlayer.apply(pooled, anim, ctx.syncRenderTime);
      } else if (machine) {
        animPlayer.apply(pooled, machine.animation.state, state.clock.elapsedTime * 1000);
      }

      // Animation LOD: skinned/keyframe updates are the per-frame CPU cost of
      // animated spawns. Skip entirely while frustum-culled; halve the rate at
      // distance. Delta accumulates so loops stay continuous on reappear.
      const mixer = pooled.mixer;
      if (mixer && (machine || puppet || isPlaying)) {
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

  // The kinematic body (body: "kinematic"): the motion output → movement,
  // puppet → parked at the server's pose (the base places the model). Renders
  // nothing when not kinematic.
  const mover = useKinematicMover({
    enabled: isKinematic,
    collider,
    movement,
    coordinates,
    positionRef,
    groupRef: lifecycle.groupRef,
  });

  // Ownership + per-life reset. Creation-time work (material patching, GPU
  // warm draw, bounds measure) happened in the pool; here we only reset the
  // shared state this life mutates. reclaim/release are StrictMode-safe: the
  // dev remount's cleanup schedules a DEFERRED release that the immediate
  // re-setup cancels, so the clone never changes owner mid-remount.
  useEffect(() => {
    if (!pooled) return;
    reclaimModelClone(pooled);

    // Fade starts invisible each life (also covers the StrictMode reclaim
    // path, where no acquire ran to reset the pooled materials).
    for (const mat of pooled.materials) {
      mat.opacity = 0;
      mat.transparent = true;
    }
    lifecycle.resetLife();
    animPlayer.reset(); // a reused clone may be mid-clip from its previous life

    return () => releaseModelClone(pooled);
  }, [pooled]);

  // E-key animation toggle (only when not driven by a state machine) —
  // subscribes to the ONE shared module-level keydown listener.
  useEffect(() => {
    if (stateMachine || !pooled) return;

    const apply = () => {
      setIsPlaying(manualAnimationsPlaying);
      if (manualAnimationsPlaying) {
        // Materialize + play every clip (original behavior: all clips run
        // together while the debug toggle is on)
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
  }, [gltf]); // scale/rotation omitted: stable per instance, only used for collider creation

  if (!pooled) return null; // clone still building on the queue

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
