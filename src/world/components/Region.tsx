import { useMemo, type ReactNode } from "react";
import { declare } from "../content";
import type { RegionIdentity } from "../content/config";
import { RegionContext } from "./context";

export interface RegionProps extends RegionIdentity {
  children?: ReactNode;
}

/**
 * A REGION: a group of biomes on ONE base terrain (its <Noise>) under one base <Material> and
 * <Skybox>, with its own river density (<Rivers chance>). Its <Biome> children are in VORONOI
 * order — the biome roll is `floor(u × count)` over them — as the regions themselves are inside
 * <Domain>. Regions have no boundary of their own: they cross-fade into their neighbors.
 */
export const Region = declare<RegionProps>({
  kind: "region",
  within: "domain",
  View: ({ id, name, children }) => {
    const value = useMemo(() => ({ regionId: id, name }), [id, name]);
    return <RegionContext.Provider value={value}>{children}</RegionContext.Provider>;
  },
});
