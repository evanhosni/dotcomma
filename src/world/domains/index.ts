import { actorCatalogOf } from "../../objects/actors/catalog";
import type { ActorSpec } from "../../objects/actors/spec";
import { domainConfigOf, domainNodeOf } from "../content/config";
import type { ContentNode } from "../content/types";
import type { DomainConfig } from "../../utils/workers/types";
import { NotFoundDomain } from "./404";
import { HomeDomain } from "./home";
import { OverworldDomain } from "./overworld";
import type { DomainId } from "./types";

/**
 * EVERY WORLD, as the one tree each of them is. index.tsx renders the one the URL names, and the
 * same elements are read as data here for the server and the catalogs — there is no second
 * description of a domain anywhere (world/content/).
 */
export const DOMAIN_TREES: Record<DomainId, JSX.Element> = {
  home: HomeDomain,
  overworld: OverworldDomain,
  "404": NotFoundDomain,
};

/** Each tree read as data, once. */
export const DOMAIN_NODES: Record<DomainId, ContentNode<any>> = Object.fromEntries(
  Object.entries(DOMAIN_TREES).map(([id, tree]) => [id, domainNodeOf(tree)]),
) as Record<DomainId, ContentNode<any>>;

/** What the SERVER simulates on (physicsWorld.ts) — the same config the client commits. */
export const DOMAIN_CONFIGS: Record<DomainId, DomainConfig> = Object.fromEntries(
  Object.entries(DOMAIN_NODES).map(([id, node]) => [id, domainConfigOf(node)]),
) as Record<DomainId, DomainConfig>;

/** THE actor catalog: every kind any world mounts that the server simulates. */
export const ACTOR_CATALOG = actorCatalogOf(Object.values(DOMAIN_NODES));

export const getActorSpec = (id: string): ActorSpec | undefined => ACTOR_CATALOG[id];
