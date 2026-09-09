import type { StateMachineConfig } from "../../../../src/objects/actors/state/types";
import { BEEBLE_SM } from "../../../../src/objects/actors/beeble/stateMachine";

/**
 * ENTITY KINDS — what the server simulates for each actor DESCRIPTOR id.
 *
 * The state machine configs are the CLIENT'S files, imported straight from
 * src/ (the server is bundled with esbuild, which follows those imports). A
 * behavior is written ONCE, in the actor's folder, and runs here as the one
 * authority; the client only mirrors its state for visuals. See
 * src/objects/actors/state/runner.ts for the contract a config must follow
 * (blackboard outputs, no Three at runtime, scene work guarded on groupRef).
 *
 * Adding a synced NPC: give its descriptor id an entry here with its config.
 * Kinds with no entry are static (their position never changes) but still
 * have replicated `state` and interactions (buildings' doors).
 */
export interface EntityKind {
  sm?: StateMachineConfig;
}

export const KINDS: Readonly<Record<string, EntityKind>> = {
  beeble: { sm: BEEBLE_SM },
};

export const getKind = (id: string): EntityKind | undefined => KINDS[id];
