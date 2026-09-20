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
 * THE ACTOR BASE (CLAUDE.md → "The three game-object classes"): everything every
 * actor shares lives here, once — a world-wide effect added anywhere else is
 * silently missed by the next actor. Members are <ModelActor> or a direct
 * useActorLifecycle caller (Building).
 */

export const MAX_COLLIDER_RENDER_DISTANCE = 500;
export const DEFAULT_RENDER_DISTANCE = 500;
export const DEFAULT_FRUSTUM_PADDING = 3;
/** Hard-kill distance as a multiple of renderDistance, when none is given. */
export const DESPAWN_DISTANCE_FACTOR = 1.2;
const FADE_DURATION = 1; // seconds

// Collider activation can mount Rapier trimeshes (several ms each), and actors at
// similar distances cross the gate on the same frame — one activation per window.
// A blocked actor retries at its next check; deactivation is never throttled.
const COLLIDER_ACTIVATION_WINDOW_S = 0.05;
let lastColliderActivationTime = -Infinity;

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
 * the other two chain onto it; each patcher is idempotent. The skips are for
 * materials an effect is genuinely wrong for (unlit → no irradiance for lamp glow;
 * procedural geometry is off the quantization lattice). Curvature has no skip.
 */
export const prepareActorMaterial = (
  material: THREE.Material,
  options: { quantization?: number; skipQuantization?: boolean; skipLampGlow?: boolean } = {},
): void => {
  if (!options.skipQuantization) _quantization.patchMaterial(material, options.quantization);
  if (!options.skipLampGlow) patchStandardMaterialLampGlow(material);
  _curvature.patchMaterial(material);
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
  /** Receives the opacity ONLY when it changed. */
  applyFade?: (opacity: number) => void;
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
}

export interface ActorLifecycle {
  /** Attach to the actor's root <group>: visibility and matrix freezing are written through it. */
  groupRef: React.RefObject<THREE.Group>;
  collidersActive: boolean;
  nearActive: boolean;
  distanceSqRef: React.MutableRefObject<number>;
  destroyedRef: React.MutableRefObject<boolean>;
  sync: SyncHandle | null;
  /** Re-arm for a fresh life. Pooled clones carry the previous life's opacity. */
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
  applyFade,
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
  const fadeRef = useRef({ opacity: 0, fadingOut: false });
  const appliedOpacityRef = useRef(-1);
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

  const frameUpdaterRef = useRef<ActorFrameUpdater>(() => {});
  frameUpdaterRef.current = (state, delta) => {
    // onDestroy fires ONCE: re-firing until the pool unmounts us rewrote the
    // respawn-block timestamp every frame and delayed the respawn cooldown.
    if (destroyedRef.current) return;

    const position = positionRef?.current ?? staticPosition;
    const distanceSq = getDistance2DSq(state.camera.position, position);
    distanceSqRef.current = distanceSq;

    if (distanceSq > killDistanceSq) {
      destroyedRef.current = true;
      onDestroy(id);
      return;
    }

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
      if (fade.opacity !== appliedOpacityRef.current) {
        appliedOpacityRef.current = fade.opacity;
        applyFade(fade.opacity);
      }
    }

    let visible = true;
    if (boundsRadius !== undefined) {
      boundsRef.center.copy(position);
      boundsRef.radius = paddedBoundsRadius;
      visible = frustum.intersectsSphere(boundsRef) || distanceSq < closeThresholdSq;
      if (forceVisibleFramesRef.current > 0) {
        forceVisibleFramesRef.current--;
        visible = true;
      }
      if (groupRef.current && lastVisibleRef.current !== visible) {
        lastVisibleRef.current = visible;
        groupRef.current.visible = visible;
      }
    }

    // matrixWorldAutoUpdate = false stops the renderer's per-frame updateMatrixWorld
    // from descending into the subtree; the near gate re-enables it, which covers
    // every dynamic case (hinges, children, collider mounts, raycasts).
    const group = groupRef.current;
    if (freezeMatrices && group && !matricesFrozenRef.current) {
      matricesFrozenRef.current = true;
      group.updateWorldMatrix(true, true);
      group.matrixAutoUpdate = false;
      group.matrixWorldAutoUpdate = false;
    }

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
        if (freezeMatrices && group && matricesFrozenRef.current) group.matrixWorldAutoUpdate = near;
        if (near !== nearActiveRef.current) {
          nearActiveRef.current = near;
          setNearActive(near);
        }
      }
    }

    // Snapshot interpolation (net/entities/interpolation.ts): drawn as it was
    // INTERP_DELAY_MS ago on the SERVER clock — arrival time plays no part, so
    // hitches and bunched packets cannot overshoot or slide.
    const synced = !!sync && sync.known;
    if (synced) playback.sample(sync.entity!, delta, sync.target);
    else playback.reset();

    onFrame?.(state, delta, { distanceSq, gatesChecked: checked, visible, sync, syncRenderTime: playback.renderTime });

    // The server's pose wins over anything the component's logic wrote.
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
    forceVisibleFramesRef.current = forceVisibleFrames;
    destroyedRef.current = false;
  }).current;

  return { groupRef, collidersActive, nearActive, distanceSqRef, destroyedRef, resetLife, sync };
};
