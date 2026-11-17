import { declare } from "../content";
import { CAVES, ROOMS, SEWERS } from "../../generation/underground/params";

export interface RoomsProps {
  /** Caves: the chance of a room on the trunk, clear of the mouths. */
  trunkChance?: number;
  /** Caves: the chance of a room at each branch's tip. */
  tipChance?: number;
  /** Sewers: the chance a junction gets a door into a room (kept only where the room fits). */
  chance?: number;
}

/** SIDE ROOMS off the tunnels this is mounted in; an <Actor> inside stands one in each. */
export const Rooms = declare<RoomsProps>({ kind: ROOMS, within: [CAVES, SEWERS] });
