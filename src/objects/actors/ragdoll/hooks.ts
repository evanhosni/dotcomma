import { RootState } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { useRef } from "react";
import * as THREE from "three";
import type { AnimationPlayer } from "../../../animation/AnimationPlayer";
import { smoothstep } from "../../../utils/math";
import { markPoseChanged } from "../model/store";
import type { KinematicMover, PooledModelClone } from "../model/types";
import { RAGDOLL_IMPULSE_KEY, RAGDOLL_STATE } from "../state/constants";
import type { MotionOutput, RagdollImpulse, StateMachineConfig, StateMachineHandle } from "../state/types";
import { recoverSecondsOf } from "../state/utils";
import type { ActorFrameContext } from "../types";
import { RAGDOLL_PREDICTION_MS } from "./constants";
import { Ragdoll } from "./Ragdoll";
import type { RagdollPhase } from "./types";
import { skeletonLayoutOf } from "./utils";

interface ActorRagdollOptions {
  stateMachine: StateMachineConfig | undefined;
  machine: StateMachineHandle | null;
  motion: MotionOutput;
  mover: KinematicMover;
  animPlayer: AnimationPlayer;
  /** Poses the animation's frame (`force`: whatever the animation LOD says). */
  animate: (clone: PooledModelClone, state: RootState, ctx: ActorFrameContext, serverDriven: boolean, force: boolean) => void;
}

/**
 * A model actor's body as a ragdoll (Ragdoll.ts), for an actor with a machine: the machine's built-in
 * RAGDOLL_STATE is its switch. `attach` builds it with each pooled clone; `pose` is its part of the frame.
 */
export const useActorRagdoll = ({ stateMachine, machine, motion, mover, animPlayer, animate }: ActorRagdollOptions) => {
  const { world, rapier } = useRapier();
  const limb = useRef({
    ragdoll: null as Ragdoll | null,
    predicted: null as { impulse: RagdollImpulse | null; untilMs: number } | null,
    recoverFromMs: NaN,
    phase: "none" as RagdollPhase,
    nowMs: 0,
  }).current;

  /** Builds the clone's ragdoll; returns its disposer. */
  const attach = (scene: THREE.Object3D): (() => void) => {
    const layout = stateMachine ? skeletonLayoutOf(scene) : null;
    const ragdoll = layout ? new Ragdoll(world, rapier, scene, layout) : null;
    limb.ragdoll = ragdoll;
    return () => {
      ragdoll?.dispose();
      limb.ragdoll = null;
      limb.predicted = null;
      limb.recoverFromMs = NaN;
      limb.phase = "none";
    };
  };

  /** Limp, or back up (LiveModelActor.setRagdoll). A synced actor's limp is predicted until the server's state
   *  arrives; getting up is the server's alone. */
  const setRagdoll = (on: boolean, impulse: RagdollImpulse | undefined, hold: boolean | undefined, synced: boolean): void => {
    if (!machine) return;
    if (!synced) machine.setRagdoll(on, impulse, hold);
    else if (on) limb.predicted = { impulse: impulse ?? null, untilMs: limb.nowMs + RAGDOLL_PREDICTION_MS };
  };

  /** The ragdoll's part of the frame: goes limp when the machine is in RAGDOLL_STATE (or a limp is
   *  predicted), lets go when it leaves it, then blends the bones from where they lay into the animation
   *  over the machine's recover time. True when it posed the bones (the animation is skipped), and the
   *  group is held still meanwhile: the bones are posed in world space under it. */
  const pose = (clone: PooledModelClone | null, state: RootState, ctx: ActorFrameContext, serverDriven: boolean): boolean => {
    const nowMs = (limb.nowMs = state.clock.elapsedTime * 1000);
    const ragdoll = limb.ragdoll;
    if (!clone || !ragdoll || !machine || !stateMachine) return false;
    const machineLimp = machine.currentStateId === RAGDOLL_STATE;
    if (machineLimp || (limb.predicted && nowMs >= limb.predicted.untilMs)) limb.predicted = null;
    const limp = machineLimp || limb.predicted !== null;

    if (limp && !ragdoll.active) {
      const synced = !!ctx.sync && ctx.sync.known;
      const impulse = limb.predicted?.impulse ?? ((synced ? ctx.sync!.state?.[RAGDOLL_IMPULSE_KEY] : machine.blackboard[RAGDOLL_IMPULSE_KEY]) as RagdollImpulse | null | undefined) ?? null;
      const target = ctx.sync?.target;
      const velocity = serverDriven && target?.valid ? { x: target.vx, y: target.vy, z: target.vz } : { x: motion.vx, y: motion.vy ?? 0, z: motion.vz };
      ragdoll.start(impulse, velocity);
      mover.setSolid(false);
      limb.recoverFromMs = NaN;
    } else if (!limp && ragdoll.active) {
      ragdoll.release();
      limb.recoverFromMs = nowMs;
    }

    if (ragdoll.active) {
      ragdoll.step();
      markPoseChanged(clone);
      ctx.holdPose = true;
      limb.phase = "limp";
      return true;
    }
    if (!Number.isNaN(limb.recoverFromMs)) {
      const t = (nowMs - limb.recoverFromMs) / (recoverSecondsOf(stateMachine) * 1000);
      if (t < 1) {
        ragdoll.restoreStanding();
        animPlayer.invalidate();
        animate(clone, state, ctx, serverDriven, true);
        ragdoll.blend(smoothstep(0, 1, t));
        markPoseChanged(clone);
        ctx.holdPose = true;
        limb.phase = "recovering";
        return true;
      }
      limb.recoverFromMs = NaN;
      mover.setSolid(true);
      animPlayer.invalidate();
    }
    limb.phase = "none";
    return false;
  };

  return {
    attach,
    setRagdoll,
    pose,
    /** Shoves the limp body (a shot at a corpse); nothing while it stands. */
    push: (impulse: RagdollImpulse): void => limb.ragdoll?.push(impulse),
    /** Where the limp body lies (null while it stands): it falls away from the actor's own position. */
    center: (out: THREE.Vector3): THREE.Vector3 | null => (limb.ragdoll?.active ? limb.ragdoll.center(out) : null),
    get phase(): RagdollPhase {
      return limb.phase;
    },
  };
};
