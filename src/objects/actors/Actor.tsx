import { RootState } from "@react-three/fiber";
import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { patchStandardMaterialLampGlow } from "../../lighting/lampGlow";
import { _quantization } from "../../vfx/quantization";
import { framePhaseFromCoords, getDistance2DSq, stopMatrixUpdatesWhenFrozen } from "../../utils/utils";
import { _curvature } from "../../vfx/curvature";
import { _spawnFade } from "../../vfx/spawnFade";
import { PosePlayback } from "../../net/entities/posePlayback";
import { useSyncedEntity, type PuppetTarget, type SyncHandle } from "../../net/entities/useSyncedEntity";
import type { MotionOutput } from "./state/motion";
import type { StateMachineHandle } from "./state/useStateMachine";

/**
 * THE ACTOR BASE (CLAUDE.md → "The three game-object classes"): everything every
 * actor shares lives here, once — a world-wide effect added anywhere else is
 * silently missed by the next actor. Members are <ModelActor> or a direct
 * useActorLifecycle caller (Building).
 */

export const MAX_COLLIDER_RENDER_DISTANCE = 500;
export const DEFAULT_RENDER_DISTANCE = 500;
export const DEFAULT_FRUSTUM_PADDING = 3;
/** Hard-kill distance as a multiple of renderDistance, when none is given. */
const DESPAWN_DISTANCE_FACTOR = 1.2;

// Collider activation can mount Rapier trimeshes (several ms each), and actors at
// similar distances cross the gate on the same frame — one activation per window.
// A blocked actor retries at its next check; deactivation is never throttled.
const COLLIDER_ACTIVATION_WINDOW_S = 0.05;
let lastColliderActivationTime = -Infinity;

/** A distance gate with hysteresis: once active it holds out to `gateDistance + hysteresis`, so it can't flicker. */
export const withinGate = (distanceSq: number, gateDistance: number, active: boolean, hysteresis: number): boolean => {
  const reach = gateDistance + (active ? hysteresis : 0);
  return distanceSq < reach * reach;
};

// ONE frame subscriber for every mounted actor (driven by ActorPool's useFrame):
// per-instance useFrames were hundreds of subscribers plus churn per spawn batch.
type ActorFrameUpdater = (state: RootState, delta: number) => void;
const frameUpdaters = new Set<React.MutableRefObject<ActorFrameUpdater>>();
const frustum = new THREE.Frustum();
const projScreenMatrix = new THREE.Matrix4();

export const driveActorFrames = (state: RootState, delta: number): void => {
  if (frameUpdaters.size === 0) return;
  projScreenMatrix.multiplyMatrices(state.camera.projectionMatrix, state.camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projScreenMatrix);
  for (const updater of frameUpdaters) updater.current(state, delta);
};

/**
 * The ONLY place actor materials are patched. Quantization REPLACES project_vertex,
 * the others chain onto it; each patcher is idempotent. The skips are for
 * materials an effect is genuinely wrong for (unlit → no irradiance for lamp glow;
 * procedural geometry is off the quantization lattice). Curvature and the spawn fade
 * have no skip. `perInstanceSpawnFade`: one mesh drawing many actors' parts (the far doors).
 */
export const prepareActorMaterial = (
  material: THREE.Material,
  options: { quantization?: number; skipQuantization?: boolean; skipLampGlow?: boolean; perInstanceSpawnFade?: boolean } = {},
): void => {
  if (!options.skipQuantization) _quantization.patchMaterial(material, options.quantization);
  if (!options.skipLampGlow) patchStandardMaterialLampGlow(material);
  _curvature.patchMaterial(material);
  _spawnFade.patchMaterial(material, { perInstance: options.perInstanceSpawnFade });
};

export interface ActorLifecycleOptions {
  id: string;
  /** The server picks the simulation by it. */
  descriptorId?: string;
  /** Default true. False = purely local, never registered. */
  serverSynced?: boolean;
  coordinates: THREE.Vector3Tuple;
  /** Live position for actors that move. Falls back to coordinates. */
  positionRef?: React.MutableRefObject<THREE.Vector3>;
  renderDistance?: number;
  /** Default renderDistance × DESPAWN_DISTANCE_FACTOR. */
  despawnDistance?: number;
  onDestroy: (id: string) => void;
  /** Frames between gate evaluations (fade and kill run every frame). Default 1. */
  checkInterval?: number;
  /** Dither OUT past renderDistance (then self-destroy) instead of popping at despawnDistance. Every
   *  actor dithers IN when its group first appears (vfx/spawnFade.ts). */
  fadeOut?: boolean;
  /** Omit to skip the frustum test (meshes that cull themselves). */
  boundsRadius?: number;
  frustumPadding?: number;
  /** Frames held visible after mount so the uploadOnFirstDraw warm draw can happen. Default 3. */
  forceVisibleFrames?: number;
  colliderDistance?: number;
  /** Extra distance retained once a gate is active, so it can't flicker. */
  gateHysteresis?: number;
  throttleColliderActivation?: boolean;
  /** Distance inside which dynamic content (children, interiors, doors) is live. */
  nearDistance?: number;
  /** Static actors: freeze the matrix subtree, unfreeze inside nearDistance. */
  freezeMatrices?: boolean;
  /** Per-frame work inside the shared driver — never a useFrame of your own. */
  onFrame?: (state: RootState, delta: number, ctx: ActorFrameContext) => void;
}

export interface ActorFrameContext {
  /** 2D squared camera distance — the one the gates used this frame. */
  distanceSq: number;
  /** Null when serverSynced={false}. */
  sync: SyncHandle | null;
  /** The delayed server time this frame is drawn at; NaN while unsynced. Anything
   *  keyed to the server clock (clip switches) applies against this. */
  syncRenderTime: number;
  machine?: StateMachineHandle | null;
  /** The motion output the kinematic mover resolves this frame. */
  motion?: MotionOutput;
  /** True on frames where the throttled gate checks ran. */
  gatesChecked: boolean;
  /** This frame's frustum result (true when the test is disabled). */
  visible: boolean;
  /** Spawn-fade visibility, 0..1 — for parts drawn outside the group (a building's far doors). */
  spawnFade: number;
}

export interface ActorLifecycle {
  /** Attach to the actor's root <group>: visibility and matrix freezing are written through it. */
  groupRef: React.RefObject<THREE.Group>;
  collidersActive: boolean;
  nearActive: boolean;
  distanceSqRef: React.MutableRefObject<number>;
  destroyedRef: React.MutableRefObject<boolean>;
  sync: SyncHandle | null;
  /** Re-arm for a fresh life: fades in again. */
  resetLife: () => void;
}

/** Runs inside the shared driver, one 2D squared distance per frame, no allocation.
 *  Gates are React state (they mount subtrees); visibility, fade and freezing are ref writes. */
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
  fadeOut = false,
  boundsRadius,
  frustumPadding = DEFAULT_FRUSTUM_PADDING,
  forceVisibleFrames = 3,
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
  const spawnFade = useRef(new _spawnFade.SpawnFade()).current;
  const fadeRef = useRef({ started: false, fadingOut: false });
  const lastVisibleRef = useRef<boolean | null>(null);
  const forceVisibleFramesRef = useRef(forceVisibleFrames);
  const matricesFrozenRef = useRef(false);
  const boundsRef = useRef(new THREE.Sphere()).current;
  // Per-instance phase so a spawn batch's throttled work spreads across frames.
  const frameRef = useRef(framePhaseFromCoords(coordinates[0], coordinates[2], checkInterval));
  // The seeded phase would otherwise leave a fresh mount ungated for up to checkInterval frames.
  const everCheckedRef = useRef(false);

  const sync = useSyncedEntity(serverSynced ? id : null, descriptorId ?? "unknown", coordinates);
  const playback = useRef(new PosePlayback()).current;
  // One per actor, rewritten every frame: hundreds of actors allocated one each per frame.
  const frameCtx = useRef<ActorFrameContext>({
    distanceSq: Infinity,
    gatesChecked: false,
    visible: true,
    sync: null,
    syncRenderTime: NaN,
    spawnFade: 1,
  }).current;

  // Per-life constants derived per RENDER, not per frame — this is the hottest loop in the project.
  const killDistance = despawnDistance ?? renderDistance * DESPAWN_DISTANCE_FACTOR;
  const killDistanceSq = killDistance * killDistance;
  const renderDistanceSq = renderDistance * renderDistance;
  // Very large actors also pass the frustum test on proximity — errs toward VISIBLE.
  const closeThreshold = (boundsRadius ?? 0) * 3 * (renderDistance / DEFAULT_RENDER_DISTANCE);
  const closeThresholdSq = closeThreshold * closeThreshold;
  const paddedBoundsRadius = (boundsRadius ?? 0) * frustumPadding;
  const staticPosition = useRef(new THREE.Vector3()).current;
  if (!positionRef) staticPosition.set(coordinates[0], coordinates[1], coordinates[2]);

  const destroy = (): void => {
    destroyedRef.current = true;
    onDestroy(id);
  };

  /** The fade starts when the group first exists (a Building or a pool-miss ModelActor renders null until
   *  its assets land) and before its first draw: useFrame precedes render. A `fadeOut` actor dithers out
   *  past renderDistance and is destroyed once gone. Returns this frame's visibility. */
  const advanceSpawnFade = (fadeRoot: THREE.Group, distanceSq: number): number => {
    const fade = fadeRef.current;
    spawnFade.setRoot(fadeRoot);
    if (!fade.started) {
      fade.started = true;
      spawnFade.fadeIn(0);
    }
    if (fadeOut) {
      const beyond = distanceSq > renderDistanceSq;
      if (beyond !== fade.fadingOut) {
        fade.fadingOut = beyond;
        if (beyond) spawnFade.fadeOut();
        else spawnFade.fadeIn();
      }
    }
    if (!spawnFade.fading) return 1;
    const visibility = spawnFade.update();
    if (fade.fadingOut && visibility <= 0) destroy();
    return visibility;
  };

  /** The frustum test, held true over the warm-up frames; written to the group only on change. */
  const updateVisibility = (group: THREE.Group | null, position: THREE.Vector3, distanceSq: number): boolean => {
    if (boundsRadius === undefined) return true;
    boundsRef.center.copy(position);
    boundsRef.radius = paddedBoundsRadius;
    let visible = frustum.intersectsSphere(boundsRef) || distanceSq < closeThresholdSq;
    if (forceVisibleFramesRef.current > 0) {
      forceVisibleFramesRef.current--;
      visible = true;
    }
    if (group && lastVisibleRef.current !== visible) {
      lastVisibleRef.current = visible;
      group.visible = visible;
    }
    return visible;
  };

  const updateColliderGate = (distanceSq: number, time: number): void => {
    const should = withinGate(distanceSq, colliderDistance!, collidersActiveRef.current, gateHysteresis);
    if (should === collidersActiveRef.current) return;
    const throttled = should && throttleColliderActivation;
    if (throttled && time - lastColliderActivationTime <= COLLIDER_ACTIVATION_WINDOW_S) return;
    if (throttled) lastColliderActivationTime = time;
    collidersActiveRef.current = should;
    setCollidersActive(should);
  };

  const updateNearGate = (distanceSq: number): void => {
    const near = withinGate(distanceSq, nearDistance!, nearActiveRef.current, gateHysteresis);
    if (near === nearActiveRef.current) return;
    nearActiveRef.current = near;
    setNearActive(near);
  };

  // matrixWorldAutoUpdate = false stops the renderer's per-frame updateMatrixWorld from descending into
  // the subtree; the near gate re-enables it, which covers every dynamic case (hinges, children,
  // collider mounts, raycasts).
  const freezeMatricesOnce = (group: THREE.Group): void => {
    if (matricesFrozenRef.current) return;
    matricesFrozenRef.current = true;
    group.updateWorldMatrix(true, true);
    group.matrixAutoUpdate = false;
    stopMatrixUpdatesWhenFrozen(group);
    group.matrixWorldAutoUpdate = false;
  };

  // A culled actor's subtree (a beeble: ~37 nodes incl. bones) skips the renderer's matrix update too;
  // the frame it turns visible, the update runs before its draw. Frozen actors additionally stay frozen
  // outside the near gate.
  const updateMatrixLiveness = (group: THREE.Group, visible: boolean): void => {
    const live = visible && (!freezeMatrices || !matricesFrozenRef.current || nearActiveRef.current);
    if (group.matrixWorldAutoUpdate === live) return;
    if (!live) stopMatrixUpdatesWhenFrozen(group);
    group.matrixWorldAutoUpdate = live;
  };

  // Written only on change: the rotation setter recomputes the quaternion (trig) and a static actor
  // (every building) holds one pose for its whole life.
  const applyServerPose = (group: THREE.Group, t: PuppetTarget): void => {
    const p = group.position;
    if (p.x !== t.x || p.y !== t.y || p.z !== t.z) p.set(t.x, t.y, t.z);
    if (group.rotation.y !== t.ry) group.rotation.y = t.ry;
  };

  const frameUpdaterRef = useRef<ActorFrameUpdater>(() => {});
  frameUpdaterRef.current = (state, delta) => {
    // onDestroy fires ONCE: re-firing until the pool unmounts us rewrote the
    // respawn-block timestamp every frame and delayed the respawn cooldown.
    if (destroyedRef.current) return;

    const position = positionRef?.current ?? staticPosition;
    const distanceSq = getDistance2DSq(state.camera.position, position);
    distanceSqRef.current = distanceSq;
    if (distanceSq > killDistanceSq) {
      destroy();
      return;
    }

    const group = groupRef.current;
    const fadeVisibility = group ? advanceSpawnFade(group, distanceSq) : 1;
    if (destroyedRef.current) return;

    const visible = updateVisibility(group, position, distanceSq);
    if (freezeMatrices && group) freezeMatricesOnce(group);

    const checked = !everCheckedRef.current || frameRef.current++ % checkInterval === 0;
    if (checked) {
      everCheckedRef.current = true;
      if (colliderDistance !== undefined) updateColliderGate(distanceSq, state.clock.elapsedTime);
      if (nearDistance !== undefined) updateNearGate(distanceSq);
    }

    if (group) updateMatrixLiveness(group, visible);

    // Snapshot interpolation (net/entities/interpolation.ts): drawn as it was
    // INTERP_DELAY_MS ago on the SERVER clock — arrival time plays no part, so
    // hitches and bunched packets cannot overshoot or slide.
    const synced = !!sync && sync.known;
    if (synced) playback.sample(sync.entity!, delta, sync.target);
    else playback.reset();

    if (onFrame) {
      frameCtx.distanceSq = distanceSq;
      frameCtx.gatesChecked = checked;
      frameCtx.visible = visible;
      frameCtx.sync = sync;
      frameCtx.syncRenderTime = playback.renderTime;
      frameCtx.spawnFade = fadeVisibility;
      onFrame(state, delta, frameCtx);
    }

    // The server's pose wins over anything the component's logic wrote.
    if (synced && group && sync.target.valid) applyServerPose(group, sync.target);
  };

  const resetFade = (): void => {
    spawnFade.release();
    fadeRef.current.started = false;
    fadeRef.current.fadingOut = false;
  };

  useEffect(() => {
    frameUpdaters.add(frameUpdaterRef);
    return () => {
      frameUpdaters.delete(frameUpdaterRef);
      // A pooled clone must go back on its base materials.
      resetFade();
    };
  }, []);

  const resetLife = useRef(() => {
    resetFade();
    forceVisibleFramesRef.current = forceVisibleFrames;
    destroyedRef.current = false;
  }).current;

  return { groupRef, collidersActive, nearActive, distanceSqRef, destroyedRef, resetLife, sync };
};
