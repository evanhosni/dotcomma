import type { ActorMount } from "../../objects/actors/spec";
import { declare } from "../content";

export interface ActorProps extends ActorMount {}

/**
 * An ACTOR spawned where it is mounted: in a biome it is placed by the density field (its spec's
 * `density`/`footprint` and the biome's overrides); inside a feature (<Sewers><Rooms><Actor/>>)
 * that feature places it, one per part, and it lists separately under its own id.
 *
 * Mounting it is also what puts the kind in the SERVER's catalog (objects/actors/registry.ts), so
 * nothing about an actor is written twice. Renders nothing — ActorPool instantiates it.
 */
export const Actor = declare<ActorProps>({ kind: "actor" });
