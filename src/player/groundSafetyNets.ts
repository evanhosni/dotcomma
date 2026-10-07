import type { RapierRigidBody } from "@react-three/rapier";
import { type MutableRefObject, useRef } from "react";
import { resetCharacterMotion, type Character, type CharacterMotionState, type CharacterStepResult } from "../physics/characterMovement";
import { getVertexData, getVertexDataRaw, getVertexSample } from "../world/terrain/vertexData";
import { PLAYER_HEIGHT } from "./spec";

// The player's safety nets against the ANALYTIC terrain height (the source the heightfields are built
// from): the physics ground is per-chunk heightfields swapped during LOD changes, so sweep hardening alone
// can never close every timing hole (CLAUDE.md "Player movement").

const FALL_RESET_Y = -500;
/** Above the ground after a fall reset. */
const FALL_RESET_DROP_HEIGHT = 10;

const GROUND_CHECK_INTERVAL = 3; // frames
// Generous: coarse-LOD heightfield colliders legitimately sit a little below the analytic surface.
const BACKSTOP_EMBED_TOLERANCE = 2;

const STUCK_FRAMES_TRIGGER = 12; // ~0.2s of blocked input
const STUCK_EMBED_MIN = 0.1;
const STUCK_RECHECK_BACKOFF = 45; // frames
/** "No movement": under 5% of the desired step (0.05²). */
const STUCK_MOVE_FRACTION_SQ = 0.0025;

/** An async height check whose body has since moved this far (either axis) is stale and ignored. */
const STALE_CHECK_DISTANCE = 3;
/** Clearance above the surface when a safety net lifts the capsule onto it. */
const LIFT_CLEARANCE = 0.1;

/** Surface height at (x, z) if the capsule bottom is more than `tolerance`
 *  below it, else null. The raw height is only a PRE-FILTER: flatten pads
 *  EXCAVATE (up to ~8u), so trusting it alone would teleport a player standing
 *  in a building's excavation. The padded confirm runs in the dressing worker —
 *  a flatten-tile miss is 30–70ms. */
const resolveEmbeddedSurface = async (x: number, z: number, bottom: number, tolerance: number): Promise<number | null> => {
  const raw = await getVertexDataRaw(x, z);
  if (bottom >= raw.height - tolerance) return null;
  const padded = (await getVertexSample(x, z)) ?? (await getVertexData(x, z));
  if (bottom >= padded.height - tolerance) return null;
  return padded.height;
};

/** The check that started at (x, z) no longer applies: the body has moved on. */
const isStale = (cur: { x: number; z: number }, x: number, z: number): boolean =>
  Math.abs(cur.x - x) > STALE_CHECK_DISTANCE || Math.abs(cur.z - z) > STALE_CHECK_DISTANCE;

/** Puts the capsule bottom just above `surface` and clears its fall/slide. */
const liftOnto = (body: RapierRigidBody, cur: { x: number; z: number }, surface: number, motion: CharacterMotionState): void => {
  body.setTranslation({ x: cur.x, y: surface + PLAYER_HEIGHT / 2 + LIFT_CLEARANCE, z: cur.z }, true);
  resetCharacterMotion(motion);
};

export interface GroundSafetyNets {
  /** Stuck escape: a capsule slightly embedded (under the backstop tolerance, e.g. after a LOD swap)
   *  makes every sweep return ~zero. Signal = sustained input with ~no movement; confirmed against the
   *  analytic height so a wall push never triggers it. Call after every walking step. */
  escapeIfStuck(step: CharacterStepResult, from: { x: number; z: number }, character: Character): void;
  /** Authoritative anti-tunneling backstop, every GROUND_CHECK_INTERVAL frames (skipped mid fall reset). */
  runBackstop(at: { x: number; y: number; z: number }, character: Character): void;
  /** Fell out of the world: drop back in above the ground here. */
  respawnIfFallen(at: { x: number; y: number; z: number }, character: Character): void;
}

export const useGroundSafetyNets = (bodyRef: MutableRefObject<RapierRigidBody | null>, terrainLoaded: boolean): GroundSafetyNets => {
  const respawning = useRef(false);
  const groundCheckFrame = useRef(0);
  const stuckFrames = useRef(0);
  const unsticking = useRef(false);

  const escapeIfStuck = (r: CharacterStepResult, from: { x: number; z: number }, character: Character): void => {
    const wantSq = r.desiredX * r.desiredX + r.desiredZ * r.desiredZ;
    const gotX = r.x - from.x;
    const gotZ = r.z - from.z;
    const gotSq = gotX * gotX + gotZ * gotZ;
    if (wantSq > 1e-6 && gotSq < wantSq * STUCK_MOVE_FRACTION_SQ) {
      stuckFrames.current++;
    } else {
      stuckFrames.current = 0;
    }
    if (stuckFrames.current < STUCK_FRAMES_TRIGGER || unsticking.current || !terrainLoaded || respawning.current) return;
    unsticking.current = true;
    const sx = r.x;
    const sz = r.z;
    resolveEmbeddedSurface(sx, sz, r.y - PLAYER_HEIGHT / 2, STUCK_EMBED_MIN).then((surface) => {
      unsticking.current = false;
      const body = bodyRef.current;
      if (!body) return;
      const cur = body.translation();
      if (isStale(cur, sx, sz)) return;
      if (surface !== null && cur.y - PLAYER_HEIGHT / 2 < surface - STUCK_EMBED_MIN) {
        liftOnto(body, cur, surface, character.state);
        stuckFrames.current = 0;
      } else {
        stuckFrames.current = -STUCK_RECHECK_BACKOFF;
      }
    });
  };

  const runBackstop = (at: { x: number; y: number; z: number }, character: Character): void => {
    if (respawning.current) return;
    groundCheckFrame.current++;
    if (groundCheckFrame.current % GROUND_CHECK_INTERVAL !== 0) return;
    const cx = at.x;
    const cz = at.z;
    resolveEmbeddedSurface(cx, cz, at.y - PLAYER_HEIGHT / 2, BACKSTOP_EMBED_TOLERANCE).then((surface) => {
      if (surface === null) return;
      const body = bodyRef.current;
      if (!body) return;
      const cur = body.translation();
      if (isStale(cur, cx, cz)) return;
      if (cur.y - PLAYER_HEIGHT / 2 >= surface - BACKSTOP_EMBED_TOLERANCE) return;
      liftOnto(body, cur, surface, character.state);
    });
  };

  const respawnIfFallen = (at: { x: number; y: number; z: number }, character: Character): void => {
    if (!(at.y < FALL_RESET_Y) || respawning.current) return;
    respawning.current = true;
    character.state.vy = 0;
    getVertexData(at.x, at.z).then((vd) => {
      if (bodyRef.current) {
        bodyRef.current.setTranslation({ x: at.x, y: vd.height + FALL_RESET_DROP_HEIGHT, z: at.z }, true);
      }
      character.state.vy = 0;
      respawning.current = false;
    });
  };

  return { escapeIfStuck, runBackstop, respawnIfFallen };
};
