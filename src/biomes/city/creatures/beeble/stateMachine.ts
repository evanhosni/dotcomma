import * as THREE from "three";
import {
  custom,
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
const SIGHT_ANGLE = 50 * (Math.PI / 180); // 50° — FOV half-angle for alert trigger
const TURN_THRESHOLD = Math.PI / 2; // 90° — start turning body
const TURN_DONE_THRESHOLD = Math.PI / 9; // 20° — stop turning, head tracking takes over

// ─── Helpers ───

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * Math.min(t, 1);
}

function angleDiffAbs(a: number, b: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return Math.abs(diff);
}

function angleToPlayer(ctx: { positionRef: { current: THREE.Vector3 }; playerPosition: THREE.Vector3 }): number {
  const dx = ctx.playerPosition.x - ctx.positionRef.current.x;
  const dz = ctx.playerPosition.z - ctx.positionRef.current.z;
  return Math.atan2(dx, dz);
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

  const playerAngle = angleToPlayer(ctx);
  const bodyAngle = ctx.groupRef.current?.rotation.y ?? 0;

  let relAngle = playerAngle - bodyAngle;
  while (relAngle > Math.PI) relAngle -= Math.PI * 2;
  while (relAngle < -Math.PI) relAngle += Math.PI * 2;

  relAngle = Math.max(-MAX_HEAD_TURN, Math.min(MAX_HEAD_TURN, relAngle));

  bone.rotation.y = lerpAngle(bone.rotation.y, relAngle, HEAD_LERP_SPEED * ctx.delta);
}

// ─── State Machine ───

export const BEEBLE_SM: StateMachineConfig = {
  initialState: "idle-walk",
  triggers: [
    custom("player-visible", (ctx) => {
      const sightSq = SIGHT_RANGE * SIGHT_RANGE;
      if (ctx.playerDistanceSq > sightSq) return false;
      const bodyAngle = ctx.blackboard.__dir_angle ?? 0;
      return angleDiffAbs(bodyAngle, angleToPlayer(ctx)) <= SIGHT_ANGLE;
    }),
    playerOutsideRange(LOSE_RANGE),
    randomInterval("idle-look", 20, 60),
    randomInterval("idle-look-end", 3, 10),
    custom("alert-need-turn", (ctx) => {
      const bodyAngle = ctx.blackboard.__body_angle ?? 0;
      return angleDiffAbs(bodyAngle, angleToPlayer(ctx)) > TURN_THRESHOLD;
    }),
    custom("alert-done-turn", (ctx) => {
      const bodyAngle = ctx.blackboard.__body_angle ?? 0;
      return angleDiffAbs(bodyAngle, angleToPlayer(ctx)) <= TURN_DONE_THRESHOLD;
    }),
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
        { trigger: "player-visible", target: "alert" },
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
        { trigger: "player-visible", target: "alert" },
        { trigger: "idle-look-end", target: "idle-walk" },
      ],
    },

    // ─── Alert: Standing ───
    {
      id: "alert",
      animation: { clipName: "idle" },
      onEnter: (ctx) => {
        findHeadBone(ctx);
        ctx.blackboard.__body_angle = ctx.groupRef.current?.rotation.y ?? 0;
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
        { trigger: "alert-need-turn", target: "alert-turning" },
      ],
    },

    // ─── Alert: Turning toward player ───
    {
      id: "alert-turning",
      animation: { clipName: "walk" },
      onEnter: (ctx) => {
        resetHeadBone(ctx);
      },
      onUpdate: (ctx) => {
        const bb = ctx.blackboard;
        bb.__vel_x = 0;
        bb.__vel_z = 0;
        bb.__vel_y = undefined;

        // Smoothly rotate body toward player
        const targetAngle = angleToPlayer(ctx);
        bb.__body_angle = lerpAngle(bb.__body_angle ?? 0, targetAngle, DIR_LERP_SPEED * ctx.delta);

        if (ctx.groupRef.current) {
          ctx.groupRef.current.rotation.y = bb.__body_angle;
        }
      },
      transitions: [
        { trigger: "mouse-left-click", target: "ascending" },
        { trigger: `player-outside-${LOSE_RANGE}`, target: "idle-walk" },
        { trigger: "alert-done-turn", target: "alert" },
      ],
    },

    // ─── Ascending ───
    {
      id: "ascending",
      animation: { clipName: "ascend" },
      onEnter: (ctx) => {
        resetHeadBone(ctx);
        const bb = ctx.blackboard;
        bb.__inflate_t = 0;
        bb.__inflate_meshes = [];

        if (!ctx.groupRef.current) return;

        ctx.groupRef.current.traverse((node: any) => {
          if (node.isMesh && node.geometry) {
            // Clone geometry so we only mutate this instance
            const cloned = (node.geometry as THREE.BufferGeometry).clone();
            node.geometry = cloned;

            const posAttr = cloned.getAttribute("position");
            if (!posAttr) return;

            const original = new Float32Array(posAttr.array.length);
            original.set(posAttr.array as Float32Array);

            cloned.computeBoundingSphere();
            const center = cloned.boundingSphere!.center;
            const radius = cloned.boundingSphere!.radius;

            const spherePositions = new Float32Array(original.length);
            for (let i = 0; i < original.length; i += 3) {
              const dx = original[i] - center.x;
              const dy = original[i + 1] - center.y;
              const dz = original[i + 2] - center.z;
              const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
              spherePositions[i] = center.x + (dx / dist) * radius;
              spherePositions[i + 1] = center.y + (dy / dist) * radius;
              spherePositions[i + 2] = center.z + (dz / dist) * radius;
            }

            bb.__inflate_meshes.push({ posAttr, original, spherePositions });
          }
        });
      },
      onUpdate: (ctx) => {
        const bb = ctx.blackboard;
        bb.__ascend_elapsed = (bb.__ascend_elapsed ?? 0) + ctx.delta;
        const ramp = Math.min(bb.__ascend_elapsed / 1, 1); // ease in over 1s
        const easedRamp = ramp * ramp; // quadratic ease-in

        bb.__vel_x = 0;
        bb.__vel_z = 0;
        bb.__vel_y = ASCEND_SPEED * easedRamp;

        bb.__inflate_t = Math.min((bb.__inflate_t ?? 0) + ctx.delta * 0.5, 1);
        const t = bb.__inflate_t;

        const meshes = bb.__inflate_meshes ?? [];
        for (const { posAttr, original, spherePositions } of meshes) {
          const arr = posAttr.array as Float32Array;
          for (let i = 0; i < arr.length; i++) {
            arr[i] = original[i] + (spherePositions[i] - original[i]) * t;
          }
          posAttr.needsUpdate = true;
        }

        // Balloon scale-up
        if (ctx.groupRef.current) {
          const s = 1 + t * 0.5;
          ctx.groupRef.current.scale.set(s, s, s);
        }
      },
      transitions: [],
    },
  ],
};
