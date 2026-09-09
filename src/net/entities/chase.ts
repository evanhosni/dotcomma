/**
 * Proportional chase with feedforward: the velocity a body should move at to
 * track a target that is itself moving. Used by the kinematic mover for every
 * synced actor — the server publishes position + velocity; the body follows,
 * so terrain height, slopes and collisions stay with the body's own
 * controller. Blocked by a wall, the body lags the server's position and
 * catches up when it clears (the tolerated, continuous kind of divergence).
 *
 * Feedforward matters: a plain proportional chase trails a moving target by
 * speed/gain and then visibly slides that distance when the target stops.
 * With the target's velocity fed forward the steady-state lag is ~0, and a
 * STOPPED target is accepted within `stopDeadzone` (the body is never exactly
 * on the server's path — being blocked by the very player it noticed, say) so
 * it stops dead instead of gliding the last centimetres.
 */
export interface ChaseVelocity {
  vx: number;
  vz: number;
}

export const chaseVelocity = (
  cx: number,
  cz: number,
  tx: number,
  tz: number,
  tvx: number,
  tvz: number,
  gain: number,
  maxSpeed: number,
  stopDeadzone: number,
  out: ChaseVelocity,
): ChaseVelocity => {
  const dx = tx - cx;
  const dz = tz - cz;
  const still = tvx === 0 && tvz === 0;
  if (still && dx * dx + dz * dz < stopDeadzone * stopDeadzone) {
    out.vx = 0;
    out.vz = 0;
    return out;
  }
  const g = still ? gain * 2 : gain;
  let vx = tvx + dx * g;
  let vz = tvz + dz * g;
  const v = Math.hypot(vx, vz);
  if (v > maxSpeed) {
    vx *= maxSpeed / v;
    vz *= maxSpeed / v;
  }
  out.vx = vx;
  out.vz = vz;
  return out;
};
