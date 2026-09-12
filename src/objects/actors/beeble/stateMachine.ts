import type * as THREE from "three";
import { angleDiffAbs, lerpAngle } from "../state/motion";
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
} from "../state/triggers";
import type { BehaviorContext, StateMachineConfig, TriggerContext } from "../state/types";
import { beginInflate, type Inflate } from "./inflate";

/**
 * THE BEEBLE'S BEHAVIOR — the template for every NPC. Wanders, notices a
 * player in its sight cone, turns to face them, ascends when clicked.
 *
 * Movement and facing go through `ctx.motion`, animation through the state's
 * `animation` shorthand (or `ctx.animation`); the framework applies both on
 * the server and on every client. Only the head bone and the sphere-inflate
 * touch the scene, and both guard on `ctx.groupRef.current` (null on the
 * server). See ../state/runner.ts for the contract.
 */

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

const randomAngle = (): number => Math.random() * Math.PI * 2;
const randomRange = (min: number, max: number): number => min + Math.random() * (max - min);
const angleToPlayer = (ctx: TriggerContext): number => ctx.motion.angleTo(ctx.playerPosition.x, ctx.playerPosition.z);

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

/** Turn the head toward the player, relative to the body's facing (a scene
 *  effect — the bone only exists on the client). */
function updateHeadTracking(ctx: BehaviorContext): void {
  const bone = ctx.blackboard.__head_bone as THREE.Bone | undefined;
  if (!bone) return;
  let relAngle = angleToPlayer(ctx) - ctx.motion.yaw;
  while (relAngle > Math.PI) relAngle -= Math.PI * 2;
  while (relAngle < -Math.PI) relAngle += Math.PI * 2;
  relAngle = Math.max(-MAX_HEAD_TURN, Math.min(MAX_HEAD_TURN, relAngle));
  bone.rotation.y = lerpAngle(bone.rotation.y, relAngle, HEAD_LERP_SPEED * ctx.delta);
}

/** PER-PLAYER effect, the example: the click that will inflate this beeble for
 *  EVERYONE (the `ascending` state everyone's mirror enters) also logs — but
 *  only on the screen of the player who clicked. On a client mirror
 *  `ctx.input` carries this player's own inputs; the groupRef guard keeps the
 *  server (which sees every player's clicks) out of it. Lives in the states
 *  the click LANDS in (alert / alert-turning), not the one it leads to. */
function logLocalClick(ctx: BehaviorContext): void {
  if (ctx.groupRef.current && ctx.input.leftClick) console.log("you clicked me");
}

// ─── State Machine ───

export const BEEBLE_SM: StateMachineConfig = {
  initialState: "idle-walk",
  triggers: [
    custom("player-visible", (ctx) => {
      if (ctx.playerDistanceSq > SIGHT_RANGE * SIGHT_RANGE) return false;
      return angleDiffAbs(ctx.motion.yaw, angleToPlayer(ctx)) <= SIGHT_ANGLE;
    }),
    playerOutsideRange(LOSE_RANGE),
    randomInterval("idle-look", 20, 60),
    randomInterval("idle-look-end", 3, 10),
    custom("alert-need-turn", (ctx) => angleDiffAbs(ctx.motion.yaw, angleToPlayer(ctx)) > TURN_THRESHOLD),
    custom("alert-done-turn", (ctx) => angleDiffAbs(ctx.motion.yaw, angleToPlayer(ctx)) <= TURN_DONE_THRESHOLD),
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
      animation: { clip: "walk" },
      onEnter: (ctx) => {
        const bb = ctx.blackboard;
        const angle = randomAngle();
        bb.__dir_angle = angle;
        bb.__dir_target = angle;
        bb.__dir_timer = randomRange(1, 5);
        bb.__dir_elapsed = 0;
        ctx.motion.face(angle);
        resetHeadBone(ctx);
      },
      onUpdate: (ctx) => {
        const bb = ctx.blackboard;

        // Pick a new heading every few seconds…
        bb.__dir_elapsed += ctx.delta;
        if (bb.__dir_elapsed >= bb.__dir_timer) {
          bb.__dir_target = randomAngle();
          bb.__dir_timer = randomRange(1, 5);
          bb.__dir_elapsed = 0;
        }
        // …and ease toward it.
        bb.__dir_angle = lerpAngle(bb.__dir_angle, bb.__dir_target, DIR_LERP_SPEED * ctx.delta);

        ctx.motion.heading(bb.__dir_angle, BEEBLE_SPEED).fly(null).face(bb.__dir_angle);
      },
      transitions: [
        { trigger: "player-visible", target: "alert" },
        { trigger: "idle-look", target: "idle-look" },
      ],
    },

    // ─── Idle: Looking at Hands ───
    {
      id: "idle-look",
      animation: { clip: "stare at hands", loop: "once" },
      onEnter: (ctx) => {
        ctx.motion.stop();
        resetHeadBone(ctx);
      },
      transitions: [
        { trigger: "player-visible", target: "alert" },
        { trigger: "idle-look-end", target: "idle-walk" },
      ],
    },

    // ─── Alert: Standing ───
    {
      id: "alert",
      animation: { clip: "idle" },
      onEnter: (ctx) => {
        ctx.motion.stop();
        findHeadBone(ctx);
      },
      onUpdate: (ctx) => {
        updateHeadTracking(ctx);
        logLocalClick(ctx);
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
      animation: { clip: "walk" },
      onEnter: (ctx) => {
        ctx.motion.stop();
        resetHeadBone(ctx);
      },
      onUpdate: (ctx) => {
        ctx.motion.turnToward(ctx.playerPosition.x, ctx.playerPosition.z, DIR_LERP_SPEED * ctx.delta);
        logLocalClick(ctx);
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
      animation: { clip: "ascend" },
      onEnter: (ctx) => {
        resetHeadBone(ctx);
        ctx.motion.move(0, 0);
        const group = ctx.groupRef.current;
        if (!group) return;
        // Sphere morph + scale-up — a scene effect, so client only (inflate.ts).
        const inflate = beginInflate(group);
        ctx.blackboard.__inflate = inflate;
        return () => {
          inflate.dispose();
          ctx.blackboard.__inflate = null;
        };
      },
      onUpdate: (ctx) => {
        const ramp = Math.min(ctx.stateElapsed / 1, 1); // ease in over 1s
        ctx.motion.fly(ASCEND_SPEED * ramp * ramp);
        (ctx.blackboard.__inflate as Inflate | null)?.update(ctx.delta);
      },
      transitions: [],
    },
  ],
};
