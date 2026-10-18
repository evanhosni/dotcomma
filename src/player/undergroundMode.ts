import type { LiquidLook } from "../vfx/underwater";
import type { RapierRigidBody } from "@react-three/rapier";
import { useRef } from "react";
import { airAboveAt, escapeFromRockAt, inFrontOfOpeningAt, liquidLevelAt, manholeColumnAt, probeUnderground } from "../objects/dressing/underground/undergroundRegistry";
import { resetCharacterMotion, type Character } from "../physics/characterMovement";
import { setCameraUnderground } from "../world/shaders/terrainHoles";
import { PLAYER_HEIGHT, PLAYER_RADIUS } from "./spec";
import type { InputState } from "./useInput";

/**
 * THE PLAYER UNDERGROUND (CLAUDE.md "Tunnels"): whether the player is in a cave or sewer, what the
 * terrain heightfields are to the step there (overhead terrain is not ground), the manholes' catch,
 * climb and exit, and the tunnel's liquid as the water. Run before every step.
 */

/** Inside once the point this far over the feet is in tunnel air; outside once the field there has exceeded
 *  EXIT_FIELD for EXIT_FRAMES frames running (one frame's reading never flips the state: the safety nets
 *  lifted a player out of a cave onto the summit on a single false "outside"). */
const PROBE_OVER_FEET = 0.3;
const EXIT_FIELD = 0.5;
const EXIT_FRAMES = 10;
/** The floor backstop: the probe point (PROBE_OVER_FEET up) this deep in rock is a sunk player, not a
 *  foot on a bumpy floor (the nets' triangles sit within ~0.3u of the field's zero); the floor's surface
 *  is looked for this far up, and the feet set this much over it (a coarse air sample set them 0.15u
 *  UNDER a sewer floor, where the liquid's swim sank them again: a bounce). */
const SUNK_FIELD = 0.15;
const SUNK_REACH = 6;
const SUNK_LIFT = 0.05;
/** The wall backstop: the probe point in rock BESIDE the capsule (a wall's collider absent for one
 *  frame: a sprint frame puts the axis 0.16u into the wall, and from inside, the walls hold nothing
 *  in any direction) is pushed out along the field's gradient to this much air past the radius. */
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

export interface UndergroundStep {
  ignoreTerrain: boolean;
  vyOverride: number | null;
  /** Walking is held still (a manhole's catch). */
  holdWalk: boolean;
  /** The liquid level over the capsule, or NaN, and its viscosity relative to water. */
  liquidY: number;
  liquidViscosity: number;
  liquidLook: LiquidLook;
}

interface Position {
  x: number;
  y: number;
  z: number;
}

export const useUndergroundMode = () => {
  const state = useRef({ inside: false, exitFrames: 0, outsideFor: Infinity, holding: false, column: null as string | null }).current;
  const step = useRef<UndergroundStep>({ ignoreTerrain: false, vyOverride: null, holdWalk: false, liquidY: NaN, liquidViscosity: 1, liquidLook: "water" }).current;

  const isInside = (): boolean => state.inside;
  /** Seconds since the player was last inside a tunnel (Infinity: never). */
  const outsideFor = (): number => state.outsideFor;

  const reset = (): void => {
    state.inside = false;
    state.exitFrames = 0;
    state.outsideFor = Infinity;
    state.holding = false;
    state.column = null;
    setCameraUnderground(false);
  };

  /** The step's adjustments for the capsule at body center `pos`; may teleport the body (a manhole's catch, its exit). */
  const update = (rb: RapierRigidBody, pos: Position, input: InputState, character: Character, dt: number): UndergroundStep => {
    const feet = pos.y - PLAYER_HEIGHT / 2;
    const probe = probeUnderground(pos.x, feet + PROBE_OVER_FEET, pos.z);
    if (probe.known) {
      if (!state.inside && probe.field < 0) state.inside = true;
      if (state.inside) {
        state.exitFrames = probe.field > EXIT_FIELD ? state.exitFrames + 1 : 0;
        if (state.exitFrames >= EXIT_FRAMES) state.inside = false;
      }
    }
    state.outsideFor = state.inside ? 0 : state.outsideFor + dt;
    setCameraUnderground(state.inside);
    step.ignoreTerrain = false;
    step.vyOverride = null;
    step.holdWalk = false;
    step.liquidY = state.inside ? probe.liquidY : NaN;
    step.liquidViscosity = probe.liquidViscosity;
    step.liquidLook = probe.liquidLook;

    const column = manholeColumnAt(pos.x, pos.z, feet);
    if (column) {
      const info = column.entrance.manhole!;
      const street = info.streetY;
      const entering = state.column !== column.entrance.id;
      state.column = column.entrance.id;
      if (column.open) {
        step.ignoreTerrain = true;
        if (entering && feet >= street - CATCH_BELOW_STREET && feet <= street + 1) {
          // Stepping onto an open manhole from outside: snapped to its center and held until well under
          // the street (never a player climbing out: the column is theirs already).
          rb.setTranslation({ x: column.entrance.x, y: pos.y, z: column.entrance.z }, true);
          state.holding = true;
        }
        if (state.holding) {
          step.holdWalk = true;
          if (feet < street - HOLD_BELOW_STREET) state.holding = false;
        }
        if (input.jump) {
          if (feet >= street - EXIT_BELOW_STREET) {
            rb.setTranslation({ x: info.exitX, y: info.exitY + EXIT_OVER_STREET + PLAYER_HEIGHT / 2, z: info.exitZ }, true);
            resetCharacterMotion(character.state);
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
        if (input.jump) {
          const head = feet + PLAYER_HEIGHT;
          step.vyOverride = head < street - CLOSED_HEAD_CLEARANCE ? CLIMB_SPEED : 0;
        }
      }
      return step;
    }
    state.holding = false;
    state.column = null;

    if (state.inside) {
      // In the tunnel's AIR the terrain is not ground (overhead, or the ground over an opening, which the
      // drawing cuts): the tunnel's colliders carry the player. Out of it — across a mouth's opening plane —
      // it is; under the opening itself the terrain's collider is cut under the floor (mouthBulge.ts
      // mouthCutColliderHeight), so it meets the sill. Ignored where the heightfield stood more than an
      // autostep over the tunnel floor instead, the rule flipped every frame at a mouth's lip, where the
      // hill face stood 0.3–0.8u over the floor inside the opening: a player who walked in could not walk
      // out (Evan, the cave at (-3604, -17706); MEASURED in the page).
      step.ignoreTerrain = probe.field < 0;
      // The rock in front of a mouth's opening is the field's closure, not rock: open air over the ground.
      // Pushed out of it, a player stepping out of a mouth was put back in every frame.
      const realRock = probe.field > 0 && !inFrontOfOpeningAt(pos.x, feet + PROBE_OVER_FEET, pos.z);
      // The capsule's axis is never in rock beside it: a wall embed (a frame without the wall's collider)
      // is undone at once, before the next frame carries it deeper, where the field has no gradient.
      if (realRock) {
        const out = escapeFromRockAt(pos.x, feet + PROBE_OVER_FEET, pos.z, PLAYER_RADIUS + WALL_ESCAPE_CLEARANCE);
        if (out && !out.vertical) {
          rb.setTranslation({ x: out.x, y: pos.y + (out.y - (feet + PROBE_OVER_FEET)), z: out.z }, true);
          return step;
        }
      }
      // The tunnel's own backstop (the ground nets are off in here): feet sunk SUNK_FIELD into the
      // rock under a floor are set back on the air over it, with the fall stopped — a floor whose
      // collider is missing or tunnelled through can never drop the player into the rock (and from
      // there, ten frames later, "outside" and onto the summit).
      if (realRock && probe.field > SUNK_FIELD) {
        const surface = airAboveAt(pos.x, feet + PROBE_OVER_FEET, pos.z, SUNK_REACH);
        if (!Number.isNaN(surface)) {
          rb.setTranslation({ x: pos.x, y: surface + SUNK_LIFT + PLAYER_HEIGHT / 2, z: pos.z }, true);
          step.vyOverride = 0;
        }
      }
    }
    return step;
  };

  /** The tunnel's liquid level at a point, or NaN. */
  const liquidAt = (x: number, z: number): number => liquidLevelAt(x, z);

  return { update, isInside, outsideFor, liquidAt, reset };
};
