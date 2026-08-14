import React, { useLayoutEffect, useMemo } from "react";
import { RegionContext, useDomainStore } from "./context";

export interface RegionProps extends React.PropsWithChildren {
  name: string;
  /** Unique region id — voronoi region assignment depends on it. */
  id: number;
}

/**
 * Declares a region of the world. Children are <Biome> components plus
 * optional region-scoped config (<Material>, <Terrain>, <Skybox>).
 * Region JSX order is preserved — voronoi assignment depends on it.
 */
export const Region = ({ name, id, children }: RegionProps) => {
  const store = useDomainStore("Region");

  useLayoutEffect(() => {
    store.regions.set(id, { id, name });
    store.invalidate();
    return () => {
      store.regions.delete(id);
      store.invalidate();
    };
  }, [store, id, name]);

  const ctx = useMemo(() => ({ regionId: id }), [id]);

  return <RegionContext.Provider value={ctx}>{children}</RegionContext.Provider>;
};
