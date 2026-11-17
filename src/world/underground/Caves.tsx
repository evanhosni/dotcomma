import { declare } from "../content";
import { CAVES, ROOMS } from "../../generation/underground/params";
import { CAVE_CHANCE } from "../../generation/underground/constants";
import { ROOM_TIP_CHANCE, ROOM_TRUNK_CHANCE } from "../../generation/underground/caves/constants";
import type { TunnelProps } from "./TunnelsDriver";
import { TunnelsDriver } from "./TunnelsDriver";
import { partOf } from "./utils";

export interface CavesProps extends TunnelProps {}

/** CAVES under the biome this is mounted in: their mouths open in its slopes (the terrain bulges
 *  them open), and the passages run on into the rock. A <Rooms> inside adds side rooms. */
export const Caves = declare<CavesProps>({
  kind: CAVES,
  within: "biome",
  read: (node) => ({
    chance: node.props.chance ?? CAVE_CHANCE,
    sideRooms: partOf(node, ROOMS, { trunkChance: ROOM_TRUNK_CHANCE, tipChance: ROOM_TIP_CHANCE }),
  }),
  Driver: () => <TunnelsDriver tunnel="cave" kind={CAVES} />,
});
