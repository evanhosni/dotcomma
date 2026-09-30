import type { EntityUpdateFields } from "../../../../src/net/protocol";
import type { AnimationState } from "../../../../src/objects/actors/state/animation";
import type { StateMachineRunner } from "../../../../src/objects/actors/state/runner";
import type { Pose } from "../physics/npcBody.js";

/**
 * `Published` is what every registrant last saw; `publishTick` diffs a tick against
 * it. Any positional change goes out as a COMPLETE snapshot stamped with server time
 * (`st`) — the client interpolates on that clock, so a snapshot must be self-contained.
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
  anim: AnimationState | null;
  animVersion: number;
  sm: string | undefined;
  state: Record<string, unknown>;
}

export const createPublished = (x: number, y: number, z: number): Published => ({
  x,
  y,
  z,
  vx: 0,
  vy: 0,
  vz: 0,
  ry: 0,
  anim: null,
  animVersion: 0,
  sm: undefined,
  state: {},
});

/** Everything a new registrant needs, as one update. */
export const fullUpdate = (p: Published, now: number): EntityUpdateFields => {
  const f: EntityUpdateFields = { st: now, x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, ry: p.ry };
  if (p.anim) f.anim = { ...p.anim };
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

/** The changed fields, or null when nothing changed (a resting entity costs no bytes). */
export const publishTick = (p: Published, pose: Pose | null, runner: StateMachineRunner, now: number): EntityUpdateFields | null => {
  const f: EntityUpdateFields = {};
  let changed = false;

  const ry = runner.motion.yaw;
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

  const anim = runner.animation;
  if (anim.version !== p.animVersion) {
    p.animVersion = anim.version;
    p.anim = { ...anim.state };
    f.anim = { ...p.anim };
    changed = true;
  }

  if (runner.currentStateId !== p.sm) {
    p.sm = runner.currentStateId;
    f.sm = p.sm;
    changed = true;
  }
  return changed ? f : null;
};
