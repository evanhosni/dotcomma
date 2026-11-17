import { useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { reportContentError } from "../../../utils/utils";
import { WATER, WATER_BODY_KINDS, WATER_DEFAULTS } from "../../../generation/water/params";
import { readWaterColors } from "../../../generation/water/material";
import type { WaterColorProps, WaterParams } from "../../../generation/water/types";
import { declare } from "../../content";
import type { ContentComponent } from "../../content/types";
import { BiomeContext, RegionContext, WaterBodyContext } from "../context";
import type { WaterBodyDeclaration } from "./types";
import { bodyDeclarations, waterBodyParamsOf } from "./registry";

export interface WaterProps extends WaterColorProps {
  fallGrade?: number;
  /** Every body kind's props for the whole domain, by kind: `{ rivers: { maxCarve: 60 }, lake: {
   *  levelBelow: 2 }, pond: { wallGrade: 0.5 } }` — under each mount's own, over the kind's defaults. */
  defaults?: WaterParams["defaults"];
  children?: ReactNode;
}

/** THE BASE of all water in a domain: what every body of it (a <Lake>, a <Rivers>, a <Pond>) shares — one
 *  mesh, one material, one bed shade, one depth rule, what a FALL is (`fallGrade`), the colours of any body
 *  naming none (`shallowColor`, `deepColor`, `deepDepth`) and every body kind's domain-wide defaults
 *  (`defaults`; world/water/README.md "The props"). Its children are what follows every water whatever body
 *  it is (<WaterfallSplashes/>, <WaterfallBoulders/>). No <Water> = no water anywhere. */
export const Water = declare<WaterProps>({
  kind: WATER,
  within: "domain",
  read: (node): WaterParams => {
    const { fallGrade, defaults } = node.props;
    for (const kind of Object.keys(defaults ?? {})) {
      if (!(WATER_BODY_KINDS as readonly string[]).includes(kind)) reportContentError(`<Water defaults>: "${kind}" is no body of water (${WATER_BODY_KINDS.join(", ")})`);
    }
    return { ...WATER_DEFAULTS, ...(fallGrade === undefined ? {} : { fallGrade }), ...readWaterColors(node.props), ...(defaults ? { defaults } : {}) };
  },
  View: ({ children }) => <>{children}</>,
});

/**
 * Declares a BODY of water on the one body base: every body takes the same children — <Actor>s, dressing,
 * foliage, particles — as its PARTS, placed in the water it owns by one ZONE rule (generation/water/params.ts
 * `waterZoneOf`). Its view hands the parts the body they stand in; the config folds them with
 * `waterBodyOf`. A body knows no other.
 */
export const declareWaterBody = <P extends object>(body: WaterBodyDeclaration<P>): ContentComponent<P & { children?: ReactNode }> => {
  const idOf = (props: P): string => body.id?.(props) ?? body.kind;
  bodyDeclarations.set(body.kind, body);
  return declare<P & { children?: ReactNode }>({
    kind: body.kind,
    within: body.within,
    read: (node) => waterBodyParamsOf(node, null),
    placesAs: (node) => idOf(node.props),
    View: (props) => {
      const biome = useContext(BiomeContext);
      const region = useContext(RegionContext);
      const id = idOf(props);
      const ref = useMemo(() => ({ id, ...(biome ? { biomeId: biome.biomeId } : { regionId: region?.regionId }) }), [id, biome, region]);
      return <WaterBodyContext.Provider value={ref}>{props.children}</WaterBodyContext.Provider>;
    },
  });
};
