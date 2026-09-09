import { RootState, useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo } from "react";
import * as THREE from "three";
import { useGameContext } from "../../../context/GameContext";
import type { SyncHandle } from "../../../net/entities/useSyncedEntity";
import { getRemotePlayers } from "../../../net/remotePlayerStore";
import { StateMachineRunner } from "./runner";
import { StateMachineConfig, StateMachineHandle } from "./types";

/**
 * React binding of the StateMachineRunner (runner.ts — read its contract).
 *
 * LOCAL actor (`serverSynced={false}`): the runner ticks here, authoritative,
 * and the facing output (`__yaw`) is applied to the model. Velocity outputs
 * are read by the owner's onFrame into ctx.move; animation by ModelActor.
 *
 * SYNCED actor (the default): the SERVER runs this machine. Here it only
 * MIRRORS the server's state id — entering states exactly as the server did,
 * so state-keyed visuals (head tracking, the sphere-inflate) happen — while
 * every logic output is ignored in favor of the server's published pose and
 * clip. The hook finds out which case it is from the sync handle the actor
 * base hangs on the group (`group.userData.sync`); no component tells it.
 *
 * "The player" a machine reacts to is the NEAREST player — local or remote —
 * matching what the server does with all players in the domain.
 */

const _playerDiff = new THREE.Vector3();
const _nearestPlayer = new THREE.Vector3();

export interface UseStateMachineOptions {
  /** The owner drives the machine itself by calling `handle.tick(state,
   *  delta)` from its actor `onFrame` (the shared actor frame driver) instead
   *  of this hook subscribing its own useFrame. Actors should always do this —
   *  a useFrame per actor is the subscription churn the shared driver exists
   *  to remove (CLAUDE.md: "Do NOT add a useFrame to an actor"). */
  externallyDriven?: boolean;
}

export function useStateMachine(
  config: StateMachineConfig,
  positionRef: React.MutableRefObject<THREE.Vector3>,
  groupRef: React.MutableRefObject<THREE.Group | null>,
  options: UseStateMachineOptions = {},
): StateMachineHandle {
  const { playerPosition } = useGameContext();

  // positionRef/groupRef are stable per instance; the config is module-constant.
  const runner = useMemo(() => new StateMachineRunner(config, positionRef, groupRef), [config, positionRef, groupRef]);
  useEffect(() => () => runner.dispose(), [runner]);

  const tick = useCallback(
    (threeState: RootState, delta: number) => {
      const elapsed = threeState.clock.elapsedTime;
      const self = positionRef.current;

      // Nearest player (2D): the local one, then every remote player we render.
      let nearest: THREE.Vector3 = playerPosition;
      _playerDiff.subVectors(nearest, self);
      let distSq = _playerDiff.x * _playerDiff.x + _playerDiff.z * _playerDiff.z;
      for (const p of getRemotePlayers().values()) {
        const dx = p.x - self.x;
        const dz = p.z - self.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < distSq) {
          distSq = dSq;
          nearest = _nearestPlayer.set(p.x, p.y, p.z);
        }
      }

      const sync = groupRef.current?.userData.sync as SyncHandle | undefined;
      if (sync && sync.known) {
        // The server owns this machine: follow its state for the visuals only.
        // Its OUTPUTS come from the server too — inject them before the
        // behavior runs, so visuals that read them (head tracking uses __yaw
        // as the body angle) see the real values, not what the local mirrored
        // machine happened to compute.
        const r = sync.entity?.remote;
        const bb = runner.blackboard;
        if (r) {
          if (r.ry !== undefined) bb.__yaw = r.ry;
          if (r.vx !== undefined) bb.__vel_x = r.vx;
          if (r.vz !== undefined) bb.__vel_z = r.vz;
          if (r.vy !== undefined) bb.__vel_y = r.vy !== 0 ? r.vy : undefined;
        }
        const sid = sync.stateId;
        if (sid) runner.mirror(sid, elapsed, delta, nearest, distSq);
        return;
      }

      runner.tick(elapsed, delta, nearest, distSq);
      // Facing is a machine OUTPUT; apply it to the model here (local only —
      // synced actors get the server's yaw from the base).
      const yaw = runner.blackboard.__yaw;
      if (yaw !== undefined && groupRef.current) groupRef.current.rotation.y = yaw;
    },
    [runner, positionRef, groupRef, playerPosition],
  );

  const externallyDriven = options.externallyDriven ?? false;
  useFrame((threeState, delta) => {
    if (!externallyDriven) tick(threeState, delta);
  });

  return useMemo<StateMachineHandle>(
    () => ({
      get currentStateId() {
        return runner.currentStateId;
      },
      forceTransition: (stateId: string) => runner.forceTransition(stateId),
      blackboard: runner.blackboard,
      animationControl: runner.animationControl,
      tick,
    }),
    [runner, tick],
  );
}
