import type * as THREE from "three";
import type { MavSeat } from "../../../../objects/actors/mav-unit/types";
import type { PointXZ } from "../../../../utils/math/types";

/** A beeble the MAV Unit takes: its spawn id (the NPC entity's id) and where it spawns. */
export interface Host {
  id: string;
  x: number;
  z: number;
  groundY: number;
}

/** A host's seat and eyes, read once per model. */
export interface HostView {
  seat: MavSeat;
  /** The eyes (PLAYER_EYE_HEIGHT over the feet at the bind pose), in the head bone's space. */
  eye: THREE.Vector3;
}

/** title: hovering over the sky's text, waiting for the click. scanning: the address bar flicking, a host
 *  being searched and claimed. found: "host found", the unit moved over it. falling: through the text, the
 *  black fading, the scan coming on. installing: screwing into the host's skull. waking: the screen black,
 *  then the host's eyes opening. standing: the host getting up. done: the player is the host. */
export type IntroPhase = "title" | "scanning" | "found" | "falling" | "installing" | "waking" | "standing" | "done";

/** One run of the intro (Intro.tsx): everything its phases share. */
export interface IntroRun {
  phase: IntroPhase;
  /** Taken at the start of the next frame (a phase never changes mid-frame). */
  nextPhase: IntroPhase | null;
  /** Clock seconds the phase began. */
  phaseAt: number;
  /** The start is placed and the click gate open: the body is published from now on. */
  ready: boolean;
  start: PointXZ;
  /** The address the player opened (its path), searched on its own first; null for the bare site. */
  address: string | null;
  /** The address had no free host: the scan widened, flicking through the places around it. */
  expanding: boolean;
  /** When the address bar last flicked (clock seconds). */
  lastFlickerAt: number;
  /** When the prompt last changed (performance.now, ms): each message stays PROMPT_MIN_SECONDS. */
  promptAt: number;

  /** The unit's origin. */
  mav: THREE.Vector3;
  /** The ground it lands on with no host. */
  landY: number;
  spin: number;
  spinAtImpact: number;
  /** How far the screw is in (0–1). */
  screwDepth: number;

  host: Host | null;
  /** The search is over: a host was claimed, or none was found in time. */
  searchDone: boolean;
  view: HostView | null;
  /** Hosts that failed the sky test (never offered again), the one that passed it, when the current one
   *  first stood mounted here, and whether another is being found after a failure. */
  refused: Set<string>;
  skyClear: string | null;
  liveSince: number;
  rehosting: boolean;
  /** When the unit began holding over its current host (NaN while not held). */
  heldSince: number;

  /** What the unit is locked over (host id + whether it stands mounted here), and the glide onto it after a
   *  change: from where, since when, for how long. */
  track: { key: string; from: PointXZ; at: number; seconds: number };
  /** The view lying down, taken as the eyes first open: where standing up starts from. */
  lying: { taken: boolean; at: THREE.Vector3; look: THREE.Quaternion };
  /** When the host began getting up (its ragdoll recovering here). */
  recoverAt: number;
}
