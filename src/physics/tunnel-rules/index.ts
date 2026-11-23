/**
 * THE BODY UNDERGROUND (CLAUDE.md "Tunnels"): whether a capsule is in a cave or sewer, what the terrain
 * heightfields are to its step there (overhead terrain is not ground), a manhole's catch, climb and exit,
 * the tunnel's backstops, and its sewage. Run before every step, on a TunnelSpace: the player's
 * (player/hooks.ts) and every server NPC's (server GroundBody) — one rule set, so an NPC goes
 * wherever the player goes. Three-free; it never moves the body itself: the caller applies `teleport`.
 */
import type { TunnelSpace } from "../../generation/underground/field/TunnelSpace";
import { LADDER_FACE, LADDER_SLAB_WIDTH } from "../../generation/underground/chunks/spec";
import type { ManholeInfo, TunnelEntrance } from "../../generation/underground/types";
import type { Ladder, TunnelState, TunnelStep, TunnelBody } from "./types";

/** Inside once the point this far over the feet is in tunnel air; outside once the field there has exceeded
 *  EXIT_FIELD for EXIT_STEPS steps running (one reading never flips the state: the safety nets lifted a
 *  player out of a cave onto the summit on a single false "outside"). */
export const PROBE_OVER_FEET = 0.3;
const EXIT_FIELD = 0.5;
const EXIT_STEPS = 10;
/** The floor backstop: the probe point this deep in rock is a sunk body, not a foot on a bumpy floor (the
 *  nets' triangles sit within ~0.3u of the field's zero); the floor's surface is looked for this far up,
 *  and the feet set this much over it (a coarse air sample set them 0.15u UNDER a sewer floor, where the
 *  sewage's swim sank them again: a bounce). */
const SUNK_FIELD = 0.15;
const SUNK_REACH = 6;
const SUNK_LIFT = 0.05;
/** The wall backstop: the probe point in rock BESIDE the capsule (a wall's collider absent for one step:
 *  a sprint frame puts the axis 0.16u into the wall, and from inside, the walls hold nothing in any
 *  direction) is pushed out along the field's gradient to this much air past the radius. */
const WALL_ESCAPE_CLEARANCE = 0.1;
/** Manholes: the catch (feet within this under the street), the hold (until the feet are this far under),
 *  the vault's landing (this far over the exit), and the closed cover's solid band. */
const CATCH_BELOW_STREET = 1;
const HOLD_BELOW_STREET = 2;
const EXIT_OVER_STREET = 0.1;
const CLOSED_SOLID_BELOW_STREET = 0.5;
const CLOSED_HEAD_CLEARANCE = 0.15;
/** EVERY ladder (a `Ladder`): grabbed by walking at it (the walk's component toward its face at least
 *  LADDER_TOWARD of the walk, the capsule within LADDER_REACH of touching it); forward climbs, back climbs
 *  down (letting go LADDER_FLOOR_RELEASE over its bottom), a jump lets go (a vault when it has an exit and
 *  the feet are within LADDER_VAULT_BELOW_TOP of its top). It is climbed until the feet stand
 *  LADDER_TOP_CLEARANCE over its top, clear of the bumps of whatever it leads onto (a manhole's street rim:
 *  the frame ground is the higher of drawn and exact), where the walk steps off onto it; under a ceiling,
 *  until the head is under it. On it, the capsule is drawn to LADDER_GAP off the face. */
const CLIMB_SPEED = 5;
const LADDER_TOWARD = 0.5;
const LADDER_REACH = 0.4;
const LADDER_GAP = 0.1;
const LADDER_PULL_SPEED = 4;
const LADDER_TOP_CLEARANCE = 0.4;
const LADDER_FLOOR_RELEASE = 0.15;
const LADDER_VAULT_BELOW_TOP = 0.6;
/** A jump off: a hop up, and a push straight out from the face until the capsule stands this far off it
 *  or the hop has come back down to where it left. The walk takes over after it (W still held walks back
 *  and grabs it again). */
const LADDER_JUMP_OFF_SPEED = 8;
const LADDER_PUSH_SPEED = 5;
const LADDER_PUSH_DISTANCE = 0.6;

export const createTunnelState = (): TunnelState => ({ inside: false, exitSteps: 0, outsideFor: Infinity, holding: false, column: null, onLadder: false, pushingOff: false, pushFromFeet: 0 });

export const resetTunnelState = (state: TunnelState): void => {
  state.inside = false;
  state.exitSteps = 0;
  state.outsideFor = Infinity;
  state.holding = false;
  state.column = null;
  state.onLadder = false;
  state.pushingOff = false;
};

export const createTunnelStep = (): TunnelStep => ({
  ignoreTerrain: false,
  vyOverride: null,
  holdWalk: false,
  sewageY: NaN,
  teleportX: NaN,
  teleportY: NaN,
  teleportZ: NaN,
  resetMotion: false,
  pushX: 0,
  pushZ: 0,
});

const teleport = (step: TunnelStep, x: number, y: number, z: number): void => {
  step.teleportX = x;
  step.teleportY = y;
  step.teleportZ = z;
};

/** The step's adjustments for the body (written into `step`, returned). */
export const stepTunnelRules = (space: TunnelSpace, state: TunnelState, step: TunnelStep, body: TunnelBody, dt: number): TunnelStep => {
  const half = body.height / 2;
  const feet = body.y - half;
  const probe = space.probe(body.x, feet + PROBE_OVER_FEET, body.z);
  if (probe.known) {
    if (!state.inside && probe.field < 0) state.inside = true;
    if (state.inside) {
      state.exitSteps = probe.field > EXIT_FIELD ? state.exitSteps + 1 : 0;
      if (state.exitSteps >= EXIT_STEPS) state.inside = false;
    }
  }
  state.outsideFor = state.inside ? 0 : state.outsideFor + dt;
  step.ignoreTerrain = false;
  step.vyOverride = null;
  step.holdWalk = false;
  step.sewageY = state.inside ? probe.sewageY : NaN;
  step.teleportX = NaN;
  step.resetMotion = false;
  step.pushX = 0;
  step.pushZ = 0;

  const column = space.manholeColumnAt(body.x, body.z, feet);
  if (column) {
    const info = column.entrance.manhole!;
    const street = info.streetY;
    const entering = state.column !== column.entrance.id;
    state.column = column.entrance.id;
    if (column.open) {
      step.ignoreTerrain = true;
      if (entering && feet >= street - CATCH_BELOW_STREET && feet <= street + 1) {
        // Stepping onto an open manhole from outside: snapped to its center and held until well under
        // the street (never a body climbing out: the column is its own already).
        teleport(step, column.entrance.x, body.y, column.entrance.z);
        state.holding = true;
      }
      if (state.holding) {
        step.holdWalk = true;
        if (feet < street - HOLD_BELOW_STREET) state.holding = false;
      }
    } else if (feet < street - CLOSED_SOLID_BELOW_STREET) {
      // Closed: solid street from a little under it up; below that, the column's air.
      step.ignoreTerrain = true;
    } else {
      state.onLadder = false;
      return step;
    }
    climbLadder(manholeLadder(column.entrance, info, column.open), state, step, body, feet, dt);
    return step;
  }
  state.holding = false;
  state.column = null;
  state.onLadder = false;
  state.pushingOff = false;

  // In a mouth's cut the ground is the entrance patch, exactly as drawn — inside or out: the heightfield
  // there is the uncut hood over the opening, a wall to a body walking out at the floor (an NPC sweep
  // stuck 68 of 210 walks out of 35 mouths at the opening's plane).
  const inCut = space.inMouthCutAt(body.x, feet, body.z);
  if (inCut) step.ignoreTerrain = true;

  if (state.inside) {
    // In the tunnel's AIR the terrain is not ground (overhead, or the ground over an opening, which the
    // drawing cuts): the tunnel's colliders carry the body. Out of it — across a mouth's opening plane —
    // it is. Ignored where the heightfield stood more than an autostep over the tunnel floor instead,
    // the rule flipped every frame at a mouth's lip, where the hill face stood 0.3–0.8u over the floor
    // inside the opening: a player who walked in could not walk out (Evan, the cave at (-3604, -17706);
    // MEASURED in the page).
    if (probe.field < 0) step.ignoreTerrain = true;
    const probeY = feet + PROBE_OVER_FEET;
    // The field's rock is not real anywhere in a mouth's cut: the air there is the tunnel's AND the open
    // air over the drawn ground (the field closes each mouth at its opening), and the patch, its collider,
    // is exact (pushed back into the tunnel from the opening's lip, a body walking out was held at the
    // opening every step).
    const realRock = probe.field > 0 && !inCut;
    // The capsule's axis is never in rock beside it: a wall embed (a step without the wall's collider)
    // is undone at once, before the next step carries it deeper, where the field has no gradient.
    if (realRock) {
      const out = space.escapeFromRockAt(body.x, probeY, body.z, body.radius + WALL_ESCAPE_CLEARANCE);
      if (out && !out.vertical) {
        teleport(step, out.x, body.y + (out.y - probeY), out.z);
        return step;
      }
    }
    // The tunnel's own backstop (the ground nets are off in here): feet sunk SUNK_FIELD into the rock
    // under a floor are set back on the air over it, with the fall stopped — a floor whose collider is
    // missing or tunnelled through can never drop the body into the rock (and from there, ten steps
    // later, "outside" and onto the summit).
    if (realRock && probe.field > SUNK_FIELD) {
      const surface = space.airAboveAt(body.x, probeY, body.z, SUNK_REACH);
      if (!Number.isNaN(surface)) {
        teleport(step, body.x, surface + SUNK_LIFT + half, body.z);
        step.vyOverride = 0;
      }
    }
  }
  return step;
};

const _ladder: Ladder = { x: 0, z: 0, faceX: 0, faceZ: 0, halfWidth: 0, bottomY: 0, topY: 0, ceilingY: NaN, exitX: NaN, exitY: NaN, exitZ: NaN };

/** A manhole's ladder: its slab from the junction floor to the street, under the cover when it is closed,
 *  vaulting onto the exit beside the hole when it is open. */
const manholeLadder = (e: TunnelEntrance, info: ManholeInfo, open: boolean): Ladder => {
  _ladder.x = e.x + info.faceX * LADDER_FACE;
  _ladder.z = e.z + info.faceZ * LADDER_FACE;
  _ladder.faceX = info.faceX;
  _ladder.faceZ = info.faceZ;
  _ladder.halfWidth = LADDER_SLAB_WIDTH / 2;
  _ladder.bottomY = info.floorY;
  _ladder.topY = info.streetY;
  _ladder.ceilingY = open ? NaN : info.streetY - CLOSED_HEAD_CLEARANCE;
  _ladder.exitX = open ? info.exitX : NaN;
  _ladder.exitY = info.exitY + EXIT_OVER_STREET;
  _ladder.exitZ = info.exitZ;
  return _ladder;
};

/** Any ladder (CLIMB_SPEED): grabbed, climbed, stepped off at its top or jumped off. */
const climbLadder = (l: Ladder, state: TunnelState, step: TunnelStep, body: TunnelBody, feet: number, dt: number): void => {
  const walk = Math.hypot(body.moveX, body.moveZ);
  const toward = walk > 0 ? (body.moveX * l.faceX + body.moveZ * l.faceZ) / walk : 0;
  const forward = toward >= LADDER_TOWARD;
  const back = toward <= -LADDER_TOWARD;
  const capped = !Number.isNaN(l.ceilingY);
  const top = capped ? Math.min(l.topY + LADDER_TOP_CLEARANCE, l.ceilingY - body.height) : l.topY + LADDER_TOP_CLEARANCE;
  if (state.pushingOff) {
    const off = -((body.x - l.x) * l.faceX + (body.z - l.z) * l.faceZ) - body.radius;
    if (off < LADDER_PUSH_DISTANCE && feet >= state.pushFromFeet) {
      step.pushX = -l.faceX * LADDER_PUSH_SPEED;
      step.pushZ = -l.faceZ * LADDER_PUSH_SPEED;
      return;
    }
    state.pushingOff = false;
  }
  if (!state.onLadder) {
    const dx = body.x - l.x;
    const dz = body.z - l.z;
    const touching = dx * l.faceX + dz * l.faceZ >= -(body.radius + LADDER_REACH) && Math.abs(dx * l.faceZ - dz * l.faceX) <= l.halfWidth + body.radius;
    if (!forward || !touching || body.jump || state.holding || feet >= top) return;
    state.onLadder = true;
  }
  if (body.jump) {
    state.onLadder = false;
    if (!Number.isNaN(l.exitX) && feet >= l.topY - LADDER_VAULT_BELOW_TOP) {
      teleport(step, l.exitX, l.exitY + body.height / 2, l.exitZ);
      step.resetMotion = true;
      state.column = null;
      step.holdWalk = true;
      step.vyOverride = 0;
      return;
    }
    step.vyOverride = LADDER_JUMP_OFF_SPEED;
    step.pushX = -l.faceX * LADDER_PUSH_SPEED;
    step.pushZ = -l.faceZ * LADDER_PUSH_SPEED;
    state.pushingOff = true;
    state.pushFromFeet = feet;
    return;
  }
  if (back && feet <= l.bottomY + LADDER_FLOOR_RELEASE) {
    state.onLadder = false;
    return;
  }
  if (!capped && forward && feet >= top - LADDER_FLOOR_RELEASE) {
    // Over the top the walk carries the body onto what the ladder leads to. Out of the tunnel there:
    // inside, the wall backstop took the open air past a manhole's shaft for rock and pushed the body
    // back in every step. A top still in tunnel air reads inside again on the next probe.
    state.inside = false;
    state.exitSteps = 0;
    step.vyOverride = 0;
    return;
  }
  step.holdWalk = true;
  step.vyOverride = back ? -CLIMB_SPEED : forward ? Math.min(CLIMB_SPEED, Math.max(0, (top - feet) / dt)) : 0;
  const reach = body.radius + LADDER_GAP;
  const dx = l.x - l.faceX * reach - body.x;
  const dz = l.z - l.faceZ * reach - body.z;
  const off = Math.hypot(dx, dz);
  if (off > 1e-4) {
    const pull = Math.min(1, (LADDER_PULL_SPEED * dt) / off);
    teleport(step, body.x + dx * pull, body.y, body.z + dz * pull);
  }
};
