import { Region } from "../../../world/types";
import { mergeActorListings } from "../spec";
import { AnyActorDescriptor } from "./types";

/** One descriptor per kind: spawning in every biome that lists it, otherwise last-registered wins. */
export const collectDescriptors = (regions: Region[]): AnyActorDescriptor[] =>
  mergeActorListings(regions.flatMap((region) => region.biomes.flatMap((biome) => biome.actors ?? [])));
