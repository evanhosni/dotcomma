import React, { useMemo } from "react";
import { getAllBiomes } from "../utils/utils";
import { WORLD_REGIONS } from "./world";

/**
 * Mounts every biome's child components (Biome.components), e.g. the grass
 * biome's grass cover. Components are always mounted — each one gates its own
 * placement/visibility by biomeId and camera distance.
 */
export const BiomeComponents = () => {
  const components = useMemo(
    () =>
      getAllBiomes(WORLD_REGIONS).flatMap(
        (biome) =>
          biome.components?.map((Component, i) => <Component key={`biome_${biome.id}_component_${i}`} />) ?? []
      ),
    []
  );

  return <>{components}</>;
};
