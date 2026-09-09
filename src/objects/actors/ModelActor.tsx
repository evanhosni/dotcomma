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
import { useKinematicMover, type ColliderSpec, type MoveIntent } from "./kinematicMover";

export { MAX_COLLIDER_RENDER_DISTANCE };

// Animation LOD: mixers pause while frustum-culled and run at half rate past
// this fraction of the render distance. Skipped time accumulates (capped) so
// looping animations stay continuous when the object reappears.
const ANIM_HALF_RATE_FRACTION = 0.4;
const MAX_ANIM_CATCHUP = 0.5;

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

/** The GLTF ACTOR: a model at a spawn point. Extends the actor base (see
 *  ./Actor.tsx) — fade, hard-kill, frustum culling, collider gating, warm-up
 *  and the shared frame driver all come from useActorLifecycle; this component
 *  adds only what is GLTF-specific: the pooled model clone, its colliders, and
 *  the animation mixer + LOD. Base attribute types live in objects/types.ts. */
/** Attributes of GLTF-model actors — settable on the descriptor, forwarded to
 *  every instance. */
export interface ModelActorAttributes extends ActorAttributes {
  /** GLTF path (also preloaded by the pool). */
  model: string;
  /** Render scale, default [1,1,1]. */
  scale?: THREE.Vector3Tuple;
  /** Colliders never move (default true; movers like the beeble pass false). */
  isStatic?: boolean;
  /** One trimesh over the whole model instead of per-node colliders. */
  wholeTrimesh?: boolean;
  /** GLTF node names to skip when building colliders. */
  excludeColliderNames?: string[];
  /** How this model exists in the physics world (kinematicMover.tsx):
   *  "fixed" (default) — colliders from the GLTF, never moves;
   *  "kinematic" — a body ModelActor moves from the owner's ctx.move intent
   *  (and parks at the replicated pose on puppets);
   *  "none" — no colliders at all. */
  body?: "none" | "fixed" | "kinematic";
  /** Kinematic body shape (default capsule r0.5 h2). */
  collider?: ColliderSpec;
  /** Kinematic: "ground" (gravity, snap, slopes — walkers) or "free" (flyers). */
  movement?: "ground" | "free";
}

export interface ModelActorProps extends ActorProps<ModelActorAttributes> {
  /** Body CENTER position: for body "kinematic" ModelActor WRITES it every
   *  frame (state machines read it); otherwise the actor is static at
   *  `coordinates` and this is unused. */
  positionRef?: React.MutableRefObject<THREE.Vector3>;
  /** Receive the model group (state machines rotate it / look up bones). */
  groupRef?: React.MutableRefObject<THREE.Group | null>;
  animationControl?: AnimationControl;
  /** Owner's per-frame work (physics step, state machine, mouse events),
   *  run inside the shared actor driver AFTER the animation LOD — the one
   *  place an actor built on <ModelActor> gets a frame callback. Never add a
   *  useFrame in the owning component instead. */
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
  isStatic = true,
  wholeTrimesh = false,
  excludeColliderNames,
  quantization,
  onFrame,
}: ModelActorProps) => {
  // No owner moving us → static at the spawn point (own ref + own placement).
  const staticPositionRef = useRef(new THREE.Vector3(...coordinates));
  const positionRef = ownerPositionRef ?? staticPositionRef;
  const selfPositioned = !ownerPositionRef;
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

  const animDeltaRef = useRef(0);
  // Half-rate parity is PHASE-OFFSET per instance: starting every actor at
  // `false` made a whole spawn batch run (and skip) its mixer updates on the
  // same frames — the lockstep the codebase's phase-offset rule exists for.
  const animFrameParityRef = useRef(framePhaseFromCoords(coordinates[0], coordinates[2], 2) === 1);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [colliders, setColliders] = useState<ColliderState | null>(null);

  // Actions are created LAZILY by clip name: beeble.glb carries 14 clips
  // (298 tracks) of which the state machine ever plays 4 — eagerly binding
  // every clip put all the unused tracks through the mixer's property-binding
  // graph for every instance. Nothing binds a clip until something plays it.
  // The actions map lives on the pooled record, so a reused clone keeps its
  // already-bound actions.
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

  // Whether this instance has colliders at all is known from the (cached)
  // collider result; collider-less models (beeble) skip the gate entirely.
  const hasColliders =
    colliders !== null &&
    colliders.capsuleColliders.length +
      colliders.sphereColliders.length +
      colliders.boxColliders.length +
      colliders.trimeshColliders.length >
      0;

  // Synced clip → mixer: animation is STATE (clip + server start time), so
  // every client plays the same clip in phase. Owned here, next to the mixer,
  // for EVERY model actor — no actor writes this itself.
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
      // Owner's work first (state machine → velocities → physics), so the
      // animation command it may raise this frame is applied right below.
      // The component's logic runs on every client (mouse raycasts, mirrored
      // visuals); when the SERVER simulates this actor its outputs — move
      // intent, animation commands, transform — are overridden below, so no
      // component ever branches on it.
      moveIntent.vx = 0;
      moveIntent.vz = 0;
      moveIntent.vy = null;
      ctx.move = moveIntent;
      onFrame?.(state, delta, ctx);
      const puppet = !!ctx.sync && ctx.sync.known;
      mover.step(delta, ctx, moveIntent, puppet);

      if (!pooled) return;

      // Animation. Synced: the server's clip, started in phase (server time).
      // Local: the state machine's command stream.
      let control: AnimationControl | undefined = animationControl;
      if (puppet) {
        if (animationControl) animationControl.dirty = false; // consume, never apply
        const r = ctx.sync!.entity?.remote;
        if (r && r.clip && (r.clip !== syncClipRef.current || (r.clipT0 ?? 0) !== syncClipT0Ref.current)) {
          syncClipRef.current = r.clip;
          syncClipT0Ref.current = r.clipT0 ?? 0;
          syncAnimRef.current.pendingCommand = {
            clipName: r.clip,
            startTime: r.clipT0 ? Math.max(0, (getServerTime() - r.clipT0) / 1000) : 0,
            loop: r.once ? THREE.LoopOnce : THREE.LoopRepeat,
            clampWhenFinished: !!r.once,
          };
          syncAnimRef.current.dirty = true;
        }
        control = syncAnimRef.current;
      } else {
        syncClipRef.current = null;
      }

      // Animation commands (cheap — always processed so state changes apply
      // even while the mixer itself is LOD-skipped)
      if (control && pooled.mixer && control.dirty) {
        control.dirty = false;
        const cmd = control.pendingCommand;
        if (cmd) {
          const targetAction = getOrCreateAction(cmd.clipName);
          if (targetAction) {
            // Stop the materialized actions to clear the mixer (clips nothing
            // ever played were never bound — there's nothing else to stop)
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

      // Animation LOD: skinned/keyframe updates are the per-frame CPU cost of
      // animated spawns. Skip entirely while frustum-culled; halve the rate at
      // distance. Delta accumulates so loops stay continuous on reappear.
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

  // The kinematic body (body: "kinematic"): owner intent → movement, puppet →
  // parked at the replicated pose. Renders nothing when not kinematic.
  const mover = useKinematicMover({
    enabled: isKinematic,
    collider,
    movement,
    coordinates,
    positionRef,
    groupRef: lifecycle.groupRef,
  });
  // A mover owns the body: the base must not write the group's position.
  if (lifecycle.sync) lifecycle.sync.bodyManaged = isKinematic;

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

    return () => releaseModelClone(pooled);
  }, [pooled]);

  // E-key animation toggle (only when not driven by a state machine) —
  // subscribes to the ONE shared module-level keydown listener.
  useEffect(() => {
    if (animationControl || !pooled) return;

    const apply = () => {
      setIsPlaying(manualAnimationsPlaying);
      if (manualAnimationsPlaying) {
        // Materialize + play every clip (original behavior: all clips run
        // together while the debug toggle is on)
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
  }, [gltf]); // scale/rotation omitted: stable per instance, only used for collider creation

  if (!pooled) return null; // clone still building on the queue

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
