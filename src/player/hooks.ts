import type { RapierRigidBody } from "@react-three/rapier";
import type { MutableRefObject } from "react";
import { useRef, useEffect } from "react";
import { resetCharacterMotion } from "../physics";
import type { Character, CharacterMotionState, CharacterStepResult } from "../physics/types";
import { getVertexData, getVertexSample } from "../world/terrain/utils";
import { PLAYER_HEIGHT, PLAYER_RADIUS } from "./spec";
import type { GroundSafetyNets, InputState, WaterProbe } from "./types";
import { SAMPLE_GIVE_UP_MS } from "./constants";
import { playerTunnels } from "../world/underground/registry";
import { createTunnelState, createTunnelStep, resetTunnelState, stepTunnelRules } from "../physics/tunnel-rules";
import type { TunnelBody, TunnelStep } from "../physics/tunnel-rules/types";
import type { PointXZ } from "../utils/math/types";
import { setCameraUnderground } from "../world/shaders/terrain-holes/store";
import { writeWaterColors } from "../generation/water/material";
import { getActiveDomainConfig, isDomainCommitted } from "../world/domains/store";
import { getCurrentDomain, onDomainChange } from "../world/domains/navigation";
import { getConnectionState, subscribeConnectionState } from "../net";

// The player's safety nets against the ANALYTIC terrain height (the source the heightfields are built
// from): the physics ground is per-chunk heightfields swapped during LOD changes, so sweep hardening alone
// can never close every timing hole (CLAUDE.md "Player movement"). Both nets are SUSPENDED while the
// player is in a tunnel (under the ground on purpose), including a check that resolves after entering.

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

/** Surface height at (x, z) if the capsule bottom is more than `tolerance` below it, else null (also
 *  until the worker is up). The PADDED height (flatten pads EXCAVATE up to ~8u: the raw one would teleport
 *  a player standing in a building's excavation), sampled on the dressing worker: on the main thread a
 *  flatten-tile miss is 30–70ms, and the raw pre-filter that ran there built each new cell's river list
 *  and road network (~70ms frames while moving fast). */
const resolveEmbeddedSurface = async (x: number, z: number, bottom: number, tolerance: number): Promise<number | null> => {
  const padded = await getVertexSample(x, z);
  if (!padded || bottom >= padded.height - tolerance) return null;
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

/** `suspended` is read when a net would act (and again when an async check resolves): true while the
 *  player is in a tunnel. */
export const useGroundSafetyNets = (bodyRef: MutableRefObject<RapierRigidBody | null>, terrainLoaded: boolean, suspended: () => boolean): GroundSafetyNets => {
  const respawning = useRef(false);
  const groundCheckFrame = useRef(0);
  const stuckFrames = useRef(0);
  /** When the stuck check in flight started (-Infinity: none); see backstopSince. */
  const unstickingSince = useRef(-Infinity);
  /** When the backstop check in flight started (-Infinity: none). One at a time — they queue on the dressing
   *  worker behind its chunks — but a request lost to a worker reset (a domain switch) never resolves, so
   *  one older than SAMPLE_GIVE_UP_MS no longer blocks the next. */
  const backstopSince = useRef(-Infinity);

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
    if (stuckFrames.current < STUCK_FRAMES_TRIGGER || performance.now() - unstickingSince.current < SAMPLE_GIVE_UP_MS || !terrainLoaded || respawning.current || suspended()) return;
    unstickingSince.current = performance.now();
    const sx = r.x;
    const sz = r.z;
    resolveEmbeddedSurface(sx, sz, r.y - PLAYER_HEIGHT / 2, STUCK_EMBED_MIN).then((surface) => {
      unstickingSince.current = -Infinity;
      const body = bodyRef.current;
      if (!body || suspended()) return;
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
    if (respawning.current || suspended()) return;
    groundCheckFrame.current++;
    if (groundCheckFrame.current % GROUND_CHECK_INTERVAL !== 0) return;
    const now = performance.now();
    if (now - backstopSince.current < SAMPLE_GIVE_UP_MS) return;
    backstopSince.current = now;
    const cx = at.x;
    const cz = at.z;
    resolveEmbeddedSurface(cx, cz, at.y - PLAYER_HEIGHT / 2, BACKSTOP_EMBED_TOLERANCE).then((surface) => {
      backstopSince.current = -Infinity;
      if (surface === null || suspended()) return;
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

/** `KeyboardEvent.code` → the action it holds. */
const KEY_BINDINGS: Readonly<Record<string, keyof InputState>> = {
  KeyW: "forward",
  KeyS: "backward",
  KeyA: "left",
  KeyD: "right",
  ShiftLeft: "sprint",
  Space: "jump",
  KeyC: "descend",
};

/** A ref of the actions currently held, updated from document key events (never re-renders). */
export const useInput = (): React.MutableRefObject<InputState> => {
  const inputRef = useRef<InputState>({
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false,
    jump: false,
    descend: false,
  });

  useEffect(() => {
    const setHeld = (code: string, held: boolean) => {
      const action = KEY_BINDINGS[code];
      if (action) inputRef.current[action] = held;
    };
    const handleKeyDown = (e: KeyboardEvent) => setHeld(e.code, true);
    const handleKeyUp = (e: KeyboardEvent) => setHeld(e.code, false);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  return inputRef;
};

const isTextEntry = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");

/** Ctrl/Cmd+R (Shift too) and a bare F5. Ctrl+F5 / Shift+F5 stay the deliberate hard reload. */
const isReloadShortcut = (e: KeyboardEvent): boolean =>
  (e.code === "KeyR" && (e.ctrlKey || e.metaKey)) || (e.code === "F5" && !e.ctrlKey && !e.metaKey && !e.shiftKey);

const promptBeforeUnload = (e: BeforeUnloadEvent): void => {
  e.preventDefault();
  e.returnValue = ""; // Firefox and older Chrome only prompt with returnValue set
};

/**
 * A reload drops the socket mid-game. While playing (pointer locked, outside any text field) the reload
 * keys are swallowed in the capture phase; while in an overworld session, any other reload path (the
 * toolbar, a browser that ignores the keydown block) gets the "Leave site?" prompt.
 */
export const useReloadGuard = (): void => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!document.pointerLockElement || isTextEntry(e.target) || !isReloadShortcut(e)) return;
      e.preventDefault();
      // TODO(game): a game-specific Ctrl+R action goes here.
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, []);

  useEffect(() => {
    let prompting = false;
    const sync = () => {
      const { status } = getConnectionState();
      const inSession = getCurrentDomain() === "overworld" && (status === "connected" || status === "reconnecting");
      if (inSession === prompting) return;
      prompting = inSession;
      if (inSession) window.addEventListener("beforeunload", promptBeforeUnload);
      else window.removeEventListener("beforeunload", promptBeforeUnload);
    };
    sync();
    const offConnection = subscribeConnectionState(sync);
    const offDomain = onDomainChange(sync);
    return () => {
      offConnection();
      offDomain();
      window.removeEventListener("beforeunload", promptBeforeUnload);
    };
  }, []);
};

/** Third person on or off; the middle mouse button toggles it (its default, the browser's autoscroll, is
 *  suppressed). */
export const useThirdPersonToggle = (): React.MutableRefObject<boolean> => {
  const thirdPerson = useRef(false);
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      thirdPerson.current = !thirdPerson.current;
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);
  return thirdPerson;
};

/**
 * THE PLAYER UNDERGROUND: the shared tunnel rules (physics/tunnel-rules/index.ts — the same ones every server NPC
 * runs) on the player's TunnelSpace (the registry's loaded chunks), applied to the player's body, and the
 * camera told when it is in a tunnel. Run before every step.
 */

interface Position {
  x: number;
  y: number;
  z: number;
}

export const useUndergroundMode = () => {
  const state = useRef(createTunnelState()).current;
  const step = useRef(createTunnelStep()).current;
  const body = useRef<TunnelBody>({ x: 0, y: 0, z: 0, height: PLAYER_HEIGHT, radius: PLAYER_RADIUS, jump: false, moveX: 0, moveZ: 0 }).current;

  const isInside = (): boolean => state.inside;
  /** Seconds since the player was last inside a tunnel (Infinity: never). */
  const outsideFor = (): number => state.outsideFor;

  const reset = (): void => {
    resetTunnelState(state);
    setCameraUnderground(false);
  };

  /** The step's adjustments for the capsule at body center `pos`; may teleport the body (a manhole's catch, its exit). */
  const update = (rb: RapierRigidBody, pos: Position, input: InputState, move: PointXZ, character: Character, dt: number): TunnelStep => {
    body.x = pos.x;
    body.y = pos.y;
    body.z = pos.z;
    body.jump = input.jump;
    body.moveX = move.x;
    body.moveZ = move.z;
    stepTunnelRules(playerTunnels, state, step, body, dt);
    if (!Number.isNaN(step.teleportX)) rb.setTranslation({ x: step.teleportX, y: step.teleportY, z: step.teleportZ }, true);
    if (step.resetMotion) resetCharacterMotion(character.state);
    setCameraUnderground(state.inside);
    return step;
  };

  return { update, isInside, outsideFor, reset };
};

/** Frames between water samples (the swim's surface and the underwater VFX). */
const PROBE_INTERVAL_FRAMES = 4;
/** A point this far under the sampled bed is under the ground (the bed is the raw lattice, not the drawn one). */
const UNDER_BED_MARGIN = 0.5;

/** The water surface around the player, from the same height pipeline that draws it, sampled on the
 *  dressing worker (on the main thread a cell's first sample built its river list: 58ms frames while
 *  flying). Raw (pad-free) is exact here: pads never stand in water, and the raw path keeps the water
 *  under bridge decks. No sample until the worker is up. */
export const useWaterProbe = (): WaterProbe => {
  // `since`: when the sample in flight started (-Infinity: none); one lost to a worker reset never resolves.
  const state = useRef({ surfaceY: NaN, bedY: NaN, frame: 0, since: -Infinity, generation: 0, colors: { shallow: new Float32Array(3), deep: new Float32Array(4) } }).current;
  return useRef<WaterProbe>({
    sample(x, z) {
      if (state.frame++ % PROBE_INTERVAL_FRAMES !== 0) return;
      const now = performance.now();
      if (now - state.since < SAMPLE_GIVE_UP_MS) return;
      state.since = now;
      const generation = state.generation;
      getVertexSample(x, z, { raw: true })
        .then((vd) => {
          if (!vd || generation !== state.generation) return;
          state.surfaceY = vd.waterHeight > vd.height ? vd.waterHeight : NaN;
          state.bedY = vd.height;
          if (isDomainCommitted()) writeWaterColors(vd.waterBody, vd.waterBodyShare, vd.waterBody2, state.colors.shallow, state.colors.deep, 0, getActiveDomainConfig());
        })
        .finally(() => {
          state.since = -Infinity;
        });
    },
    surfaceOver: (y) => (y < state.bedY - UNDER_BED_MARGIN ? NaN : state.surfaceY),
    colors: () => state.colors,
    clear() {
      state.generation++;
      state.surfaceY = NaN;
      state.bedY = NaN;
    },
  }).current;
};
