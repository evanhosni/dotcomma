import { useGLTF } from "@react-three/drei/core/useGLTF";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { AnimationChannel } from "../animation/AnimationChannel";
import { AnimationPlayer } from "../animation/AnimationPlayer";
import { proceduralDurations } from "../animation/utils";
import { HEAD_PITCH_INPUT, HEAD_YAW_INPUT } from "../objects/actors/beeble/animations";
import { BEEBLE_SPEC } from "../objects/actors/beeble/spec";
import { collectSkinnedMeshes } from "../objects/actors/model/geometry";
import { acquireModelClone, markPoseChanged, reclaimModelClone, releaseModelClone } from "../objects/actors/model/store";
import { getLiveModelActor } from "../objects/actors/model/registry";
import { createMavUnit, mavSeatOf, poseAlone, poseOnSeat } from "../objects/actors/mav-unit";
import type { MavSeat } from "../objects/actors/mav-unit/types";
import { EquippableHolder } from "../equippables/EquippableHolder";
import { flashMuzzle, settleMuzzle } from "../weapons";
import { registerPlayerBody } from "./registry";
import type { PlayerBodyState } from "./types";
import { lookOfBody } from "./utils";

// A per-module path: drei 9.87's index re-exports SpotLight, which imports LinearEncoding (removed in three r162).

const MODEL = BEEBLE_SPEC.model!;
const ANIMATION = BEEBLE_SPEC.animation;

/**
 * A player's body: a beeble clone from the actors' model pool (its materials prepared by the actor
 * base: quantization, curvature, lamp glow), posed by the same AnimationChannel + AnimationPlayer an NPC
 * uses, from a PlayerBodyState: the local player's (Player.tsx: the clip it picked, drawn only in third
 * person) or a remote one's (net/players/RemotePlayers.tsx: the pose its moves carried), posed by that
 * owner's frame loop through the registry (registry.ts). `meshes` is filled with its posed skinned meshes
 * while mounted, for the crosshair to pick (as an NPC's).
 *
 * It also draws the player's MAV Unit (objects/actors/mav-unit/), by the state's form: alone where the state
 * stands (falling from the sky), screwing into its host NPC's head (while that NPC is mounted here), or worn
 * on this beeble's own head once it is the host, turning with every turn of it.
 *
 * A host's body bears its wounds (objects/actors/wounds/) and holds what it has equipped (equippables/: its
 * arms posed over the animation to hold it where it looks), a weapon flashing at each of its shots (weapons/).
 */
export const PlayerBody = ({ state, meshes }: { state: PlayerBodyState; meshes?: THREE.SkinnedMesh[] }) => {
  const gltf = useGLTF(MODEL, false);
  const [clone] = useState(() => acquireModelClone(MODEL, gltf, BEEBLE_SPEC.quantization));
  const groupRef = useRef<THREE.Group>(null);
  const channel = useMemo(() => {
    const durations = Object.fromEntries(clone.animations.map((clip) => [clip.name, clip.duration]));
    return new AnimationChannel({ defaults: ANIMATION, durations: { ...durations, ...proceduralDurations(ANIMATION?.procedural) } });
  }, [clone]);
  const [player] = useState(() => new AnimationPlayer(ANIMATION));
  const [mav] = useState(createMavUnit);
  const holderRef = useRef<THREE.Group>(null);
  const ownSeat = useMemo(() => mavSeatOf(clone.scene), [clone]);
  /** Seats on the NPC hosts this unit has screwed into, by their model. */
  const hostSeats = useRef(new WeakMap<THREE.Object3D, MavSeat | null>()).current;
  /** The seat on the NPC `id` while it is mounted here. */
  const hostSeatOf = (id: string): MavSeat | null => {
    const host = getLiveModelActor(id);
    if (!host) return null;
    let seat = hostSeats.get(host.model);
    if (seat === undefined) hostSeats.set(host.model, (seat = mavSeatOf(host.model)));
    return seat;
  };

  const [items] = useState(() => new THREE.Group());
  const holding = useMemo(() => new EquippableHolder(clone.scene, items), [clone, items]);
  const shotsSeen = useRef(state.shots);
  const lastMs = useRef(NaN);

  useEffect(() => () => void mav.removeFromParent(), [mav]);
  useEffect(() => () => holding.dispose(), [holding]);

  /** What it holds, after the animation: its arms up to hold it, a weapon flashing once per new shot. */
  const hold = (nowMs: number): void => {
    const dt = Number.isNaN(lastMs.current) ? 0 : Math.min(0.1, (nowMs - lastMs.current) / 1000);
    lastMs.current = nowMs;
    const host = state.form === "host";
    const look = lookOfBody(state);
    const item = holding.pose(host ? state.equipped : "", look.yaw, look.pitch, dt, host && state.visible);
    if (holding.posing) markPoseChanged(clone);
    if (item && state.shots !== shotsSeen.current) flashMuzzle(item, nowMs / 1000);
    if (item) settleMuzzle(item, nowMs / 1000);
    shotsSeen.current = state.shots;
  };

  /** Where the unit is drawn this frame (see the component doc). */
  const placeMav = (): void => {
    if (state.form === "host" && ownSeat) {
      poseOnSeat(mav, ownSeat, 1, 0);
      mav.visible = true;
      return;
    }
    const hostSeat = state.form === "mav" && state.mavHost ? hostSeatOf(state.mavHost) : null;
    if (hostSeat) {
      poseOnSeat(mav, hostSeat, state.mavDepth, state.yaw);
      mav.visible = state.visible;
      return;
    }
    const holder = holderRef.current;
    if (!holder) return;
    poseAlone(mav, holder, state.feetX, state.feetY, state.feetZ, state.yaw);
    mav.visible = state.visible && state.form === "mav";
  };

  useEffect(() => {
    if (!meshes) return;
    collectSkinnedMeshes(clone.scene, meshes);
    return () => {
      meshes.length = 0;
    };
  }, [clone, meshes]);

  useEffect(() => {
    reclaimModelClone(clone);
    player.reset();
    markPoseChanged(clone);
    return () => {
      player.reset();
      markPoseChanged(clone);
      releaseModelClone(clone);
    };
  }, [clone, player]);

  useEffect(
    () =>
      registerPlayerBody(state, (nowMs) => {
        const group = groupRef.current;
        placeMav();
        clone.wounds.set(state.wounds);
        if (!group) return;
        group.visible = state.visible && state.form === "host";
        group.position.set(state.feetX, state.feetY, state.feetZ);
        group.rotation.y = state.yaw;

        channel.setClock(nowMs);
        // Called every frame: a one-shot must not restart on each call (a NEW clip still starts at 0).
        channel.play(state.clip, { speed: state.clipSpeed, loop: state.loop, restart: false });
        channel.setInput(HEAD_YAW_INPUT, state.headYaw);
        channel.setInput(HEAD_PITCH_INPUT, state.headPitch);
        // Posed in first person too: switching views shows the current frame, never a stale one.
        if (player.update(clone, group, channel.state, channel.inputs, nowMs)) markPoseChanged(clone);
        hold(nowMs);
      }, clone.scene),
    [state, clone, channel, player, mav, ownSeat, holding],
  );

  return (
    <>
      <group ref={groupRef} visible={false}>
        <primitive object={clone.scene} scale={BEEBLE_SPEC.scale ?? [1, 1, 1]} />
      </group>
      <group ref={holderRef} />
      <primitive object={items} />
    </>
  );
};
