import { mouseActionOf, type MouseFlag } from "./runner";
import { TriggerDef, TriggerFn } from "./types";

export function playerWithinRange(range: number): TriggerDef {
  const rangeSq = range * range;
  return {
    id: `player-within-${range}`,
    evaluate: (ctx) => ctx.playerDistanceSq <= rangeSq,
  };
}

export function playerOutsideRange(range: number): TriggerDef {
  const rangeSq = range * range;
  return {
    id: `player-outside-${range}`,
    evaluate: (ctx) => ctx.playerDistanceSq > rangeSq,
  };
}

export function afterDelay(seconds: number): TriggerDef {
  return {
    id: `after-${seconds}s`,
    evaluate: (ctx) => ctx.stateElapsed >= seconds,
  };
}

export function blackboardFlag(key: string): TriggerDef {
  return {
    id: `flag-${key}`,
    evaluate: (ctx) => !!ctx.blackboard[key],
  };
}

export function randomInterval(
  id: string,
  minSeconds: number,
  maxSeconds: number
): TriggerDef {
  const timerKey = `__timer_${id}`;
  const rollSeconds = () => minSeconds + Math.random() * (maxSeconds - minSeconds);
  return {
    id,
    evaluate: (ctx) => {
      if (ctx.blackboard[timerKey] === undefined) ctx.blackboard[timerKey] = rollSeconds();
      if (ctx.stateElapsed >= ctx.blackboard[timerKey]) {
        ctx.blackboard[timerKey] = rollSeconds();
        return true;
      }
      return false;
    },
  };
}

export function custom(id: string, evaluate: TriggerFn): TriggerDef {
  return { id, evaluate };
}

export function always(id: string = "always"): TriggerDef {
  return {
    id,
    evaluate: () => true,
  };
}

/** Mouse triggers read the one-shot flags forwarded inputs raise (input.ts decides whose input it is on each
 *  side); the trigger id is the flag's wire action (`mouse-left-click`), which machineHasTrigger looks up. */
function mouseTrigger(flag: MouseFlag, defaultDistance: number) {
  const id = mouseActionOf(flag);
  return (distance: number = defaultDistance): TriggerDef => {
    const distanceSq = distance * distance;
    return {
      id,
      evaluate: (ctx) => !!ctx.blackboard[flag] && ctx.playerDistanceSq <= distanceSq,
    };
  };
}

export const onMouseHoverEnter = mouseTrigger("__mouse_hover_enter", 50);
export const onMouseHoverLeave = mouseTrigger("__mouse_hover_leave", 50);
export const onMouseLeftClick = mouseTrigger("__mouse_left_click", 30);
export const onMouseRightClick = mouseTrigger("__mouse_right_click", 30);
export const onMouseLeftClickDown = mouseTrigger("__mouse_left_click_down", 30);
export const onMouseRightClickDown = mouseTrigger("__mouse_right_click_down", 30);
export const onMouseLeftClickUp = mouseTrigger("__mouse_left_click_up", 30);
export const onMouseRightClickUp = mouseTrigger("__mouse_right_click_up", 30);
export const onMouseScroll = mouseTrigger("__mouse_scroll", 30);
export const onMouseScrollUp = mouseTrigger("__mouse_scroll_up", 30);
export const onMouseScrollDown = mouseTrigger("__mouse_scroll_down", 30);
export const onMouseDoubleClick = mouseTrigger("__mouse_double_click", 30);
export const onMouseMiddleClick = mouseTrigger("__mouse_middle_click", 30);
