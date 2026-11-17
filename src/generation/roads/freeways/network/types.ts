import type { Zone } from "../../../types";

export interface NetSite {
  x: number;
  z: number;
  ix: number;
  iz: number;
  zone: Zone;
}
export interface NetJunction {
  x: number;
  z: number;
  sites: [number, number, number];
  city: boolean;
  comp: number;
  walls: number[];
}
export interface NetWall {
  s: number;
  e: number;
  a: number;
  b: number;
  len: number;
}

/** A freeway path along walls: warped-space polyline + cumulative arc length. */
export interface FreewayRun {
  pts: number[]; // x, z pairs
  cum: number[]; // cumulative length at each point
  length: number;
  /** Dash-phase offset so two runs never share a phase origin. */
  phase: number;
  /** Bounding box of pts (nearestFreewayRun's skip test). */
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface WallNetwork {
  freeways: FreewayRun[];
  /** Routing diagnostics (tests/probes). */
  debug: { comps: number; pairs: number; linked: number; noPath: number; stretched: number; gaps: number };
}

export type NetworkDebug = WallNetwork["debug"];

/** A network window's site graph: sites, junctions (Delaunay triangles, at their circumcenters) and
 *  walls (Delaunay edges between two triangles), with each junction's city component. */
export interface NetGraph {
  sites: NetSite[];
  junctions: NetJunction[];
  walls: NetWall[];
  /** The city component (union-find root over city|city walls) of a site. */
  compOf: (site: number) => number;
  /** 1 where a freeway may run: no city and no lake on either side. */
  walkable: Uint8Array;
  /** Well inside the window. The Delaunay is distorted along the window's border, so a source or a
   *  run there decides differently than the window that has it near its center (roads would end at
   *  cell borders). */
  trusted: (x: number, z: number) => boolean;
}
