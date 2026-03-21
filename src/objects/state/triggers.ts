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
