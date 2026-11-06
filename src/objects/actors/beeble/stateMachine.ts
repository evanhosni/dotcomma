import { angleDiffAbs, lerpAngle } from "../state/motion";
import { custom, onMouseLeftClick, playerOutsideRange, randomInterval } from "../state/triggers";
import type { BehaviorContext, StateMachineConfig, TriggerContext } from "../state/types";
import { HEAD_YAW_INPUT } from "./animations";

/** The template NPC behavior: wanders, notices a player in its sight cone, turns
 *  to face them, ascends when clicked. It never touches the scene: the head turn
 *  is an animation layer fed the yaw (./animations.ts). */

const BEEBLE_SPEED = 5;
const ASCEND_SPEED = 8;
const SIGHT_RANGE = 20;
const LOSE_RANGE = 30;
const DIR_LERP_SPEED = 3;
const HEAD_LERP_SPEED = 5;
const MAX_HEAD_TURN = 50 * (Math.PI / 180);
const SIGHT_ANGLE = 50 * (Math.PI / 180); // FOV half-angle for the alert trigger
const TURN_THRESHOLD = Math.PI / 2; // start turning the body
const TURN_DONE_THRESHOLD = Math.PI / 9; // stop turning, head tracking takes over

const randomAngle = (): number => Math.random() * Math.PI * 2;
const randomRange = (min: number, max: number): number => min + Math.random() * (max - min);
const angleToPlayer = (ctx: TriggerContext): number => ctx.motion.angleTo(ctx.playerPosition.x, ctx.playerPosition.z);

/** Hands the head back to the clip. */
function releaseHead(ctx: BehaviorContext): void {
  ctx.animation.setInput(HEAD_YAW_INPUT, undefined);
}

function updateHeadTracking(ctx: BehaviorContext): void {
  let relAngle = angleToPlayer(ctx) - ctx.motion.yaw;
  while (relAngle > Math.PI) relAngle -= Math.PI * 2;
  while (relAngle < -Math.PI) relAngle += Math.PI * 2;
  relAngle = Math.max(-MAX_HEAD_TURN, Math.min(MAX_HEAD_TURN, relAngle));
  const yaw = ctx.animation.inputs[HEAD_YAW_INPUT] ?? 0;
  ctx.animation.setInput(HEAD_YAW_INPUT, lerpAngle(yaw, relAngle, HEAD_LERP_SPEED * ctx.delta));
}

/** The PER-PLAYER effect example: on a client mirror `ctx.input` is this player's
 *  own input, so this logs only on the clicker's screen (see state/input.ts). */
function logLocalClick(ctx: BehaviorContext): void {
  if (ctx.groupRef.current && ctx.input.leftClick) console.log("you clicked me");
}

const PLAYER_VISIBLE = custom("player-visible", (ctx) => {
  if (ctx.playerDistanceSq > SIGHT_RANGE * SIGHT_RANGE) return false;
  return angleDiffAbs(ctx.motion.yaw, angleToPlayer(ctx)) <= SIGHT_ANGLE;
});
const PLAYER_LOST = playerOutsideRange(LOSE_RANGE);
const IDLE_LOOK = randomInterval("idle-look", 20, 60);
const IDLE_LOOK_END = randomInterval("idle-look-end", 3, 10);
const ALERT_NEED_TURN = custom("alert-need-turn", (ctx) => angleDiffAbs(ctx.motion.yaw, angleToPlayer(ctx)) > TURN_THRESHOLD);
const ALERT_DONE_TURN = custom("alert-done-turn", (ctx) => angleDiffAbs(ctx.motion.yaw, angleToPlayer(ctx)) <= TURN_DONE_THRESHOLD);
const CLICKED = onMouseLeftClick();

export const BEEBLE_SM: StateMachineConfig = {
  initialState: "idle-walk",
  states: [
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
        releaseHead(ctx);
      },
      onUpdate: (ctx) => {
        const bb = ctx.blackboard;
        bb.__dir_elapsed += ctx.delta;
        if (bb.__dir_elapsed >= bb.__dir_timer) {
          bb.__dir_target = randomAngle();
          bb.__dir_timer = randomRange(1, 5);
          bb.__dir_elapsed = 0;
        }
        bb.__dir_angle = lerpAngle(bb.__dir_angle, bb.__dir_target, DIR_LERP_SPEED * ctx.delta);

        ctx.motion.heading(bb.__dir_angle, BEEBLE_SPEED).fly(null).face(bb.__dir_angle);
      },
      transitions: [
        { trigger: PLAYER_VISIBLE, target: "alert" },
        { trigger: IDLE_LOOK, target: "idle-look" },
      ],
    },

    {
      id: "idle-look",
      animation: { clip: "stare at hands", loop: "once" },
      onEnter: (ctx) => {
        ctx.motion.stop();
        releaseHead(ctx);
      },
      transitions: [
        { trigger: PLAYER_VISIBLE, target: "alert" },
        { trigger: IDLE_LOOK_END, target: "idle-walk" },
      ],
    },

    {
      id: "alert",
      animation: { clip: "idle" },
      onEnter: (ctx) => {
        ctx.motion.stop();
      },
      onUpdate: (ctx) => {
        updateHeadTracking(ctx);
        logLocalClick(ctx);
      },
      transitions: [
        { trigger: CLICKED, target: "ascending" },
        { trigger: PLAYER_LOST, target: "idle-walk" },
        { trigger: ALERT_NEED_TURN, target: "alert-turning" },
      ],
    },

    {
      id: "alert-turning",
      animation: { clip: "walk" },
      onEnter: (ctx) => {
        ctx.motion.stop();
        releaseHead(ctx);
      },
      onUpdate: (ctx) => {
        ctx.motion.turnToward(ctx.playerPosition.x, ctx.playerPosition.z, DIR_LERP_SPEED * ctx.delta);
        logLocalClick(ctx);
      },
      transitions: [
        { trigger: CLICKED, target: "ascending" },
        { trigger: PLAYER_LOST, target: "idle-walk" },
        { trigger: ALERT_DONE_TURN, target: "alert" },
      ],
    },

    {
      id: "ascending",
      animation: { clip: "ascend", loop: "once" },
      onEnter: (ctx) => {
        releaseHead(ctx);
        ctx.motion.move(0, 0);
      },
      onUpdate: (ctx) => {
        const ramp = Math.min(ctx.stateElapsed / 1, 1); // ease in over 1s
        ctx.motion.fly(ASCEND_SPEED * ramp * ramp);
      },
      transitions: [],
    },
  ],
};
