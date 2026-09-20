import { RootState } from "@react-three/fiber";
import { useCallback, useEffect, useMemo } from "react";
import * as THREE from "three";
import { useGameContext } from "../../../context/GameContext";
import type { SyncHandle } from "../../../net/entities/useSyncedEntity";
import { getRemotePlayers } from "../../../net/players/store";
import type { AnimationChannel } from "./animation";
import type { Input } from "./input";
import type { Motion } from "./motion";
import { StateMachineRunner } from "./runner";
import type { StateMachineConfig } from "./types";

/**
 * React binding of StateMachineRunner. Local actors tick it authoritatively;
 * synced actors only follow the server's state id (decided per tick from the
 * sync handle). "The player" is the NEAREST player, local or remote — what the
 * server does with everyone in the domain.
 */

const _playerDiff = new THREE.Vector3();
const _nearestPlayer = new THREE.Vector3();

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

      if (sync && sync.known) {
        // Inject the server's outputs before the behavior runs, so visuals that read
        // them (head tracking uses the body yaw) see the real values.
        const r = sync.entity?.remote;
        if (r) {
          const out = runner.motion.out;
          if (r.ry !== undefined) out.yaw = r.ry;
          if (r.vx !== undefined) out.vx = r.vx;
          if (r.vz !== undefined) out.vz = r.vz;
          if (r.vy !== undefined) out.vy = r.vy !== 0 ? r.vy : null;
        }
        const sid = sync.stateId;
        if (sid) runner.followServerState(sid, elapsed, delta, clockMs, nearest, distSq);
        return;
      }

      runner.tick(elapsed, delta, clockMs, nearest, distSq);
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
