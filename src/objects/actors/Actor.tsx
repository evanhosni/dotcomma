import { RootState } from "@react-three/fiber";
import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { patchStandardMaterialLampGlow } from "../../lighting/lampGlow";
import { _quantization } from "../../utils/quantization/quantization";
import { framePhaseFromCoords, getDistance2DSq } from "../../utils/utils";
import { _curvature } from "../../vfx/curvature";
import { PosePlayback } from "../../net/entities/posePlayback";
import { useSyncedEntity, type SyncHandle } from "../../net/entities/useSyncedEntity";
import type { MotionOutput } from "./state/motion";
import type { StateMachineHandle } from "./state/useStateMachine";

/**
 * ACTOR — the base of the per-object class of the game-object hierarchy (see
 * objects/types.ts for the class overview).
 *
 * An actor is a thing with its own identity, state, or interaction — a beeble,
 * a building — mounted as its own React component by the spawn lifecycle
 * (objects/actors/spawning/ActorPool.tsx). Every actor, whether its content is a
 * GLTF model or procedural geometry, gets the SAME behavior from this file:
 *
 *   - ONE shared frame driver for every mounted actor (no useFrame per
 *     instance), with the view frustum computed exactly once per frame;
 *   - the single 2D squared camera distance that drives everything else;
 *   - render-distance fade and the hard-kill despawn;
 *   - frustum visibility, with a mount warm-up window;
 *   - distance-gated colliders (with hysteresis and a global activation
 *     throttle, so several actors can't stack Rapier builds on one frame);
 *   - a second "near" gate for dynamic content (children, interiors);
 *   - matrix freezing for static actors;
 *   - MULTIPLAYER SYNC (net/entities): every actor registers as a synced
 *     entity (unless the mount sets serverSynced={false}) and the SERVER runs
 *     its state machine — no client is authoritative, none is favored. The
 *     base samples the server's published track by snapshot interpolation
 *     (net/entities/posePlayback.ts) into a per-frame target, places the
 *     group there, and hands the sync handle to the component's onFrame so
 *     ModelActor can mirror the server's state/clip and forward clicks.
 *     Components never branch on any of it.
 *   - and prepareActorMaterial: ALL shared material logic in one call.
 *
 * There are two ways to build on it, and both are "extending Actor":
 *   - <ModelActor> (actors/ModelActor.tsx) — the standard GLTF actor. Most
 *     actors just render one of these.
 *   - useActorLifecycle — the hook underneath it, for actors that own their
 *     geometry and render shape (Building). They get identical lifecycle
 *     behavior without being forced into a fixed render tree.
 *
 * Anything shared by more than one actor belongs HERE, not in an actor
 * folder. That is the whole point of the class: when a world-wide effect
 * arrives (curvature, quantization, lamp glow), it is added once here and
 * every actor has it.
 */

export const MAX_COLLIDER_RENDER_DISTANCE = 500;
export const DEFAULT_RENDER_DISTANCE = 500;
export const DEFAULT_FRUSTUM_PADDING = 3;
/** Hard-kill distance as a multiple of renderDistance, when none is given. */
export const DESPAWN_BUFFER = 1.2;
const FADE_DURATION = 1; // seconds

// At most one actor may ACTIVATE colliders per window when it opts into the
// throttle: activation can mount Rapier trimeshes (a QBVH build over the
// exterior triangles, several ms each), and actors sitting at similar
// distances cross the gate on the same frame — stacking those builds was a
// visible lag spike. A blocked actor simply retries at its next distance
// check. Deactivation is cheap and never throttled.
const COLLIDER_ACTIVATION_WINDOW_S = 0.05;
let lastColliderActivationTime = -Infinity;

// ── Shared frame driver ─────────────────────────────────────────────────────
// ONE frame subscriber for ALL mounted actors (driven by ActorPool's
// useFrame) instead of a useFrame per instance: with hundreds of actors up,
// per-instance hooks meant that many R3F subscriber invocations and
// subscription churn on every spawn batch. Instances register a "latest
// closure" ref; the driver refreshes the shared frustum once, then runs each
// updater.

type ActorFrameUpdater = (state: RootState, delta: number) => void;
const frameUpdaters = new Set<React.MutableRefObject<ActorFrameUpdater>>();
const frustum = new THREE.Frustum();
const projScreenMatrix = new THREE.Matrix4();

/** Runs every mounted actor's per-frame work. Called once per frame from
 *  ActorPool's frame loop — which <Domain> always mounts, so any actor
 *  inside a domain tree is driven. */
export const driveActorFrames = (state: RootState, delta: number): void => {
  if (frameUpdaters.size === 0) return;
  projScreenMatrix.multiplyMatrices(state.camera.projectionMatrix, state.camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projScreenMatrix);
  for (const updater of frameUpdaters) updater.current(state, delta);
};

// ── Shared material logic ───────────────────────────────────────────────────

/**
 * ALL shared material logic for the actor class — every material an actor
 * renders with goes through this one call, so an actor never has to know
 * which world-wide effects exist:
 *
 *   - QUANTIZATION   (utils/quantization): the global vertex-wobble lattice,
 *     or a per-actor grid override.
 *   - LAMP GLOW      (lighting/lampGlow): actors near a street lamp brighten
 *     like the terrain and buildings do (grid lookup, no real lights).
 *   - WORLD CURVATURE (vfx/curvature): actors sink with the ground they stand
 *     on past the flat zone.
 *
 * Order matters and is fixed here: quantization REPLACES the project_vertex
 * include, the other two CHAIN onto whatever came before. Each patcher is
 * idempotent, so calling this twice on a shared material is free.
 *
 * The two skips exist because an effect can be genuinely wrong for a
 * material, not as an escape hatch: an UNLIT material has no irradiance for
 * lamp glow to join, and procedural actors are not on the quantization
 * lattice. Curvature has no skip — a game object that doesn't curve floats
 * off the world.
 */
export const prepareActorMaterial = (
  material: THREE.Material,
  options: { quantization?: number; skipQuantization?: boolean; skipLampGlow?: boolean } = {},
): void => {
  if (!options.skipQuantization) _quantization.patchMaterial(material, options.quantization);
  if (!options.skipLampGlow) patchStandardMaterialLampGlow(material);
  _curvature.patchMaterial(material);
};

// ── Lifecycle ───────────────────────────────────────────────────────────────

export interface ActorLifecycleOptions {
  /** Spawn id — passed back to onDestroy. */
  id: string;
  /** Actor descriptor id ("beeble") — the server picks the simulation by it. */
  descriptorId?: string;
  /** Default true. False = this instance is purely local (never registered). */
  serverSynced?: boolean;
  /** Spawn position. Static actors need nothing else; movers pass positionRef. */
  coordinates: THREE.Vector3Tuple;
  /** Live position for actors that move (beebles). Falls back to coordinates. */
  positionRef?: React.MutableRefObject<THREE.Vector3>;
  renderDistance?: number;
  /** Hard-kill distance. Default renderDistance × DESPAWN_BUFFER. */
  despawnDistance?: number;
  onDestroy: (id: string) => void;

  /** Frames between gate evaluations (fade and the kill check always run every
   *  frame). Phase-offset per instance from the spawn coordinates, so a batch
   *  of actors mounted together never checks in lockstep. Default 1. */
  checkInterval?: number;

  /** Fade in on mount / out at the render edge, and kill when it reaches 0.
   *  `applyFade` receives the opacity ONLY when it changed. */
  applyFade?: (opacity: number) => void;

  /** Bounding radius for the frustum visibility test; omit to skip the test
   *  (actors whose own meshes cull themselves). Writes groupRef.visible. */
  boundsRadius?: number;
  frustumPadding?: number;
  /** Frames to force-visible after mount so a mount-time warm draw can
   *  actually happen (see utils/uploadOnFirstDraw). Default 3. */
  warmFrames?: number;

  /** Distance inside which colliders should be mounted; omit for no gate. */
  colliderDistance?: number;
  /** Extra distance retained once active, so the gate can't flicker. */
  gateHysteresis?: number;
  /** Stagger collider ACTIVATION against other actors (heavy trimesh builds). */
  throttleColliderActivation?: boolean;

  /** Distance inside which dynamic content (children, interiors, doors) is
   *  live; omit for no gate. Uses the same hysteresis. */
  nearDistance?: number;

  /** Static actors: freeze the group's matrix subtree once it has valid world
   *  matrices, and unfreeze it while inside nearDistance. Hundreds of static
   *  actors otherwise pay compose() per Object3D per frame. */
  freezeMatrices?: boolean;

  /** Feature-specific per-frame work, run inside the shared driver (never a
   *  useFrame of your own). Skipped once the actor has been destroyed. */
  onFrame?: (state: RootState, delta: number, ctx: ActorFrameContext) => void;
}

export interface ActorFrameContext {
  /** 2D squared camera distance — the same one the gates used this frame. */
  distanceSq: number;
  /** The sync handle, or null when serverSynced={false}. Components rarely
   *  need it: their logic runs on every client and the base handles the rest. */
  sync: SyncHandle | null;
  /** The delayed server time this frame is drawn at (snapshot interpolation);
   *  NaN while unsynced. Anything keyed to the server clock (clip switches)
   *  applies against this, not against raw server time. */
  syncRenderTime: number;
  /** ModelActor: the state machine driving this actor (null without one). */
  machine?: StateMachineHandle | null;
  /** ModelActor: the motion output the kinematic mover resolves this frame —
   *  the machine's, or a scratch output a custom owner writes. */
  motion?: MotionOutput;
  /** True on frames where the throttled gate checks ran. */
  checked: boolean;
  /** Result of this frame's frustum test (true when the test is disabled). */
  visible: boolean;
}

export interface ActorLifecycle {
  /** Attach to the actor's root <group>: visibility and matrix freezing are
   *  written through it. */
  groupRef: React.RefObject<THREE.Group>;
  /** Mount colliders while true (React state — gates a subtree). */
  collidersActive: boolean;
  /** Mount dynamic content while true (React state). */
  nearActive: boolean;
  /** Latest 2D squared camera distance, for feature code in onFrame. */
  distanceSqRef: React.MutableRefObject<number>;
  /** True once onDestroy has fired — feature code should stop acting. */
  destroyedRef: React.MutableRefObject<boolean>;
  /** The sync handle (replicated state, interactions); null when unsynced. */
  sync: SyncHandle | null;
  /** Re-arm this instance for a fresh life: fade back to invisible, warm-up
   *  window reopened, destroy flag cleared. Actors backed by a POOLED clone
   *  (ModelActor) call this on mount, since the clone's materials carry the
   *  previous life's opacity. */
  resetLife: () => void;
}

/**
 * The shared actor lifecycle. Runs inside the ONE shared frame driver, uses a
 * single 2D squared distance for every decision it makes, and never allocates.
 *
 * Gates are React state (they mount/unmount subtrees); visibility, fade and
 * matrix freezing are ref writes with no re-render.
 */
export const useActorLifecycle = ({
  id,
  descriptorId,
  serverSynced = true,
  coordinates,
  positionRef,
  renderDistance = DEFAULT_RENDER_DISTANCE,
  despawnDistance,
  onDestroy,
  checkInterval = 1,
  applyFade,
  boundsRadius,
  frustumPadding = DEFAULT_FRUSTUM_PADDING,
  warmFrames = 3,
  colliderDistance,
  gateHysteresis = 0,
  throttleColliderActivation = false,
  nearDistance,
  freezeMatrices = false,
  onFrame,
}: ActorLifecycleOptions): ActorLifecycle => {
  const groupRef = useRef<THREE.Group>(null);
  const [collidersActive, setCollidersActive] = useState(false);
  const [nearActive, setNearActive] = useState(false);
  const collidersActiveRef = useRef(false);
  const nearActiveRef = useRef(false);
  const destroyedRef = useRef(false);
  const distanceSqRef = useRef(Infinity);
  const fadeRef = useRef({ opacity: 0, fadingOut: false });
  const appliedOpacityRef = useRef(-1);
  const lastVisibleRef = useRef<boolean | null>(null);
  const warmFramesRef = useRef(warmFrames);
  const matricesFrozenRef = useRef(false);
  const boundsRef = useRef(new THREE.Sphere()).current;
  // Deterministic per-instance phase so a spawn batch's throttled work spreads
  // across frames instead of landing on the same ones.
  const frameRef = useRef(framePhaseFromCoords(coordinates[0], coordinates[2], checkInterval));
  // First evaluation always runs: the seeded phase would otherwise leave a
  // fresh mount ungated for up to checkInterval frames.
  const everCheckedRef = useRef(false);

  // ---- Multiplayer sync (see net/entities) ----
  // Registration and placement are the base's job; the SERVER simulates. The
  // component's onFrame still runs (mouse raycasts, mirrored visuals), then
  // the group is placed at the server's pose so anything local logic wrote
  // to the transform is overridden.
  const sync = useSyncedEntity(serverSynced ? id : null, descriptorId ?? "unknown", coordinates);
  // Snapshot-interpolation playback (render clock + sampler) for this actor.
  const playback = useRef(new PosePlayback()).current;

  // Per-life constants, derived once per RENDER (not per frame) — these run
  // inside the hottest loop in the project, for every mounted actor.
  const killDistance = despawnDistance ?? renderDistance * DESPAWN_BUFFER;
  const killDistanceSq = killDistance * killDistance;
  const renderDistanceSq = renderDistance * renderDistance;
  // Very large actors also pass the frustum test on proximity: the padded-
  // sphere test errs toward VISIBLE, never hiding something the frustum alone
  // would show.
  const closeThreshold = (boundsRadius ?? 0) * 3 * (renderDistance / DEFAULT_RENDER_DISTANCE);
  const closeThresholdSq = closeThreshold * closeThreshold;
  const paddedBoundsRadius = (boundsRadius ?? 0) * frustumPadding;
  // Static actors never move — their position vector is built once.
  const staticPosition = useRef(new THREE.Vector3()).current;
  if (!positionRef) staticPosition.set(coordinates[0], coordinates[1], coordinates[2]);

  // The driver calls this closure, refreshed every render so it always sees
  // current props/state.
  const frameUpdaterRef = useRef<ActorFrameUpdater>(() => {});
  frameUpdaterRef.current = (state, delta) => {
    // onDestroy fires ONCE — re-firing every frame until the pool's next batch
    // actually unmounts us rewrote the despawn-ledger timestamp each frame,
    // delaying the eventual respawn cooldown.
    if (destroyedRef.current) return;

    const position = positionRef?.current ?? staticPosition;
    // The ONE distance for everything below (fade, kill, gates, visibility,
    // and whatever onFrame does) — 2D and squared: heights don't matter at
    // these radii and the values are only ever COMPARED (no sqrt).
    const distanceSq = getDistance2DSq(state.camera.position, position);
    distanceSqRef.current = distanceSq;

    // Hard kill safety net
    if (distanceSq > killDistanceSq) {
      destroyedRef.current = true;
      onDestroy(id);
      return;
    }

    // Fade in/out, and the fade-out kill
    if (applyFade) {
      const fade = fadeRef.current;
      const beyond = distanceSq > renderDistanceSq;
      if (beyond !== fade.fadingOut) fade.fadingOut = beyond;
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
      // Only write when it actually changed — steady-state actors skip it.
      if (fade.opacity !== appliedOpacityRef.current) {
        appliedOpacityRef.current = fade.opacity;
        applyFade(fade.opacity);
      }
    }

    // Frustum visibility (optional)
    let visible = true;
    if (boundsRadius !== undefined) {
      boundsRef.center.copy(position);
      boundsRef.radius = paddedBoundsRadius;
      visible = frustum.intersectsSphere(boundsRef) || distanceSq < closeThresholdSq;
      // Warm-up: stay visible for the first frames after mount so the meshes'
      // forced first draw can happen — an actor mounted behind the player
      // would otherwise be hidden before its programs/textures reach the GPU.
      if (warmFramesRef.current > 0) {
        warmFramesRef.current--;
        visible = true;
      }
      if (groupRef.current && lastVisibleRef.current !== visible) {
        lastVisibleRef.current = visible;
        groupRef.current.visible = visible;
      }
    }

    // Static actors never move: once the subtree has valid world matrices,
    // freeze the root (matrixWorldAutoUpdate = false stops the renderer's
    // per-frame updateMatrixWorld from descending into it). The near gate
    // below re-enables it while the player is close, which covers every
    // dynamic case (hinges, mounted children, collider mounts, raycasts) —
    // those only ever act inside that range.
    const group = groupRef.current;
    if (freezeMatrices && group && !matricesFrozenRef.current) {
      matricesFrozenRef.current = true;
      group.updateWorldMatrix(true, true); // parents + whole subtree, once
      group.matrixAutoUpdate = false;
      group.matrixWorldAutoUpdate = false;
    }

    // Throttled gates
    const checked = !everCheckedRef.current || frameRef.current++ % checkInterval === 0;
    if (checked) {
      everCheckedRef.current = true;

      if (colliderDistance !== undefined) {
        const reach = colliderDistance + (collidersActiveRef.current ? gateHysteresis : 0);
        const should = distanceSq < reach * reach;
        if (should !== collidersActiveRef.current) {
          const time = state.clock.elapsedTime;
          const blocked =
            should &&
            throttleColliderActivation &&
            time - lastColliderActivationTime <= COLLIDER_ACTIVATION_WINDOW_S;
          if (!blocked) {
            if (should && throttleColliderActivation) lastColliderActivationTime = time;
            collidersActiveRef.current = should;
            setCollidersActive(should);
          }
        }
      }

      if (nearDistance !== undefined) {
        const reach = nearDistance + (nearActiveRef.current ? gateHysteresis : 0);
        const near = distanceSq < reach * reach;
        // Near = dynamic content possible → let world matrices update again;
        // far = re-freeze (the subtree's matrices are current at that moment).
        if (freezeMatrices && group && matricesFrozenRef.current) group.matrixWorldAutoUpdate = near;
        if (near !== nearActiveRef.current) {
          nearActiveRef.current = near;
          setNearActive(near);
        }
      }
    }

    // ---- Server pose for this frame (before the component's logic, so a
    // kinematic mover can park its collider on it) ----
    // SNAPSHOT INTERPOLATION (net/entities/interpolation.ts): the entity is
    // drawn as it was INTERP_DELAY_MS ago on the SERVER clock, interpolated
    // between the two published snapshots bracketing that time. Message
    // arrival time plays no part, so main-thread hitches and bunched packets
    // cannot make it overshoot, slide or lurch; a stop is reached exactly
    // where and when the server stopped.
    const synced = !!sync && sync.known;
    if (synced) playback.sample(sync.entity!, delta, sync.target);
    else playback.reset();

    onFrame?.(state, delta, { distanceSq, checked, visible, sync, syncRenderTime: playback.renderTime });

    // ---- Apply the server's pose (after the component's logic ran) ----
    if (synced && group && sync.target.valid) {
      const t = sync.target;
      group.position.set(t.x, t.y, t.z);
      group.rotation.y = t.ry;
    }
  };

  useEffect(() => {
    frameUpdaters.add(frameUpdaterRef);
    return () => {
      frameUpdaters.delete(frameUpdaterRef);
    };
  }, []);

  const resetLife = useRef(() => {
    fadeRef.current.opacity = 0;
    fadeRef.current.fadingOut = false;
    appliedOpacityRef.current = -1;
    warmFramesRef.current = warmFrames;
    destroyedRef.current = false;
  }).current;

  return { groupRef, collidersActive, nearActive, distanceSqRef, destroyedRef, resetLife, sync };
};
