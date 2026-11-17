import { declare } from "../content";
import { ROOMS, SEWERS } from "../../generation/underground/params";
import { SEWER_CHANCE } from "../../generation/underground/constants";
import { SIDE_ROOM_CHANCE } from "../../generation/underground/sewers/constants";
import type { TunnelProps } from "./TunnelsDriver";
import { TunnelsDriver } from "./TunnelsDriver";
import { partOf } from "./utils";

export interface SewersProps extends TunnelProps {}

/** SEWERS under the streets of the biome this is mounted in, reached through its manholes. A
 *  <Rooms> inside puts a door at junctions into a side room. */
export const Sewers = declare<SewersProps>({
  kind: SEWERS,
  within: "biome",
  read: (node) => ({
    chance: node.props.chance ?? SEWER_CHANCE,
    sideRooms: partOf(node, ROOMS, { chance: SIDE_ROOM_CHANCE }),
  }),
  Driver: () => <TunnelsDriver tunnel="sewer" kind={SEWERS} />,
});
