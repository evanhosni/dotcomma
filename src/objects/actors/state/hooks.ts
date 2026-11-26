import { RootState } from "@react-three/fiber";
import { PLAYER_DETECTABILITY } from "../../../player/spec";
import { getLocalDetectability } from "../../../player/store";
import { useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGameContext } from "../../../context/hooks";
import type { SyncHandle } from "../../../net/entities/types";
import { getRemotePlayers } from "../../../net/players/store";
import type { MotionOutput, RunnerOptions, StateMachineConfig, StateMachineHandle, MouseFlag, UseMouseEventsOptions, MouseEventsHandle } from "./types";
import { StateMachineRunner } from "./StateMachineRunner";
import { claimHover, releaseHover } from "../../../utils/cursor";
import type { HoverTarget } from "../../../utils/cursor/types";
import { mouseActionOf } from "./utils";
import { aimFromCamera } from "../../../player/utils";
import { collectSkinnedMeshes, rayHitDistance } from "../model/geometry";
import { RAYCAST_RANGE_PAD, VIEW_CONE_SKIP_WITHIN_SQ, VIEW_CONE_COS, MOUSE_RAYCAST_INTERVAL_FRAMES } from "./constants";

/**
 * React binding of StateMachineRunner. Local actors tick it authoritatively;
 * synced actors only follow the server's state id (decided per tick from the
 * sync handle). "The player" is the NEAREST player, local or remote — what the
 * server does with everyone in the domain.
 */

const _nearestRemote = new THREE.Vector3();
/** Rewritten by findNearestPlayer; `position` is the local player's own vector when it is nearest. */
const nearestPlayer = { position: _nearestRemote, distSq: Infinity };

/** Where "the player" is when no player can be noticed: far beyond every range. */
const NO_PLAYER = new THREE.Vector3(1e9, 0, 1e9);

/** The nearest player to `self` in 2D, local or remote, that NPCs can notice (PLAYER_DETECTABILITY). */
const findNearestPlayer = (self: THREE.Vector3, localPlayer: THREE.Vector3): typeof nearestPlayer => {
  nearestPlayer.position = NO_PLAYER;
  nearestPlayer.distSq = Infinity;
  if (getLocalDetectability() > 0) {
    const ldx = localPlayer.x - self.x;
    const ldz = localPlayer.z - self.z;
    nearestPlayer.position = localPlayer;
    nearestPlayer.distSq = ldx * ldx + ldz * ldz;
  }
  for (const p of getRemotePlayers().values()) {
    if (PLAYER_DETECTABILITY[p.body.form] <= 0) continue;
    const dx = p.x - self.x;
    const dz = p.z - self.z;
    const dSq = dx * dx + dz * dz;
    if (dSq < nearestPlayer.distSq) {
      nearestPlayer.distSq = dSq;
      nearestPlayer.position = _nearestRemote.set(p.x, p.y, p.z);
    }
  }
  return nearestPlayer;
};

/** The server's published motion, injected before the behavior runs so visuals that read it (head
 *  tracking uses the body yaw) see the real values. */
const adoptServerMotion = (out: MotionOutput, remote: { ry?: number; vx?: number; vz?: number; vy?: number }): void => {
  if (remote.ry !== undefined) out.yaw = remote.ry;
  if (remote.vx !== undefined) out.vx = remote.vx;
  if (remote.vz !== undefined) out.vz = remote.vz;
  if (remote.vy !== undefined) out.vy = remote.vy !== 0 ? remote.vy : null;
};

export function useStateMachine(
  config: StateMachineConfig | undefined,
  positionRef: React.MutableRefObject<THREE.Vector3>,
  groupRef: React.MutableRefObject<THREE.Group | null>,
  options?: RunnerOptions,
): StateMachineHandle | null {
  const { playerPosition } = useGameContext();

  const runner = useMemo(
    () => (config ? new StateMachineRunner(config, positionRef, groupRef, options) : null),
    [config, positionRef, groupRef, options],
  );
  useEffect(() => () => runner?.dispose(), [runner]);

  const tick = useCallback(
    (threeState: RootState, delta: number, sync: SyncHandle | null) => {
      if (!runner) return;
      const elapsed = threeState.clock.elapsedTime;
      const clockMs = elapsed * 1000;
      const nearest = findNearestPlayer(positionRef.current, playerPosition);

      if (sync && sync.known) {
        const remote = sync.entity?.remote;
        if (remote) adoptServerMotion(runner.motion.out, remote);
        const sid = sync.stateId;
        if (sid) runner.followServerState(sid, elapsed, delta, clockMs, nearest.position, nearest.distSq);
        return;
      }

      runner.tick(elapsed, delta, clockMs, nearest.position, nearest.distSq);
      if (groupRef.current) groupRef.current.rotation.y = runner.motion.yaw;
    },
    [runner, positionRef, groupRef, playerPosition],
  );

  return useMemo<StateMachineHandle | null>(
    () =>
      runner
        ? {
            get currentStateId() {
              return runner.currentStateId;
            },
            forceTransition: (stateId: string) => runner.forceTransition(stateId),
            setRagdoll: (on, impulse, hold) => runner.setRagdoll(on, impulse, hold),
            blackboard: runner.blackboard,
            motion: runner.motion,
            animation: runner.animation,
            input: runner.input,
            tick,
          }
        : null,
    [runner, tick],
  );
}

/**
 * A throttled screen-center raycast against the model's skinned meshes raises
 * one-shot flags on the machine's blackboard. Every input is ALSO forwarded to
 * the server (`entity:interact "mouse-<flag>"`) — inputs cross the wire, never
 * triggers; the server's machine evaluates its own triggers. `sm === null` makes
 * the hook inert.
 */

const raise = (bb: Record<string, any>, flag: MouseFlag, sync: SyncHandle | null): void => {
  bb[flag] = true;
  bb.__mouse_dirty = true;
  if (sync && sync.known) sync.interact(mouseActionOf(flag));
};

/** One mouse event as the machine's input flags (the arbiter only sends it while this actor is hovered). */
const dispatchMouse = (e: MouseEvent, bb: Record<string, any>, sync: SyncHandle | null): void => {
  const input = (flag: MouseFlag) => raise(bb, flag, sync);
  switch (e.type) {
    case "click":
      if (e.button === 0) input("__mouse_left_click");
      break;
    case "contextmenu":
      input("__mouse_right_click");
      break;
    case "pointerdown":
      if (e.button === 0) input("__mouse_left_click_down");
      else if (e.button === 1) input("__mouse_middle_click");
      else if (e.button === 2) input("__mouse_right_click_down");
      break;
    case "pointerup":
      if (e.button === 0) {
        input("__mouse_left_click_up");
      } else if (e.button === 2) {
        input("__mouse_right_click");
        input("__mouse_right_click_up");
      }
      break;
    case "dblclick":
      input("__mouse_double_click");
      break;
    case "wheel":
      input("__mouse_scroll");
      if ((e as WheelEvent).deltaY < 0) input("__mouse_scroll_up");
      else if ((e as WheelEvent).deltaY > 0) input("__mouse_scroll_down");
      break;
  }
};
const _toActor = new THREE.Vector3();

const _aim = new THREE.Ray();


export function useMouseEvents(
  sm: StateMachineHandle | null,
  groupRef: React.MutableRefObject<THREE.Group | null>,
  options: UseMouseEventsOptions,
): MouseEventsHandle {
  const bb = sm?.blackboard ?? null;
  const growCursor = options.shouldGrowCursor ?? false;
  const reach = options.reach;
  const activeHoverRef = useRef(false);
  const syncRef = useRef<SyncHandle | null>(null);
  const frameCountRef = useRef(options.framePhase ?? 0);
  const cachedMeshesRef = useRef<THREE.SkinnedMesh[]>([]);
  const bbRef = useRef(bb);
  bbRef.current = bb;
  /** Claimed (utils/cursor) while hovered: the arbiter hands it the mouse when it is the nearest. */
  const hoverTarget = useMemo<HoverTarget>(
    () => ({ distance: Infinity, growsCursor: growCursor, onMouse: (e) => bbRef.current && dispatchMouse(e, bbRef.current, syncRef.current) }),
    [growCursor],
  );

  /** The screen-center ray's distance to the model; Infinity when out of range or off the view cone. */
  const measureHitDistance = (camera: THREE.Camera, group: THREE.Group, distanceSq2D: number): number => {
    const range = reach + RAYCAST_RANGE_PAD;
    const rangeSq = range * range;
    if (distanceSq2D > rangeSq) return Infinity;
    aimFromCamera(camera, _aim);
    const dist3DSq = _aim.origin.distanceToSquared(group.position);
    if (dist3DSq > rangeSq) return Infinity;

    _toActor.subVectors(group.position, _aim.origin);
    const outsideViewCone =
      dist3DSq > VIEW_CONE_SKIP_WITHIN_SQ && _toActor.normalize().dot(_aim.direction) < VIEW_CONE_COS;
    if (outsideViewCone) return Infinity;

    if (cachedMeshesRef.current.length === 0) collectSkinnedMeshes(group, cachedMeshesRef.current);
    return rayHitDistance(_aim, cachedMeshesRef.current, reach);
  };

  const tick = (camera: THREE.Camera, distanceSq2D: number, sync: SyncHandle | null): void => {
    syncRef.current = sync;
    if (!bb) return;
    if (++frameCountRef.current % MOUSE_RAYCAST_INTERVAL_FRAMES !== 0) return;

    const group = groupRef.current;
    hoverTarget.distance = group ? measureHitDistance(camera, group, distanceSq2D) : Infinity;
    const isHovering = hoverTarget.distance <= reach;

    if (isHovering && !activeHoverRef.current) {
      activeHoverRef.current = true;
      raise(bb, "__mouse_hover_enter", sync);
      bb.__mouse_hover_active = true;
      claimHover(hoverTarget);
    } else if (!isHovering && activeHoverRef.current) {
      activeHoverRef.current = false;
      raise(bb, "__mouse_hover_leave", sync);
      // false, not delete: deleting keys forces the blackboard into dictionary mode.
      bb.__mouse_hover_active = false;
      releaseHover(hoverTarget);
    }
  };
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => () => releaseHover(hoverTarget), [hoverTarget]);

  // NOTHING is attached to the R3F group: even no-op pointer handlers register the
  // actor in R3F's interaction list, which raycasts it recursively on every pointermove.
  return useMemo<MouseEventsHandle>(() => ({ tick: (camera, distanceSq, sync) => tickRef.current(camera, distanceSq, sync) }), []);
}
