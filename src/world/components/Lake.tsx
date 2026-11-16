import type { ReactNode } from "react";
import { LAKE, LAKE_DEFAULTS, type LakeParams } from "../../utils/workers/water/lakes/params";
import { readWaterColors } from "../../utils/workers/water/material";
import type { WaterColorProps } from "../../utils/workers/water/types";
import { declareWaterBody, definedProps } from "./Water";

export interface LakeProps extends Partial<Omit<LakeParams, "depth" | keyof WaterColorProps>>, WaterColorProps {
  /** How far the bowl sinks below the filled surface at the cell's centre. */
  depth: number;
  children?: ReactNode;
}

/** A LAKE: the biome it is mounted in IS water — its terrain bowls `depth` under a level blended across
 *  the neighbouring lake cells, the shore is held above it, and no inter-city freeway may run along its
 *  walls. A river reaching it runs on into the basin. Every other knob (the level, the bed's hummocks, the
 *  shore lift, how rivers widen toward it and ease onto it) defaults to the <Water defaults={{ lake }}>, then
 *  LAKE_DEFAULTS; its colours to the <Water> base's. A body of water: its children are its PARTS. */
export const Lake = declareWaterBody<LakeProps>({
  kind: LAKE,
  within: "biome",
  defaults: LAKE_DEFAULTS,
  read: (node) => {
    const { children: _parts, shallowColor: _s, deepColor: _d, deepDepth: _dd, ...props } = node.props;
    return { ...definedProps(props), ...readWaterColors(node.props) };
  },
});
