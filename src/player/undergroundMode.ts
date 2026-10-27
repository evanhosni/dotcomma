import type { RapierRigidBody } from "@react-three/rapier";
import { useRef } from "react";
import { playerTunnels } from "../objects/dressing/underground/undergroundRegistry";
import { resetCharacterMotion, type Character } from "../physics/characterMovement";
import { createTunnelState, createTunnelStep, resetTunnelState, stepTunnelRules, type TunnelBody, type TunnelStep } from "../physics/tunnelRules";
import { setCameraUnderground } from "../world/shaders/terrainHoles";
import { PLAYER_HEIGHT, PLAYER_RADIUS } from "./spec";
import type { InputState } from "./useInput";

/**
 * THE PLAYER UNDERGROUND: the shared tunnel rules (physics/tunnelRules.ts — the same ones every server NPC
 * runs) on the player's TunnelSpace (the registry's loaded chunks), applied to the player's body, and the
 * camera told when it is in a tunnel. Run before every step.
 */

interface Position {
  x: number;
  y: number;
  z: number;
}

export const useUndergroundMode = () => {
  const state = useRef(createTunnelState()).current;
  const step = useRef(createTunnelStep()).current;
  const body = useRef<TunnelBody>({ x: 0, y: 0, z: 0, height: PLAYER_HEIGHT, radius: PLAYER_RADIUS, jump: false }).current;

  const isInside = (): boolean => state.inside;
  /** Seconds since the player was last inside a tunnel (Infinity: never). */
  const outsideFor = (): number => state.outsideFor;

  const reset = (): void => {
    resetTunnelState(state);
    setCameraUnderground(false);
  };

  /** The step's adjustments for the capsule at body center `pos`; may teleport the body (a manhole's catch, its exit). */
  const update = (rb: RapierRigidBody, pos: Position, input: InputState, character: Character, dt: number): TunnelStep => {
    body.x = pos.x;
    body.y = pos.y;
    body.z = pos.z;
    body.jump = input.jump;
    stepTunnelRules(playerTunnels, state, step, body, dt);
    if (!Number.isNaN(step.teleportX)) rb.setTranslation({ x: step.teleportX, y: step.teleportY, z: step.teleportZ }, true);
    if (step.resetMotion) resetCharacterMotion(character.state);
    setCameraUnderground(state.inside);
    return step;
  };

  return { update, isInside, outsideFor, reset };
};
