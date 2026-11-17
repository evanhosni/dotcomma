/**
 * What a tunnel chunk is assembled from, both styles: the finished vertex, the ONE daylight rule (a
 * point source per mouth or manhole plus the ground overhead), and the assembly of the drawn mesh and
 * its column colliders (one trimesh per 16u column, by each triangle's centroid). Three-free.
 */
import { smoothstep } from "../../../utils/math";
import type { RectXZ } from "../../../utils/math/types";
import { DAYLIGHT_GROUND_DEPTH, DAYLIGHT_MOUTH_FAR, DAYLIGHT_MOUTH_NEAR } from "../constants";
import { drawnGroundAt } from "../../drawn-ground";
import { mouthLightY } from "../field";
import type { MouthPiece, SkirtMask } from "../types";
import type { DaylightSource } from "./types";

/** Daylight at a point: from the nearest source and from the ground within DAYLIGHT_GROUND_DEPTH overhead. */
export const daylightAt = (lights: readonly DaylightSource[], x: number, y: number, z: number): number => {
  let light = 1 - smoothstep(0, DAYLIGHT_GROUND_DEPTH, drawnGroundAt(x, z) - y);
  for (const l of lights) {
    if (Math.abs(l.x - x) > l.far || Math.abs(l.z - z) > l.far || Math.abs(l.y - y) > l.far) continue;
    const v = 1 - smoothstep(l.near, l.far, Math.sqrt((l.x - x) ** 2 + (l.y - y) ** 2 + (l.z - z) ** 2));
    if (v > light) light = v;
  }
  return light;
};

/** A mouth's daylight: from its axis over the opening (mouthLightY), full within DAYLIGHT_MOUTH_NEAR. */
export const mouthDaylight = (m: MouthPiece): DaylightSource => ({ x: m.ox, y: mouthLightY(m), z: m.oz, near: DAYLIGHT_MOUTH_NEAR, far: DAYLIGHT_MOUTH_FAR });

/** The masks whose capsule reaches a chunk (horizontally). */
export const masksTouching = (masks: readonly SkirtMask[], b: RectXZ): SkirtMask[] =>
  masks.filter((m) => Math.min(m.ax, m.bx) - m.radius <= b.maxX && Math.max(m.ax, m.bx) + m.radius >= b.minX && Math.min(m.az, m.bz) - m.radius <= b.maxZ && Math.max(m.az, m.bz) + m.radius >= b.minZ);
