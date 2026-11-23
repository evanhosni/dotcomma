import { useGLTF } from "@react-three/drei/core/useGLTF";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { AnimationChannel } from "../animation/AnimationChannel";
import { AnimationPlayer } from "../animation/AnimationPlayer";
import { proceduralDurations } from "../animation/utils";
import { HEAD_YAW_INPUT } from "../objects/actors/beeble/animations";
import { BEEBLE_SPEC } from "../objects/actors/beeble/spec";
import { acquireModelClone, markPoseChanged, reclaimModelClone, releaseModelClone } from "../objects/actors/model/store";
import type { PlayerBodyState } from "./types";

// A per-module path: drei 9.87's index re-exports SpotLight, which imports LinearEncoding (removed in three r162).

const MODEL = BEEBLE_SPEC.model!;
const ANIMATION = BEEBLE_SPEC.animation;

/**
 * The player's body: a beeble clone from the actors' model pool (its materials prepared by the actor
 * base: quantization, curvature, lamp glow), posed by the same AnimationChannel + AnimationPlayer an NPC
 * uses, from the clip Player.tsx picked for this frame. Drawn only in third person.
 */
export const PlayerBody = ({ state }: { state: PlayerBodyState }) => {
  const gltf = useGLTF(MODEL, false);
  const [clone] = useState(() => acquireModelClone(MODEL, gltf, BEEBLE_SPEC.quantization));
  const groupRef = useRef<THREE.Group>(null);
  const channel = useMemo(() => {
    const durations = Object.fromEntries(clone.animations.map((clip) => [clip.name, clip.duration]));
    return new AnimationChannel({ defaults: ANIMATION, durations: { ...durations, ...proceduralDurations(ANIMATION?.procedural) } });
  }, [clone]);
  const [player] = useState(() => new AnimationPlayer(ANIMATION));

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

  // After Player.tsx (-3) has written this frame's state.
  useFrame((frame) => {
    const group = groupRef.current;
    if (!group) return;
    group.visible = state.visible;
    group.position.set(state.feetX, state.feetY, state.feetZ);
    group.rotation.y = state.yaw;

    const nowMs = frame.clock.elapsedTime * 1000;
    channel.setClock(nowMs);
    // Called every frame: a one-shot must not restart on each call (a NEW clip still starts at 0).
    channel.play(state.clip, { speed: state.clipSpeed, loop: state.loop, restart: false });
    channel.setInput(HEAD_YAW_INPUT, state.headYaw);
    // Posed in first person too: switching views shows the current frame, never a stale one.
    if (player.update(clone, group, channel.state, channel.inputs, nowMs)) markPoseChanged(clone);
  }, -2);

  return (
    <group ref={groupRef} visible={false}>
      <primitive object={clone.scene} scale={BEEBLE_SPEC.scale ?? [1, 1, 1]} />
    </group>
  );
};
