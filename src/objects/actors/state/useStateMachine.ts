import { RootState, useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo } from "react";
import * as THREE from "three";
import { useGameContext } from "../../../context/GameContext";
import type { SyncHandle } from "../../../net/entities/useSyncedEntity";
import { getRemotePlayers } from "../../../net/remotePlayerStore";
import { StateMachineRunner } from "./runner";
import { StateMachineConfig, StateMachineHandle } from "./types";

// React binding of StateMachineRunner. Synced actors (found via the sync
// handle the base hangs on `group.userData.sync`) only MIRROR the server's
// state; local actors tick here. "The player" is the NEAREST player, local or
// remote — the same rule the server applies.

const _playerDiff = new THREE.Vector3();
const _nearestPlayer = new THREE.Vector3();

export interface UseStateMachineOptions {
  /** The owner calls `handle.tick` from its actor onFrame — never a useFrame per actor. */
  externallyDriven?: boolean;
}

export function useStateMachine(
  config: StateMachineConfig,
  positionRef: React.MutableRefObject<THREE.Vector3>,
  groupRef: React.MutableRefObject<THREE.Group | null>,
  options: UseStateMachineOptions = {},
): StateMachineHandle {
  const { playerPosition } = useGameContext();

  const runner = useMemo(() => new StateMachineRunner(config, positionRef, groupRef), [config, positionRef, groupRef]);
  useEffect(() => () => runner.dispose(), [runner]);

  const tick = useCallback(
    (threeState: RootState, delta: number) => {
      const elapsed = threeState.clock.elapsedTime;
      const self = positionRef.current;

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
        // Inject the server's outputs before the behavior runs, so visuals that
        // read them (head tracking uses __yaw) see the real values.
        const r = sync.entity?.remote;
        const bb = runner.blackboard;
        if (r) {
          if (r.ry !== undefined) bb.__yaw = r.ry;
          if (r.vx !== undefined) bb.__vel_x = r.vx;
          if (r.vz !== undefined) bb.__vel_z = r.vz;
          if (r.vy !== undefined) bb.__vel_y = r.vy !== 0 ? r.vy : undefined;
        }
        const sid = sync.stateId;
        if (sid) runner.followServerState(sid, elapsed, delta, nearest, distSq);
        return;
      }

      runner.tick(elapsed, delta, nearest, distSq);
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
