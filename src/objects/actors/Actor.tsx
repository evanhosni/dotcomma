import { RootState } from "@react-three/fiber";
import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { patchStandardMaterialLampGlow } from "../../lighting/lampGlow";
import { _quantization } from "../../utils/quantization/quantization";
import { framePhaseFromCoords, getDistance2DSq } from "../../utils/utils";
import { _curvature } from "../../vfx/curvature";
import { useSyncedEntity, type SyncHandle } from "../../net/entities/useSyncedEntity";
import { getServerTime } from "../../net/connection";
import { advanceRenderClock, INTERP_DELAY_MS, pruneSnapshots, sampleSnapshots, type SampledPose } from "../../net/entities/interpolation";
import type { MoveIntent } from "./kinematicMover";

// THE ACTOR BASE (see CLAUDE.md → objects/actors): everything shared by every
// actor lives here — a world-wide effect is added ONCE in this file.

export const MAX_COLLIDER_RENDER_DISTANCE = 500;
export const DEFAULT_RENDER_DISTANCE = 500;
export const DEFAULT_FRUSTUM_PADDING = 3;
/** Hard-kill distance as a multiple of renderDistance, when none is given. */
export const DESPAWN_DISTANCE_FACTOR = 1.2;
const FADE_DURATION = 1; // seconds

// Collider ACTIVATION can mount Rapier trimeshes (several ms each), and actors
// at similar distances cross the gate on the same frame — stacked builds were
// a visible spike. One activation per window; a blocked actor retries next check.
const COLLIDER_ACTIVATION_WINDOW_S = 0.05;
let lastColliderActivationTime = -Infinity;

// ONE frame subscriber for ALL actors (driven by ActorPool's useFrame). A
// useFrame per instance meant hundreds of subscribers + churn per spawn batch.
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

/** The ONLY place actor materials are patched. Order is fixed: quantization
 *  REPLACES project_vertex, the others chain onto it; each patcher is
 *  idempotent. Skips are for materials where an effect is wrong (unlit → no
 *  irradiance for lamp glow; procedural → off the quantization lattice).
 *  Curvature has no skip: an uncurved object floats off the world. */
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
  /** The server picks the simulation (state machine) by it. */
  descriptorId?: string;
  /** Default true. False = purely local, never registered with the server. */
  serverSynced?: boolean;
  coordinates: THREE.Vector3Tuple;
  /** Live position for actors that move. Falls back to coordinates. */
  positionRef?: React.MutableRefObject<THREE.Vector3>;
  renderDistance?: number;
  /** Default renderDistance × DESPAWN_DISTANCE_FACTOR. */
  despawnDistance?: number;
  onDestroy: (id: string) => void;
  /** Frames between gate evaluations (fade and kill still run every frame). Default 1. */
  checkInterval?: number;
  /** Called ONLY when the opacity changed. */
  applyFade?: (opacity: number) => void;
  /** Omit to skip the frustum test (meshes that cull themselves). */
  boundsRadius?: number;
  frustumPadding?: number;
  /** Frames forced visible after mount so the warm draw can happen (utils/uploadOnFirstDraw). Default 3. */
  forceVisibleFrames?: number;
  /** Omit for no collider gate. */
  colliderDistance?: number;
  /** Extra reach retained once a gate is active, so it can't flicker. */
  gateHysteresis?: number;
  throttleColliderActivation?: boolean;
  /** Gate for dynamic content (children, interiors, doors); omit for none. */
  nearDistance?: number;
  /** Static actors: hundreds of them otherwise pay compose() per Object3D per frame. */
  freezeMatrices?: boolean;
  /** Per-frame work inside the shared driver — never a useFrame of your own. */
  onFrame?: (state: RootState, delta: number, ctx: ActorFrameContext) => void;
}

export interface ActorFrameContext {
  distanceSq: number;
  /** null when serverSynced={false}. */
  sync: SyncHandle | null;
  /** Kinematic movers write this frame's desired velocity here. */
  move?: MoveIntent;
  /** True on frames where the throttled gate checks ran. */
  gatesChecked: boolean;
  /** True when the frustum test is disabled. */
  visible: boolean;
}

export interface ActorLifecycle {
  groupRef: React.RefObject<THREE.Group>;
  collidersActive: boolean;
  nearActive: boolean;
  distanceSqRef: React.MutableRefObject<number>;
  destroyedRef: React.MutableRefObject<boolean>;
  sync: SyncHandle | null;
  /** Pooled-clone actors call this on mount: the clone's materials carry the previous life's opacity. */
  resetLife: () => void;
}

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
  // Phase-offset per instance so a spawn batch's throttled work never lands on the same frames.
  const frameRef = useRef(framePhaseFromCoords(coordinates[0], coordinates[2], checkInterval));
  // Without this the seeded phase leaves a fresh mount ungated for up to checkInterval frames.
  const everCheckedRef = useRef(false);

  const sync = useSyncedEntity(serverSynced ? id : null, descriptorId ?? "unknown", coordinates);
  const renderClockRef = useRef(NaN);
  const sampled = useRef<SampledPose>({ x: 0, y: 0, z: 0, ry: 0, vx: 0, vy: 0, vz: 0 }).current;

  const killDistance = despawnDistance ?? renderDistance * DESPAWN_DISTANCE_FACTOR;
  const killDistanceSq = killDistance * killDistance;
  const renderDistanceSq = renderDistance * renderDistance;
  // Very large actors also pass the frustum test on proximity (errs toward visible).
  const closeThreshold = (boundsRadius ?? 0) * 3 * (renderDistance / DEFAULT_RENDER_DISTANCE);
  const closeThresholdSq = closeThreshold * closeThreshold;
  const paddedBoundsRadius = (boundsRadius ?? 0) * frustumPadding;
  const staticPosition = useRef(new THREE.Vector3()).current;
  if (!positionRef) staticPosition.set(coordinates[0], coordinates[1], coordinates[2]);

  const frameUpdaterRef = useRef<ActorFrameUpdater>(() => {});
  frameUpdaterRef.current = (state, delta) => {
    // onDestroy fires ONCE: re-firing until the pool unmounts us rewrote the
    // despawn-ledger timestamp every frame and delayed the respawn cooldown.
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
      // An actor mounted behind the player would otherwise be culled before
      // its forced first draw uploads programs/textures.
      if (forceVisibleFramesRef.current > 0) {
        forceVisibleFramesRef.current--;
        visible = true;
      }
      if (groupRef.current && lastVisibleRef.current !== visible) {
        lastVisibleRef.current = visible;
        groupRef.current.visible = visible;
      }
    }

    // matrixWorldAutoUpdate = false stops the renderer descending into the
    // subtree. The near gate re-enables it up close, which covers every dynamic
    // case (hinges, children, collider mounts, raycasts act only in that range).
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
    // hitches and bunched packets can't overshoot or slide. Sampled BEFORE
    // onFrame so a kinematic mover can park its collider on the pose.
    const synced = !!sync && sync.known;
    if (synced) {
      const t = sync.target;
      const dtMs = Math.min(delta, 0.25) * 1000;
      renderClockRef.current = advanceRenderClock(renderClockRef.current, dtMs, getServerTime() - INTERP_DELAY_MS);
      const snaps = sync.entity!.snapshots;
      pruneSnapshots(snaps, renderClockRef.current);
      const status = sampleSnapshots(snaps, renderClockRef.current, sampled);
      if (status !== "none") {
        t.x = sampled.x;
        t.y = sampled.y;
        t.z = sampled.z;
        t.ry = sampled.ry;
        t.vx = sampled.vx;
        t.vy = sampled.vy;
        t.vz = sampled.vz;
        t.valid = true;
      }
    } else {
      renderClockRef.current = NaN;
    }

    onFrame?.(state, delta, { distanceSq, gatesChecked: checked, visible, sync });

    // After onFrame, so the server's pose overrides anything local logic wrote.
    if (sync && group) {
      if (group.userData.sync !== sync) group.userData.sync = sync;
      if (synced && sync.target.valid) {
        const t = sync.target;
        group.position.set(t.x, t.y, t.z);
        group.rotation.y = t.ry;
      }
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
