/**
 * THE ACTOR BASE (CLAUDE.md → "The three game-object classes"): everything every
 * actor shares lives here, once — a world-wide effect added anywhere else is
 * silently missed by the next actor. Members are <ModelActor> or a direct
 * useActorLifecycle caller (Building).
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { frameTimeAt } from "../../animation/utils";
import { framePhaseFromCoords, reportContentError } from "../../utils/utils";
import { getDistance2DSq, stopMatrixUpdatesWhenFrozen } from "../../utils/render/utils";
import { _spawnFade } from "../../vfx/spawn-fade";
import { setSpriteDetail } from "../sprite-lod/store";
import { SPRITE_LOD_HYSTERESIS } from "../sprite-lod/constants";
import { PosePlayback } from "../../net/entities/posePlayback";
import { useSyncedEntity } from "../../net/entities/hooks";
import type { PuppetTarget } from "../../net/entities/types";
import { DEFAULT_RENDER_DISTANCE, DEFAULT_FRUSTUM_PADDING, DESPAWN_DISTANCE_FACTOR, COLLIDER_ACTIVATION_WINDOW_S } from "./constants";
import type { ActorLifecycleOptions, ActorLifecycle, ActorFrameContext, ActorFrameUpdater } from "./types";
import { withinGate, framePhaseMsOf } from "./utils";
import { frustum, frameUpdaters } from "./store";

let lastColliderActivationTime = -Infinity;

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
  spriteHandoffDistance,
  boundsRadius,
  frustumPadding = DEFAULT_FRUSTUM_PADDING,
  forceVisibleFrames = 3,
  colliderDistance,
  gateHysteresis = 0,
  throttleColliderActivation = false,
  nearDistance,
  freezeMatrices = false,
  rotationStep = 0,
  motionFrameRate = 0,
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
  // shown: the fade is headed toward visible. reported: the visibility last told to the sprite (0 = none).
  const fadeRef = useRef({ started: false, shown: false, reported: 0 });
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

  /** Whether the actor should be drawn at this distance: inside its sprite handoff (held past it by the
   *  hysteresis), or for a `fadeOut` actor inside renderDistance. */
  const shownAt = (distanceSq: number, wasShown: boolean): boolean => {
    if (spriteHandoffDistance !== undefined) return withinGate(distanceSq, spriteHandoffDistance, wasShown, SPRITE_LOD_HYSTERESIS);
    return !fadeOut || distanceSq <= renderDistanceSq;
  };

  /** The fade starts when the group first exists (a Building or a pool-miss ModelActor renders null until
   *  its assets land) and before its first draw: useFrame precedes render. It fades in, or starts hidden where
   *  the actor should not be drawn; crossing the boundary fades it out or back in from where it is. Hidden,
   *  a `fadeOut` actor is destroyed and a sprite kind is held (the fade stops advancing). Returns this
   *  frame's visibility. */
  const advanceSpawnFade = (fadeRoot: THREE.Group, distanceSq: number): number => {
    const fade = fadeRef.current;
    spawnFade.setRoot(fadeRoot);
    const shown = shownAt(distanceSq, fade.shown);
    if (!fade.started) {
      fade.started = true;
      fade.shown = shown;
      if (shown) spawnFade.fadeIn(0);
      else spawnFade.hide();
    } else if (shown !== fade.shown) {
      fade.shown = shown;
      if (shown) spawnFade.fadeIn();
      else spawnFade.fadeOut();
    }
    if (!spawnFade.fading) return 1;
    if (!fade.shown && spawnFade.hidden()) {
      if (fadeOut) destroy();
      return 0;
    }
    const visibility = spawnFade.update();
    if (!fade.shown && fadeOut && visibility <= 0) destroy();
    return visibility;
  };

  /** The sprite draws the pixels this actor's fade gives up (objects/sprite-lod/store.ts); an actor without a group
   *  draws nothing, which is the same as no report. */
  const reportSpriteDetail = (visibility: number): void => {
    const fade = fadeRef.current;
    if (visibility === fade.reported) return;
    fade.reported = visibility;
    setSpriteDetail(id, visibility);
  };

  /** The frustum test (when there are bounds), off for a sprite kind fully faded into its sprite, held true over
   *  the warm-up frames; written to the group only on change. */
  const updateVisibility = (group: THREE.Group | null, position: THREE.Vector3, distanceSq: number, fadeVisibility: number): boolean => {
    if (boundsRadius === undefined && spriteHandoffDistance === undefined) return true;
    let visible = true;
    if (boundsRadius !== undefined) {
      boundsRef.center.copy(position);
      boundsRef.radius = paddedBoundsRadius;
      visible = frustum.intersectsSphere(boundsRef) || distanceSq < closeThresholdSq;
    }
    if (spriteHandoffDistance !== undefined && fadeVisibility <= 0) visible = false;
    // A sprite kind's warm-up frames count from its group's first frame: a Building mounts it only once built.
    if (forceVisibleFramesRef.current > 0 && (group || spriteHandoffDistance === undefined)) {
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

  const yawStep = THREE.MathUtils.degToRad(rotationStep);
  const framePhaseMs = framePhaseMsOf(coordinates);
  /** The real yaw survives the drawn one: a yaw on the group that differs from what the base last LEFT there is
   *  a new real yaw (a behavior or the server wrote it); otherwise only the camera or the clock moved. */
  const drawn = useRef({ realYaw: 0, leftYaw: NaN, frameMs: NaN, heldPosition: new THREE.Vector3(), heldYaw: 0 }).current;

  const stepYawToView = (group: THREE.Group, camera: THREE.Camera, realYaw: number | null): void => {
    if (realYaw !== null) drawn.realYaw = realYaw;
    else if (group.rotation.y !== drawn.leftYaw) drawn.realYaw = group.rotation.y;
    const towardCamera = Math.atan2(camera.position.x - group.position.x, camera.position.z - group.position.z);
    const relative = THREE.MathUtils.euclideanModulo(drawn.realYaw - towardCamera + Math.PI, Math.PI * 2) - Math.PI;
    const yaw = towardCamera + Math.round(relative / yawStep) * yawStep;
    if (group.rotation.y !== yaw) group.rotation.y = yaw;
  };

  /** Stop-motion: whatever wrote the transform this frame is shown only from the tick it lands on; the body
   *  (colliders, the server's pose) keeps moving underneath. */
  const holdDrawnFrame = (group: THREE.Group, clockMs: number): void => {
    const frameMs = frameTimeAt(clockMs, motionFrameRate, framePhaseMs);
    if (frameMs !== drawn.frameMs) {
      drawn.frameMs = frameMs;
      drawn.heldPosition.copy(group.position);
      drawn.heldYaw = group.rotation.y;
      return;
    }
    if (!group.position.equals(drawn.heldPosition)) group.position.copy(drawn.heldPosition);
    if (group.rotation.y !== drawn.heldYaw) group.rotation.y = drawn.heldYaw;
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
    if (spriteHandoffDistance !== undefined) reportSpriteDetail(group ? fadeVisibility : 0);

    const visible = updateVisibility(group, position, distanceSq, fadeVisibility);
    if (freezeMatrices && group) freezeMatricesOnce(group);

    const checked = !everCheckedRef.current || frameRef.current++ % checkInterval === 0;
    if (checked) {
      everCheckedRef.current = true;
      if (colliderDistance !== undefined) updateColliderGate(distanceSq, state.clock.elapsedTime);
      if (nearDistance !== undefined) updateNearGate(distanceSq);
    }

    if (group) updateMatrixLiveness(group, visible);

    // Snapshot interpolation (net/entities/utils.ts): drawn as it was
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
    const serverPosed = synced && !!group && sync.target.valid;
    if (serverPosed) applyServerPose(group!, sync.target);
    if (group && (yawStep > 0 || motionFrameRate > 0)) {
      if (yawStep > 0) stepYawToView(group, state.camera, serverPosed ? sync.target.ry : null);
      if (motionFrameRate > 0) holdDrawnFrame(group, synced ? playback.renderTime : state.clock.elapsedTime * 1000);
      drawn.leftYaw = group.rotation.y;
    }
  };

  const resetFade = (): void => {
    spawnFade.release();
    fadeRef.current.started = false;
    fadeRef.current.shown = false;
    reportSpriteDetail(0);
  };

  useEffect(() => {
    if (fadeOut && spriteHandoffDistance !== undefined) {
      reportContentError(`[actors] "${descriptorId ?? id}" has both a sprite handoff and fadeOut: a held-hidden actor would never destroy itself.`);
    }
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
