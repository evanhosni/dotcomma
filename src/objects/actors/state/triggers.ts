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
  return {
    id,
    evaluate: (ctx) => {
      if (ctx.blackboard[timerKey] === undefined) {
        ctx.blackboard[timerKey] =
          minSeconds + Math.random() * (maxSeconds - minSeconds);
      }
      if (ctx.stateElapsed >= ctx.blackboard[timerKey]) {
        ctx.blackboard[timerKey] =
          minSeconds + Math.random() * (maxSeconds - minSeconds);
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

// ─── Mouse Triggers ───

function mouseTrigger(id: string, flagKey: string, defaultDistance: number) {
  return (distance: number = defaultDistance): TriggerDef => {
    const distanceSq = distance * distance;
    return {
      id,
      evaluate: (ctx) =>
        !!ctx.blackboard[flagKey] && ctx.playerDistanceSq <= distanceSq,
    };
  };
}

export const onMouseHoverEnter = mouseTrigger("mouse-hover-enter", "__mouse_hover_enter", 50);
export const onMouseHoverLeave = mouseTrigger("mouse-hover-leave", "__mouse_hover_leave", 50);
export const onMouseLeftClick = mouseTrigger("mouse-left-click", "__mouse_left_click", 30);
export const onMouseRightClick = mouseTrigger("mouse-right-click", "__mouse_right_click", 30);
export const onMouseLeftClickDown = mouseTrigger("mouse-left-click-down", "__mouse_left_click_down", 30);
export const onMouseRightClickDown = mouseTrigger("mouse-right-click-down", "__mouse_right_click_down", 30);
export const onMouseLeftClickUp = mouseTrigger("mouse-left-click-up", "__mouse_left_click_up", 30);
export const onMouseRightClickUp = mouseTrigger("mouse-right-click-up", "__mouse_right_click_up", 30);
export const onMouseScroll = mouseTrigger("mouse-scroll", "__mouse_scroll", 30);
export const onMouseScrollUp = mouseTrigger("mouse-scroll-up", "__mouse_scroll_up", 30);
export const onMouseScrollDown = mouseTrigger("mouse-scroll-down", "__mouse_scroll_down", 30);
export const onMouseDoubleClick = mouseTrigger("mouse-double-click", "__mouse_double_click", 30);
export const onMouseMiddleClick = mouseTrigger("mouse-middle-click", "__mouse_middle_click", 30);
