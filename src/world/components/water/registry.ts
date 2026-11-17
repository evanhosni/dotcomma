import type { WaterBase } from "../../../generation/water/types";
import type { ContentNode } from "../../content/types";
import type { WaterBodyDeclaration } from "./types";

export const bodyDeclarations = new Map<string, WaterBodyDeclaration<any>>();

/** A body mount's params as the config holds them: its kind's defaults, the base's for the kind, its own. */
export const waterBodyParamsOf = (node: ContentNode<any>, base: WaterBase | null): object => {
  const body = bodyDeclarations.get(node.kind)!;
  const named = body.read(node);
  return body.defaults ? { ...body.defaults, ...base?.params.defaults?.[node.kind], ...named } : named;
};
