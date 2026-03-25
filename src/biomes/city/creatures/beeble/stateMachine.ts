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
import { BehaviorContext, StateMachineConfig } from "../../../../objects/state/types";

const BEEBLE_SPEED = 5;
const ASCEND_SPEED = 8;
const SIGHT_RANGE = 20;
const LOSE_RANGE = 30;
const DIR_LERP_SPEED = 3;
const HEAD_LERP_SPEED = 5;
const MAX_HEAD_TURN = 50 * (Math.PI / 180);

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

function findHeadBone(ctx: BehaviorContext): void {
  if (ctx.blackboard.__head_bone) return;
  if (!ctx.groupRef.current) return;
  ctx.groupRef.current.traverse((node: any) => {
    if (node.isBone && node.name === "head") {
      ctx.blackboard.__head_bone = node;
    }
  });
}

function resetHeadBone(ctx: BehaviorContext): void {
  const bone = ctx.blackboard.__head_bone as THREE.Bone | undefined;
  if (bone) bone.rotation.y = 0;
}

function updateHeadTracking(ctx: BehaviorContext): void {
  const bone = ctx.blackboard.__head_bone as THREE.Bone | undefined;
  if (!bone) return;

  const dx = ctx.playerPosition.x - ctx.positionRef.current.x;
  const dz = ctx.playerPosition.z - ctx.positionRef.current.z;
  const angleToPlayer = Math.atan2(dx, dz);

  const bodyAngle = ctx.groupRef.current?.rotation.y ?? 0;

  let relAngle = angleToPlayer - bodyAngle;
  while (relAngle > Math.PI) relAngle -= Math.PI * 2;
  while (relAngle < -Math.PI) relAngle += Math.PI * 2;

  relAngle = Math.max(-MAX_HEAD_TURN, Math.min(MAX_HEAD_TURN, relAngle));

  bone.rotation.y = lerpAngle(bone.rotation.y, relAngle, HEAD_LERP_SPEED * ctx.delta);
}

// ─── State Machine ───

export const BEEBLE_SM: StateMachineConfig = {
  initialState: "idle-walk",
  triggers: [
    playerWithinRange(SIGHT_RANGE),
    playerOutsideRange(LOSE_RANGE),
    randomInterval("idle-look", 20, 60),
    randomInterval("idle-look-end", 3, 10),
    randomInterval("alert-blink", 5, 10),
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
        resetHeadBone(ctx);
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
        { trigger: `player-within-${SIGHT_RANGE}`, target: "alert" },
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
      onEnter: (ctx) => {
        resetHeadBone(ctx);
      },
      onUpdate: (ctx) => {
        ctx.blackboard.__vel_x = 0;
        ctx.blackboard.__vel_z = 0;
        ctx.blackboard.__vel_y = undefined;
      },
      transitions: [
        { trigger: `player-within-${SIGHT_RANGE}`, target: "alert" },
        { trigger: "idle-look-end", target: "idle-walk" },
      ],
    },

    // ─── Alert: Standing ───
    {
      id: "alert",
      animation: { clipName: "idle" },
      onEnter: (ctx) => {
        findHeadBone(ctx);
      },
      onUpdate: (ctx) => {
        ctx.blackboard.__vel_x = 0;
        ctx.blackboard.__vel_z = 0;
        ctx.blackboard.__vel_y = undefined;
        updateHeadTracking(ctx);
      },
      transitions: [
        { trigger: "mouse-left-click", target: "ascending" },
        { trigger: `player-outside-${LOSE_RANGE}`, target: "idle-walk" },
        { trigger: "alert-blink", target: "alert-blink" },
      ],
    },

    // ─── Alert: Blinking ───
    {
      id: "alert-blink",
      animation: {
        clipName: "blink",
        loop: THREE.LoopOnce,
        clampWhenFinished: true,
      },
      onUpdate: (ctx) => {
        ctx.blackboard.__vel_x = 0;
        ctx.blackboard.__vel_z = 0;
        ctx.blackboard.__vel_y = undefined;
        updateHeadTracking(ctx);
      },
      transitions: [
        { trigger: "mouse-left-click", target: "ascending" },
        { trigger: `player-outside-${LOSE_RANGE}`, target: "idle-walk" },
        { trigger: "after-1.5s", target: "alert" },
      ],
    },

    // ─── Ascending ───
    {
      id: "ascending",
      animation: { clipName: "ascend" },
      onEnter: (ctx) => {
        resetHeadBone(ctx);
      },
      onUpdate: (ctx) => {
        ctx.blackboard.__vel_x = 0;
        ctx.blackboard.__vel_z = 0;
        ctx.blackboard.__vel_y = ASCEND_SPEED;
      },
      transitions: [],
    },
  ],
};
