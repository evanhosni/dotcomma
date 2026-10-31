import { useMemo, type ReactNode } from "react";
import { declare } from "../content";
import type { BiomeIdentity } from "../content/config";
import { BiomeContext } from "./context";

export interface BiomeProps extends BiomeIdentity {
  children?: ReactNode;
}

/**
 * A BIOME: one voronoi zone's identity, and — as its children — everything that is true of it.
 * Its relief is a <Noise>, its look a <Material>, its water a <Water>, and every feature standing
 * on or under it is a component mounted here (<Snow/>, <Rocks/>, <Sewers>, <StreetLamps/>,
 * <Actor/>). There is no second list anywhere: this tree IS what the workers and the server read
 * (world/content/).
 */
export const Biome = declare<BiomeProps>({
  kind: "biome",
  within: "region",
  View: ({ id, name, children }) => {
    const value = useMemo(() => ({ biomeId: id, name }), [id, name]);
    return <BiomeContext.Provider value={value}>{children}</BiomeContext.Provider>;
  },
});
