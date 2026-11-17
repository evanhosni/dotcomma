import { RoomRect } from "../types";
import type { Vec3 } from "../types";

/** A BSP split wall at `at` on `axis`, running `from`..`to` along the other axis. */
export interface SplitWall {
  axis: "x" | "z";
  at: number;
  from: number;
  to: number;
  doorAt: number;
}

/** One story's BSP result: its leaf rooms, their split walls, and the rects (shafts, arrival holes) walls avoid. */
export interface StoryLayout {
  rooms: RoomRect[];
  splitWalls: SplitWall[];
  obstacles: RoomRect[];
}

export interface RampCollider {
  position: Vec3;
  rotation: Vec3;
  halfExtents: Vec3;
}

export type SlabHole = { x0: number; z0: number; x1: number; z1: number };
