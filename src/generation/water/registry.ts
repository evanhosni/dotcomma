import type { RectXZ } from "../../utils/math/types";

/** What a body KIND tells the base about itself, registered by its own module so the base never names a
 *  body: where its water can lie in a world box (`reachIn`, by its DomainConfig.waterBodies slot; unset:
 *  anywhere in it — what narrows its parts' scatter, parts/). */
interface WaterBodyKind {
  reachIn?: (slot: number, area: RectXZ) => RectXZ[];
}
const bodyKinds = new Map<string, WaterBodyKind>();
/** Called once by a body's own module at load (this module is a leaf of the pipeline's import cycle, so it
 *  is always evaluated first). */
export const registerWaterBodyKind = (kind: string, hooks: WaterBodyKind): void => {
  bodyKinds.set(kind, hooks);
};
export const waterBodyKind = (kind: string): WaterBodyKind | undefined => bodyKinds.get(kind);
