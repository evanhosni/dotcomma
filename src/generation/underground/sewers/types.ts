import type { CityDistrict } from "../../roads/city/types";
import type { PipeWalkway } from "../field/types";
import type { ManholeInfo, TunnelSystem } from "../types";

export interface SewerNode {
  key: string;
  i: number;
  j: number;
  x: number;
  z: number;
  street: number;
  floor: number;
  /** A street leaves on this side (SEWER_DIRS order). */
  links: [boolean, boolean, boolean, boolean];
  room: boolean;
  manhole: boolean;
  /** The shaft's floor corner (±1, ±1) in lattice axes. */
  manholeCorner: [number, number];
  /** The side (SEWER_DIRS index) with a door, or −1. */
  door: number;
  manholeInfo: ManholeInfo | null;
}

export interface SewerStreet {
  a: string;
  b: string;
}

export interface SewerLayout {
  key: string;
  district: CityDistrict;
  nodes: Map<string, SewerNode>;
  streets: SewerStreet[];
}

/** A sewer system keeps its layout: the district's systems merge by layout (mergeLayouts). */
export interface SewerSystem extends TunnelSystem {
  layout: SewerLayout;
}

/** A street's frame for whatever runs along its pipe: the walkways, the length, the unit direction
 *  a → b and the left-hand side. */
export interface StreetFrame {
  pipe: PipeWalkway;
  length: number;
  dx: number;
  dz: number;
  sideX: number;
  sideZ: number;
}
