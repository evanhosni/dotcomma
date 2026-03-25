import * as THREE from "three";
import {
  afterDelay,
  onMouseDoubleClick,
  onMouseHoverEnter,
  onMouseHoverLeave,
  onMouseLeftClick,
  onMouseLeftClickDown,
  onMouseLeftClickUp,
  onMouseMiddleClick,
  onMouseRightClick,
  onMouseRightClickDown,
  onMouseRightClickUp,
  onMouseScroll,
  onMouseScrollDown,
  onMouseScrollUp,
  playerOutsideRange,
  playerWithinRange,
  randomInterval,
} from "../../../../objects/state/triggers";
import { StateMachineConfig } from "../../../../objects/state/types";

const BEEBLE_SPEED = 5;
const ASCEND_SPEED = 8;
const SIGHT_RANGE = 20;
const LOSE_RANGE = 30;
const DIR_LERP_SPEED = 3;

// ─── Helpers ───

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * Math.min(t, 1);
}

function randomAngle(): number {
  return Math.random() * Math.PI * 2;
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// ─── State Machine ───

export const BEEBLE_SM: StateMachineConfig = {
  initialState: "idle-walk",
  triggers: [
    playerWithinRange(SIGHT_RANGE),
    playerOutsideRange(LOSE_RANGE),
    randomInterval("idle-look", 20, 60),
    randomInterval("idle-look-end", 3, 10),
    randomInterval("aware-blink", 5, 10),
    afterDelay(1.5),
    onMouseLeftClick(),
    onMouseHoverEnter(),
    onMouseHoverLeave(),
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
    // ─── Idle: Walking ───
    {
      id: "idle-walk",
      animation: { clipName: "walk" },
      onEnter: (ctx) => {
        const bb = ctx.blackboard;
        const angle = randomAngle();
        bb.__dir_angle = angle;
        bb.__dir_target = angle;
        bb.__dir_timer = randomRange(1, 5);
        bb.__dir_elapsed = 0;
      },
      onUpdate: (ctx) => {
        const bb = ctx.blackboard;

        // Direction change timer
        bb.__dir_elapsed += ctx.delta;
        if (bb.__dir_elapsed >= bb.__dir_timer) {
          bb.__dir_target = randomAngle();
          bb.__dir_timer = randomRange(1, 5);
          bb.__dir_elapsed = 0;
        }

        // Smooth lerp toward target direction
        bb.__dir_angle = lerpAngle(bb.__dir_angle, bb.__dir_target, DIR_LERP_SPEED * ctx.delta);

        // Write velocity for physics body (Beeble.tsx applies it)
        const angle = bb.__dir_angle;
        bb.__vel_x = BEEBLE_SPEED * Math.sin(angle);
        bb.__vel_z = BEEBLE_SPEED * Math.cos(angle);
        bb.__vel_y = undefined;

        // Rotate to face movement direction (model forward is +Y)
        if (ctx.groupRef.current) {
          ctx.groupRef.current.rotation.y = angle;
        }
      },
      transitions: [
        { trigger: `player-within-${SIGHT_RANGE}`, target: "aware" },
        { trigger: "idle-look", target: "idle-look" },
      ],
    },

    // ─── Idle: Looking at Hands ───
    {
      id: "idle-look",
      animation: {
        clipName: "stare at hands",
        loop: THREE.LoopOnce,
        clampWhenFinished: true,
      },
      onUpdate: (ctx) => {
        ctx.blackboard.__vel_x = 0;
        ctx.blackboard.__vel_z = 0;
        ctx.blackboard.__vel_y = undefined;
      },
      transitions: [
        { trigger: `player-within-${SIGHT_RANGE}`, target: "aware" },
        { trigger: "idle-look-end", target: "idle-walk" },
      ],
    },

    // ─── Aware: Standing ───
    {
      id: "aware",
      animation: { clipName: "idle" },
      onUpdate: (ctx) => {
        ctx.blackboard.__vel_x = 0;
        ctx.blackboard.__vel_z = 0;
        ctx.blackboard.__vel_y = undefined;
      },
      transitions: [
        { trigger: "mouse-left-click", target: "ascending" },
        { trigger: `player-outside-${LOSE_RANGE}`, target: "idle-walk" },
        { trigger: "aware-blink", target: "aware-blink" },
      ],
    },

    // ─── Aware: Blinking ───
    {
      id: "aware-blink",
      animation: {
        clipName: "blink",
        loop: THREE.LoopOnce,
        clampWhenFinished: true,
      },
      onUpdate: (ctx) => {
        ctx.blackboard.__vel_x = 0;
        ctx.blackboard.__vel_z = 0;
        ctx.blackboard.__vel_y = undefined;
      },
      transitions: [
        { trigger: "mouse-left-click", target: "ascending" },
        { trigger: `player-outside-${LOSE_RANGE}`, target: "idle-walk" },
        { trigger: "after-1.5s", target: "aware" },
      ],
    },

    // ─── Ascending ───
    {
      id: "ascending",
      animation: { clipName: "ascend" },
      onUpdate: (ctx) => {
        ctx.blackboard.__vel_x = 0;
        ctx.blackboard.__vel_z = 0;
        ctx.blackboard.__vel_y = ASCEND_SPEED;
      },
      transitions: [],
    },
  ],
};
