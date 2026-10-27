import type { LiquidLook, TunnelSpace } from "../utils/workers/underground/tunnelSpace";

/**
 * THE BODY UNDERGROUND (CLAUDE.md "Tunnels"): whether a capsule is in a cave or sewer, what the terrain
 * heightfields are to its step there (overhead terrain is not ground), a manhole's catch, climb and exit,
 * the tunnel's backstops, and its liquid. Run before every step, on a TunnelSpace: the player's
 * (player/undergroundMode.ts) and every server NPC's (server GroundBody) — one rule set, so an NPC goes
 * wherever the player goes. Three-free; it never moves the body itself: the caller applies `teleport`.
 */

/** Inside once the point this far over the feet is in tunnel air; outside once the field there has exceeded
 *  EXIT_FIELD for EXIT_STEPS steps running (one reading never flips the state: the safety nets lifted a
 *  player out of a cave onto the summit on a single false "outside"). */
export const PROBE_OVER_FEET = 0.3;
const EXIT_FIELD = 0.5;
const EXIT_STEPS = 10;
/** The floor backstop: the probe point this deep in rock is a sunk body, not a foot on a bumpy floor (the
 *  nets' triangles sit within ~0.3u of the field's zero); the floor's surface is looked for this far up,
 *  and the feet set this much over it (a coarse air sample set them 0.15u UNDER a sewer floor, where the
 *  liquid's swim sank them again: a bounce). */
const SUNK_FIELD = 0.15;
const SUNK_REACH = 6;
const SUNK_LIFT = 0.05;
/** The wall backstop: the probe point in rock BESIDE the capsule (a wall's collider absent for one step:
 *  a sprint frame puts the axis 0.16u into the wall, and from inside, the walls hold nothing in any
 *  direction) is pushed out along the field's gradient to this much air past the radius. */
const WALL_ESCAPE_CLEARANCE = 0.1;
/** Manholes: the catch (feet within this under the street), the hold (until the feet are this far under), the
 *  climb speed, the exit (a held jump with the feet this close to the street), and the closed cover's solid band. */
const CATCH_BELOW_STREET = 1;
const HOLD_BELOW_STREET = 2;
const CLIMB_SPEED = 7;
const EXIT_BELOW_STREET = 0.6;
const EXIT_OVER_STREET = 0.1;
const CLOSED_SOLID_BELOW_STREET = 0.5;
const CLOSED_HEAD_CLEARANCE = 0.15;

export interface TunnelState {
  inside: boolean;
  exitSteps: number;
  /** Seconds since last inside (Infinity: never). */
  outsideFor: number;
  holding: boolean;
  /** The manhole column the body stands in, by id. */
  column: string | null;
}

export const createTunnelState = (): TunnelState => ({ inside: false, exitSteps: 0, outsideFor: Infinity, holding: false, column: null });

export const resetTunnelState = (state: TunnelState): void => {
  state.inside = false;
  state.exitSteps = 0;
  state.outsideFor = Infinity;
  state.holding = false;
  state.column = null;
};

export interface TunnelStep {
  ignoreTerrain: boolean;
  vyOverride: number | null;
  /** Walking is held still (a manhole's catch). */
  holdWalk: boolean;
  /** The liquid level over the capsule, or NaN, and its viscosity relative to water. */
  liquidY: number;
  liquidViscosity: number;
  liquidLook: LiquidLook;
  /** Move the body's CENTER here before the step (a manhole's catch or exit, a backstop); NaN x: stay. */
  teleportX: number;
  teleportY: number;
  teleportZ: number;
  /** The character's own motion is to be reset (a manhole's exit). */
  resetMotion: boolean;
}

export const createTunnelStep = (): TunnelStep => ({
  ignoreTerrain: false,
  vyOverride: null,
  holdWalk: false,
  liquidY: NaN,
  liquidViscosity: 1,
  liquidLook: "water",
  teleportX: NaN,
  teleportY: NaN,
  teleportZ: NaN,
  resetMotion: false,
});

/** The capsule as the rules see it: its CENTER, its shape, and whether jump is held (an NPC never). */
export interface TunnelBody {
  x: number;
  y: number;
  z: number;
  height: number;
  radius: number;
  jump: boolean;
}

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
  step.liquidY = state.inside ? probe.liquidY : NaN;
  step.liquidViscosity = probe.liquidViscosity;
  step.liquidLook = probe.liquidLook;
  step.teleportX = NaN;
  step.resetMotion = false;

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
      if (body.jump) {
        if (feet >= street - EXIT_BELOW_STREET) {
          teleport(step, info.exitX, info.exitY + EXIT_OVER_STREET + half, info.exitZ);
          step.resetMotion = true;
          state.holding = false;
          state.column = null;
          step.holdWalk = true;
          step.vyOverride = 0;
          return step;
        }
        step.vyOverride = CLIMB_SPEED;
      }
      return step;
    }
    // Closed: solid street from a little under it up; below that, in the column, a held jump climbs
    // to just under the cover and hangs there.
    if (feet < street - CLOSED_SOLID_BELOW_STREET) {
      step.ignoreTerrain = true;
      if (body.jump) step.vyOverride = feet + body.height < street - CLOSED_HEAD_CLEARANCE ? CLIMB_SPEED : 0;
    }
    return step;
  }
  state.holding = false;
  state.column = null;

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
    // The rock in front of a mouth's opening is the field's closure, not rock: open air over the ground.
    // Pushed out of it, a player stepping out of a mouth was put back in every frame. Nor is the field's
    // rock real anywhere in a mouth's cut: the air there is the tunnel's AND the open air over the drawn
    // ground, and the patch, its collider, is exact (pushed back into the tunnel from the opening's lip,
    // a body walking out was held at the opening every step).
    const realRock = probe.field > 0 && !inCut && !space.inFrontOfOpeningAt(body.x, probeY, body.z);
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
