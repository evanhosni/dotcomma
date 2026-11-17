import { reportContentError } from "../../../utils/utils";
import { WATER_BODY_KINDS } from "../../../generation/water/params";
import type { WaterBase, WaterBody } from "../../../generation/water/types";
import type { ContentNode } from "../../content/types";
import { waterBodyParamsOf } from "./registry";

/** A mount's props that are set (a prop written `undefined` names nothing). */
export const definedProps = <T extends object>(props: T): Partial<T> => Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined)) as Partial<T>;

export const isWaterBody = (node: ContentNode<any>): boolean => (WATER_BODY_KINDS as readonly string[]).includes(node.kind);

/** A body's id (its path segment). */
const waterBodyIdOf = (node: ContentNode<any>): string => node.decl.placesAs?.(node) ?? node.kind;

/** The PARTS of a body or of the base: every declaration mounted inside it but an <Actor> (actors are
 *  placed through generation/placement/registry.ts by the body's id), by kind, with its resolved params. */
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
