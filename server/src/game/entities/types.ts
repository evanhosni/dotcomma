import type { AnimationState } from "../../../../src/animation/types";
import type { DomainId, PlayerForm, ServerMessage } from "../../../../src/net/protocol/types";
import type { ProxyColliderHandle } from "../../../../src/objects/actors/building/collider/types";
import type { ActorSpec } from "../../../../src/objects/actors/spec";
import { StateMachineRunner } from "../../../../src/objects/actors/state/StateMachineRunner";
import type { NpcBody } from "../physics/bodies/types.js";

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

export interface PlayerView {
  id: string;
  domain: DomainId;
  /** Its form (src/player/spec.ts): what NPCs notice of it, and whether it has a capsule. */
  form: PlayerForm;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  lastMoveAt: number;
}

export interface EntityHost {
  playersIn(domain: DomainId): Iterable<PlayerView>;
  sendMany(sessionIds: Iterable<string>, msg: ServerMessage): void;
  /** An id that must never be simulated again in the domain (an NPC that became a player). */
  isRetired?(domain: DomainId, id: string): boolean;
}

export interface EntityRecord extends Published {
  id: string;
  kind: string;
  domain: DomainId;
  registrants: Set<string>;
  runner: StateMachineRunner | null;
  /** The position object the runner reads (kept equal to x/y/z). */
  position: { x: number; y: number; z: number };
  npc: NpcBody | null;
  hull: ProxyColliderHandle | null;
}

export interface EntityManagerOptions {
  /** Per-tick generation budget for the physics world (tests: Infinity). */
  workBudgetMs?: number;
  log?: boolean;
  /** Kind → spec (default: the actor catalog; tests inject kinds). */
  specs?: (kind: string) => ActorSpec | undefined;
}
