import * as THREE from "three";
import {
  playerOutsideRange,
  playerWithinRange,
  onMouseHoverEnter,
  onMouseHoverLeave,
  onMouseLeftClick,
  onMouseRightClick,
  onMouseLeftClickDown,
  onMouseRightClickDown,
  onMouseLeftClickUp,
  onMouseRightClickUp,
  onMouseScroll,
  onMouseScrollUp,
  onMouseScrollDown,
  onMouseDoubleClick,
  onMouseMiddleClick,
} from "../../../../objects/state/triggers";
import { StateMachineConfig } from "../../../../objects/state/types";

const BEEBLE_SPEED = 5;
const SIGHT_RANGE = 80;
const LOSE_RANGE = 120;

const _flee = new THREE.Vector3();

export const BEEBLE_SM: StateMachineConfig = {
  initialState: "wander",
  triggers: [
    playerWithinRange(SIGHT_RANGE),
    playerOutsideRange(LOSE_RANGE),
    onMouseHoverEnter(),
    onMouseHoverLeave(),
    onMouseLeftClick(),
    onMouseRightClick(),
    onMouseLeftClickDown(),
    onMouseRightClickDown(),
    onMouseLeftClickUp(),
    onMouseRightClickUp(),
    onMouseScroll(),
    onMouseScrollUp(),
    onMouseScrollDown(),
    onMouseDoubleClick(),
    onMouseMiddleClick(),
  ],
  states: [
    {
      id: "wander",
      animation: { clipName: "walk" },
      onUpdate: (ctx) => {
        ctx.positionRef.current.x += BEEBLE_SPEED * ctx.delta;
        if (ctx.groupRef.current) {
          ctx.groupRef.current.position.copy(ctx.positionRef.current);
        }
      },
      transitions: [{ trigger: `player-within-${SIGHT_RANGE}`, target: "aware" }],
    },
    {
      id: "aware",
      animation: { clipName: "walk", timeScale: 1.5 },
      onUpdate: (ctx) => {
        _flee.subVectors(ctx.positionRef.current, ctx.playerPosition);
        _flee.y = 0;
        _flee.normalize();
        ctx.positionRef.current.addScaledVector(_flee, BEEBLE_SPEED * 0 * ctx.delta);
        if (ctx.groupRef.current) {
          ctx.groupRef.current.position.copy(ctx.positionRef.current);
        }
      },
      transitions: [{ trigger: `player-outside-${LOSE_RANGE}`, target: "wander" }],
    },
  ],
};
