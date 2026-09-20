import React, { useLayoutEffect, useMemo } from "react";
import { RegionContext, useDomainStore } from "./context";

export interface RegionProps extends React.PropsWithChildren {
  name: string;
  id: number;
}

/** Region JSX order is preserved — voronoi assignment depends on it. */
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
