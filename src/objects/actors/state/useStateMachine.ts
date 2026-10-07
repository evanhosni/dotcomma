import { RootState } from "@react-three/fiber";
import { useCallback, useEffect, useMemo } from "react";
import * as THREE from "three";
import { useGameContext } from "../../../context/GameContext";
import type { SyncHandle } from "../../../net/entities/useSyncedEntity";
import { getRemotePlayers } from "../../../net/players/store";
import type { AnimationChannel } from "./animation";
import type { Input } from "./input";
import type { Motion, MotionOutput } from "./motion";
import { StateMachineRunner } from "./runner";
import type { StateMachineConfig } from "./types";

/**
 * React binding of StateMachineRunner. Local actors tick it authoritatively;
 * synced actors only follow the server's state id (decided per tick from the
 * sync handle). "The player" is the NEAREST player, local or remote — what the
 * server does with everyone in the domain.
 */

const _nearestRemote = new THREE.Vector3();
/** Rewritten by findNearestPlayer; `position` is the local player's own vector when it is nearest. */
const nearestPlayer = { position: _nearestRemote, distSq: Infinity };

/** The nearest player to `self` in 2D, local or remote. */
const findNearestPlayer = (self: THREE.Vector3, localPlayer: THREE.Vector3): typeof nearestPlayer => {
  const ldx = localPlayer.x - self.x;
  const ldz = localPlayer.z - self.z;
  nearestPlayer.position = localPlayer;
  nearestPlayer.distSq = ldx * ldx + ldz * ldz;
  for (const p of getRemotePlayers().values()) {
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

export interface StateMachineHandle {
  readonly currentStateId: string;
  forceTransition: (stateId: string) => void;
  blackboard: Record<string, any>;
  motion: Motion;
  animation: AnimationChannel;
  input: Input;
  /** Called from the owner's actor `onFrame` — never a useFrame of its own. */
  tick: (state: RootState, delta: number, sync: SyncHandle | null) => void;
}

export function useStateMachine(
  config: StateMachineConfig | undefined,
  positionRef: React.MutableRefObject<THREE.Vector3>,
  groupRef: React.MutableRefObject<THREE.Group | null>,
): StateMachineHandle | null {
  const { playerPosition } = useGameContext();

  const runner = useMemo(
    () => (config ? new StateMachineRunner(config, positionRef, groupRef) : null),
    [config, positionRef, groupRef],
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
