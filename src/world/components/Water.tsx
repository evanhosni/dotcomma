import { useContext, useMemo, type ReactNode } from "react";
import { reportContentError } from "../../utils/contentError";
import { WATER, WATER_BODY_KINDS, WATER_DEFAULTS } from "../../utils/workers/water/params";
import { readWaterColors } from "../../utils/workers/water/material";
import type { WaterBase, WaterBody, WaterColorProps, WaterParams } from "../../utils/workers/water/types";
import { declare } from "../content";
import type { ContentComponent, ContentDeclaration, ContentNode } from "../content/types";
import { BiomeContext, RegionContext, WaterBodyContext } from "./context";

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
    for (const [kind, params] of Object.entries(defaults ?? {})) {
      if (!(WATER_BODY_KINDS as readonly string[]).includes(kind)) reportContentError(`<Water defaults>: "${kind}" is no body of water (${WATER_BODY_KINDS.join(", ")})`);
    }
    return { ...WATER_DEFAULTS, ...(fallGrade === undefined ? {} : { fallGrade }), ...readWaterColors(node.props), ...(defaults ? { defaults } : {}) };
  },
  View: ({ children }) => <>{children}</>,
});

/** A mount's props that are set (a prop written `undefined` names nothing). */
export const definedProps = <T extends object>(props: T): Partial<T> => Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined)) as Partial<T>;


/** A BODY of water's declaration: its kind, where it may stand, the params a mount NAMES (`read`), its
 *  kind's `defaults` and its id (its path segment; default its kind — a body mounted several times in one
 *  biome, a <Pond>, names its mounts apart by it). With `defaults` a mount's params are resolved whole when
 *  the config is assembled: the kind's defaults, under the <Water> base's for the kind, under the mount's own
 *  (waterBodyParamsOf). Without, they are only what it names, and the kind resolves them at run time (a
 *  <Rivers> prop by prop over its region's: rivers/params.ts riversIn). */
interface WaterBodyDeclaration<P> {
  kind: (typeof WATER_BODY_KINDS)[number];
  within: ContentDeclaration<P>["within"];
  read: (node: ContentNode<P>) => object;
  defaults?: object;
  id?: (props: P) => string;
}
const bodyDeclarations = new Map<string, WaterBodyDeclaration<any>>();

/** A body mount's params as the config holds them: its kind's defaults, the base's for the kind, its own. */
export const waterBodyParamsOf = (node: ContentNode<any>, base: WaterBase | null): object => {
  const body = bodyDeclarations.get(node.kind)!;
  const named = body.read(node);
  return body.defaults ? { ...body.defaults, ...base?.params.defaults?.[node.kind], ...named } : named;
};

/**
 * Declares a BODY of water on the one body base: every body takes the same children — <Actor>s, dressing,
 * foliage, particles — as its PARTS, placed in the water it owns by one ZONE rule (water/params.ts
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

export const isWaterBody = (node: ContentNode<any>): boolean => (WATER_BODY_KINDS as readonly string[]).includes(node.kind);

/** A body's id (its path segment). */
const waterBodyIdOf = (node: ContentNode<any>): string => node.decl.placesAs?.(node) ?? node.kind;

/** The PARTS of a body or of the base: every declaration mounted inside it but an <Actor> (actors are
 *  placed through featurePlacement.ts by the body's id), by kind, with its resolved params. */
export const waterPartsOf = (node: ContentNode<any>): Record<string, unknown> => {
  const parts: Record<string, unknown> = {};
  for (const child of node.children) {
    if (child.kind === "actor") continue;
    if (child.kind in parts) reportContentError(`<${child.kind}> is mounted twice in one <${node.kind}>`);
    parts[child.kind] = child.decl.read ? child.decl.read(child) : true;
  }
  return parts;
};

/** A body as the config lists it: its kind and id, its params (with the <Water> base's defaults for its
 *  kind) and its parts. */
export const waterBodyOf = (node: ContentNode<any>, base: WaterBase | null): Omit<WaterBody, "regionId" | "biomeId"> => ({
  kind: node.kind,
  id: waterBodyIdOf(node),
  params: waterBodyParamsOf(node, base),
  parts: waterPartsOf(node),
});

/** The bodies a biome carries: its region's, each replaced in place by the biome's own mount of the same
 *  id, then the biome's others — JSX order. */
export const waterBodyNodesOf = (biome: ContentNode<any>, region: ContentNode<any> | null): ContentNode<any>[] => {
  const own = biome.children.filter(isWaterBody);
  const ids = new Set<string>();
  for (const n of own) {
    if (ids.has(waterBodyIdOf(n))) reportContentError(`<${n.kind}> "${waterBodyIdOf(n)}" is mounted twice in biome "${biome.props.name}"`);
    ids.add(waterBodyIdOf(n));
  }
  const folded = (region?.children.filter(isWaterBody) ?? []).map((n) => own.find((o) => waterBodyIdOf(o) === waterBodyIdOf(n)) ?? n);
  return [...folded, ...own.filter((n) => !folded.includes(n))];
};
