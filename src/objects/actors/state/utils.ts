import type { MotionOutput, StateDef, StateMachineConfig, MouseFlag, ConfigMaps, ResolvedTransition } from "./types";
import { reportContentError } from "../../../utils/utils";
import { MOUSE_ONE_SHOT_FLAGS } from "./enums";
import { TriggerDef, TriggerFn } from "./types";
import type { TriggerContext } from "./types";
import { playerEyeY } from "../../../player/spec";

/** The pitch (radians, + = up) from this actor's eyes, `eyeOffset` above its positionRef, to the nearest
 *  player's eyes (player/spec.ts PLAYER_EYE_HEIGHT): what a head-tracking NPC's head tilts by to look the
 *  player in the eye. */
export const pitchToPlayerEyes = (ctx: TriggerContext, eyeOffset: number): number => {
  const self = ctx.positionRef.current;
  const player = ctx.playerPosition;
  const rise = playerEyeY(player.y) - (self.y + eyeOffset);
  return Math.atan2(rise, Math.hypot(player.x - self.x, player.z - self.z));
};

export const createMotionOutput = (): MotionOutput => ({ vx: 0, vy: null, vz: 0, yaw: 0 });

/** Wrap to (−π, π]. */
export const wrapAngle = (a: number): number => {
  let d = a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d <= -Math.PI) d += Math.PI * 2;
  return d;
};

export const angleDiffAbs = (a: number, b: number): number => Math.abs(wrapAngle(b - a));

/** Shortest-arc interpolation; `t` clamped to [0, 1]. */
export const lerpAngle = (a: number, b: number, t: number): number => a + wrapAngle(b - a) * Math.min(Math.max(t, 0), 1);

/** Step from `a` toward `b` by at most `maxStep` radians along the shortest arc. */
export const stepAngle = (a: number, b: number, maxStep: number): number => {
  const d = wrapAngle(b - a);
  return Math.abs(d) <= maxStep ? b : a + Math.sign(d) * maxStep;
};

/** `__mouse_hover_enter` → `mouse-hover-enter`, the wire action name. */
export const mouseActionOf = (flag: MouseFlag): string => flag.slice(2).replace(/_/g, "-");
const FLAG_BY_ACTION = new Map<string, MouseFlag>(MOUSE_ONE_SHOT_FLAGS.map((f) => [mouseActionOf(f), f]));
export const mouseFlagOf = (action: string): MouseFlag | undefined => FLAG_BY_ACTION.get(action);

/** A broken config is a typo that would otherwise silently never fire. */
const reportConfigError = (message: string): void => reportContentError(`[state machine] ${message}`);

// Pure functions of the module-constant config — once per config, not per instance.
const configMapsCache = new WeakMap<StateMachineConfig, ConfigMaps>();
export const getConfigMaps = (config: StateMachineConfig): ConfigMaps => {
  const cached = configMapsCache.get(config);
  if (cached) return cached;
  const stateMap = new Map<string, StateDef>();
  for (const s of config.states) stateMap.set(s.id, s);
  const triggerById = new Map<string, TriggerDef>();
  for (const t of config.triggers ?? []) triggerById.set(t.id, t);
  for (const s of config.states) {
    for (const tr of s.transitions) if (typeof tr.trigger !== "string" && !triggerById.has(tr.trigger.id)) triggerById.set(tr.trigger.id, tr.trigger);
  }
  if (!stateMap.has(config.initialState)) reportConfigError(`initialState "${config.initialState}" is not a state`);
  const transitionsOf = new Map<string, ResolvedTransition[]>();
  for (const s of config.states) {
    const resolved: ResolvedTransition[] = [];
    for (const tr of s.transitions) {
      const trigger = typeof tr.trigger === "string" ? triggerById.get(tr.trigger) : tr.trigger;
      if (!stateMap.has(tr.target)) reportConfigError(`state "${s.id}" transitions to unknown state "${tr.target}"`);
      if (!trigger) {
        reportConfigError(
          `state "${s.id}" names unknown trigger "${tr.trigger}" — pass the trigger object itself (e.g. \`trigger: afterDelay(2)\`) or list it in \`triggers\``,
        );
        continue;
      }
      resolved.push({ trigger, target: tr.target, guard: tr.guard });
    }
    transitionsOf.set(s.id, resolved);
  }
  const maps: ConfigMaps = { stateMap, transitionsOf, triggers: [...triggerById.values()] };
  configMapsCache.set(config, maps);
  return maps;
};

/** True when the machine can fire the trigger with this id (e.g. "mouse-left-click"). */
export const machineHasTrigger = (config: StateMachineConfig, id: string): boolean =>
  getConfigMaps(config).triggers.some((t) => t.id === id);

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
