import type { ReactNode } from "react";
import { readWaterColors } from "../../../generation/water/material";
import { POND_DEFAULTS, POND_KIND, type PondShape, type PondSpec } from "../../../generation/water/ponds/params";
import type { WaterColorProps } from "../../../generation/water/types";
import { declareWaterBody } from "./Water";
import { definedProps } from "./utils";

export interface PondProps extends Partial<PondShape>, WaterColorProps {
  /** The kind (world/domains/overworld/water/spec.ts): a Three-free spec, like <Actor actor>. */
  kind: PondSpec;
  /** Each mode's chance per opportunity (0–1, default `chance`): a river's natural END (a miss ends it
   *  round), a calm slot MID-RIVER, a climbed gap's SUMMIT, a STANDALONE grid cell (world/water/README.md
   *  "Ponds"). */
  riverEnd?: number;
  midRiver?: number;
  summit?: number;
  standalone?: number;
  /** All four at once (default 0; each named one wins). */
  chance?: number;
  /** Shape overrides of the kind. */
  radius?: [number, number];
  blob?: PondSpec["blob"];
  children?: ReactNode;
}

/** POINT WATER where it is mounted: a pond, a spring — a disc of the river field, carved like a river's
 *  channel, walls and all, at a chance per opportunity of each placement mode. Mounted in a region, it is
 *  every biome's there that does not mount the same `kind` itself — a biome's own mount of a kind REPLACES
 *  its region's whole (`chance={0}` turns it off there); several kinds may share a biome, their chances
 *  summed in JSX order. Its shape (`wallGrade`, `wallEase`, `wallReach`, `minRadiusOverRiver`,
 *  `calmGrade`, `summitStream`) defaults to the <Water defaults={{ pond }}>, then POND_DEFAULTS; its water's
 *  colours are its kind's unless the mount names its own (`shallowColor`, `deepColor`, `deepDepth`). A body
 *  of water: its children are its PARTS. */
export const Pond = declareWaterBody<PondProps>({
  kind: POND_KIND,
  within: ["region", "biome"],
  id: (props) => `${POND_KIND}:${props.kind.id}`,
  defaults: POND_DEFAULTS,
  read: (node) => {
    const { kind, chance = 0, radius, blob, riverEnd = chance, midRiver = chance, summit = chance, standalone = chance } = node.props;
    const { children: _parts, shallowColor: _s, deepColor: _d, deepDepth: _dd, kind: _k, chance: _c, radius: _r, blob: _b, riverEnd: _e, midRiver: _m, summit: _t, standalone: _a, ...shape } = node.props;
    return {
      kind: { ...kind, ...(radius ? { radius } : {}), ...(blob ? { blob } : {}) },
      ...readWaterColors(kind),
      ...readWaterColors(node.props),
      riverEnd,
      midRiver,
      summit,
      standalone,
      ...definedProps(shape),
    };
  },
});
