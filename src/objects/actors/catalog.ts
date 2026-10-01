import { reportContentError } from "../../utils/contentError";
import type { RegionSpec } from "../../world/types";
import { specNeedsServer, type ActorSpec } from "./spec";

/**
 * The actor kinds the SERVER simulates (a state machine, a moving body, a sealed hull), by id,
 * DERIVED from the biome specs' `actors` lists: placing a kind in a biome is what catalogs it, so
 * there is no list to keep in step. THE catalog is built from every domain's region list in
 * world/domains/configs.ts (`ACTOR_CATALOG`), which the server's entity manager reads.
 * Three-free, React-free.
 */
export const actorCatalogOf = (regionLists: Iterable<readonly RegionSpec[]>): Readonly<Record<string, ActorSpec>> => {
  const specById = new Map<string, ActorSpec>();
  const catalog: Record<string, ActorSpec> = {};
  for (const regions of regionLists) {
    for (const region of regions) {
      for (const biome of region.biomes) {
        for (const { actor } of biome.actors ?? []) {
          const listed = specById.get(actor.id);
          if (listed && listed !== actor) {
            reportContentError(
              `[actors] two different specs share the id "${actor.id}" — an id is one kind (a variant spreading ` +
                `another spec must set its own \`id\`).`,
            );
          }
          specById.set(actor.id, actor);
          if (specNeedsServer(actor)) catalog[actor.id] = actor;
        }
      }
    }
  }
  return Object.freeze(catalog);
};
