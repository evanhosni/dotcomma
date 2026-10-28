import { reportContentError } from "../../utils/contentError";
import { childrenOfKind } from "../../world/content";
import { actorPlacementsOf } from "../../world/content/config";
import type { ContentNode } from "../../world/content/types";
import { specNeedsServer, type ActorSpec } from "./spec";

/**
 * The actor kinds the SERVER simulates (a state machine, a moving body, a sealed hull), by id,
 * DERIVED from the <Actor> components mounted in the worlds' biomes: mounting a kind is what
 * catalogs it, so there is no list to keep in step. Three-free, React-free.
 */
export const actorCatalogOf = (domains: Iterable<ContentNode<any>>): Readonly<Record<string, ActorSpec>> => {
  const specById = new Map<string, ActorSpec>();
  const catalog: Record<string, ActorSpec> = {};
  for (const domain of domains) {
    for (const region of childrenOfKind(domain, "region")) {
      for (const biome of childrenOfKind(region, "biome")) {
        for (const { id, mount } of actorPlacementsOf(biome)) {
          const { actor } = mount;
          const listed = specById.get(actor.id);
          if (listed && listed !== actor) {
            reportContentError(
              `[actors] two different specs share the id "${actor.id}" — an id is one kind (a variant spreading ` +
                `another spec must set its own \`id\`).`,
            );
          }
          specById.set(actor.id, actor);
          // Under its placement id AND its own: a feature-placed kind is still that kind on the wire.
          if (specNeedsServer(actor)) catalog[id] = catalog[actor.id] = actor;
        }
      }
    }
  }
  return Object.freeze(catalog);
};
