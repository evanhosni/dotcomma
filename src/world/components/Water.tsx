import { declare } from "../content";
import { WATER } from "../../utils/workers/lakes";

export interface WaterProps {
  /** How far the bowl sinks below the filled surface at the cell's centre. */
  depth: number;
}

/** WATER over the biome it is mounted in: the terrain bowls `depth` under a level blended across
 *  the neighbouring water cells, the shore is held above it, and no inter-city freeway may run
 *  along the biome's walls. A river reaching it runs on into the basin and ends there in a pond. */
export const Water = declare<WaterProps>({
  kind: WATER,
  within: "biome",
  read: (node) => ({ depth: node.props.depth }),
});
