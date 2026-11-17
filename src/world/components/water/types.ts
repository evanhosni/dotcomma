import { WATER_BODY_KINDS } from "../../../generation/water/params";
import type { ContentDeclaration, ContentNode } from "../../content/types";

/** The body of water a view is mounted in (<Lake>, <Rivers>, <Pond>): its parts (seaweed) are placed by the
 *  water it owns, not by the biome around it. The worker resolves it to its DomainConfig.waterBodies slot. */
export interface WaterBodyRef {
  /** The body's id (WaterBody.id) and where it is mounted. */
  id: string;
  biomeId?: number;
  regionId?: number;
}

/** A BODY of water's declaration: its kind, where it may stand, the params a mount NAMES (`read`), its
 *  kind's `defaults` and its id (its path segment; default its kind — a body mounted several times in one
 *  biome, a <Pond>, names its mounts apart by it). With `defaults` a mount's params are resolved whole when
 *  the config is assembled: the kind's defaults, under the <Water> base's for the kind, under the mount's own
 *  (waterBodyParamsOf). Without, they are only what it names, and the kind resolves them at run time (a
 *  <Rivers> prop by prop over its region's: generation/water/rivers/params.ts riversIn). */
export interface WaterBodyDeclaration<P> {
  kind: (typeof WATER_BODY_KINDS)[number];
  within: ContentDeclaration<P>["within"];
  read: (node: ContentNode<P>) => object;
  defaults?: object;
  id?: (props: P) => string;
}
