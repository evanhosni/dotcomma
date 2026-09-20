import type { EntityUpdateFields } from "../../protocol.js";
import type { StateMachineRunner } from "../../../../src/objects/actors/state/runner";
import type { Pose } from "../physics/npc.js";

/**
 * `Published` = what every registrant last saw. Any positional change goes out
 * as a COMPLETE server-time-stamped snapshot: the client interpolates on that
 * clock (src/net/entities/interpolation.ts), so a snapshot must be self-contained.
 */

export interface Published {
  x: number;
  /** Feet. */
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ry: number;
  clip: string | undefined;
  clipT0: number;
  once: boolean;
  sm: string | undefined;
  state: Record<string, unknown>;
}

const LOOP_ONCE = 2200; // THREE.LoopOnce (state/types.ts) — no Three at runtime here

export const fullUpdate = (p: Published, now: number): EntityUpdateFields => {
  const f: EntityUpdateFields = { st: now, x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, ry: p.ry };
  if (p.clip) {
    f.clip = p.clip;
    f.clipT0 = p.clipT0;
    f.once = p.once;
  }
  if (p.sm) f.sm = p.sm;
  if (Object.keys(p.state).length) f.state = p.state;
  return f;
};

const snapshot = (p: Published, f: EntityUpdateFields, now: number): void => {
  f.st = now;
  f.x = p.x;
  f.y = p.y;
  f.z = p.z;
  f.vx = p.vx;
  f.vy = p.vy;
  f.vz = p.vz;
  f.ry = p.ry;
};

/** pose null = a static entity. Returns the changed fields, or null when nothing changed. */
export const publishTick = (p: Published, pose: Pose | null, runner: StateMachineRunner, now: number): EntityUpdateFields | null => {
  const f: EntityUpdateFields = {};
  let changed = false;

  const ry = runner.blackboard.__yaw ?? p.ry;
  const moved =
    pose !== null &&
    (pose.x !== p.x || pose.y !== p.y || pose.z !== p.z || pose.vx !== p.vx || pose.vy !== p.vy || pose.vz !== p.vz);
  if (moved) {
    p.x = pose.x;
    p.y = pose.y;
    p.z = pose.z;
    p.vx = pose.vx;
    p.vy = pose.vy;
    p.vz = pose.vz;
  }
  if (moved || Math.abs(ry - p.ry) > 1e-3) {
    p.ry = ry;
    snapshot(p, f, now);
    changed = true;
  }

  const anim = runner.animationControl;
  if (anim.dirty) {
    anim.dirty = false;
    const cmd = anim.pendingCommand;
    if (cmd && cmd.clipName !== p.clip) {
      p.clip = cmd.clipName;
      p.clipT0 = now;
      p.once = cmd.loop === LOOP_ONCE;
      f.clip = p.clip;
      f.clipT0 = p.clipT0;
      f.once = p.once;
      changed = true;
    }
  }

  if (runner.currentStateId !== p.sm) {
    p.sm = runner.currentStateId;
    f.sm = p.sm;
    changed = true;
  }
  return changed ? f : null;
};
