import * as RAPIER from "@dimforge/rapier3d-compat";
import { generateBuildingPlan } from "../../../../src/objects/actors/building/generatePlan";
import { buildProxyHullVertices, createProxyCollider, type ProxyColliderHandle } from "../../../../src/objects/actors/building/proxyCollider";
import type { BuildingAttributes } from "../../../../src/objects/actors/building/types";
import type { PhysicsWorld } from "./physicsWorld.js";

/**
 * BUILDING COLLIDERS on the server: the SAME convex silhouette hull the client
 * uses as a building's far-range collider (objects/actors/building/
 * proxyCollider.ts — Andrew's monotone chain over the shell's 2D silhouette,
 * extruded bottom-to-top), built from the SAME plan (generateBuildingPlan,
 * seeded by the building's rounded spawn coordinates, shaped by the kind's
 * hull attributes from building/spec.ts) — so an NPC the server keeps out of a wall is
 * kept out of the wall every client draws. Convex = SEALED (no door): NPCs
 * never enter buildings, which is what the client's proxy already enforced
 * at range.
 *
 * The plan is the client's full interior-first generator (~1ms per seed here)
 * and is cached per seed|attributes; the hull is ~14 points.
 */

const hullCache = new Map<string, Float32Array>();
const MAX_HULL_CACHE = 4096;

/** Seed rule from Building.tsx: `${round(x)}_${round(z)}` unless a `seed` prop is set (none of the descriptors set one). */
export const buildingSeed = (x: number, z: number): string => `${Math.round(x)}_${Math.round(z)}`;

export const hullVerticesFor = (seed: string, attrs: BuildingAttributes): Float32Array => {
  const key = `${seed}|${JSON.stringify(attrs)}`;
  let v = hullCache.get(key);
  if (!v) {
    if (hullCache.size >= MAX_HULL_CACHE) {
      // Drop the oldest half (insertion order ≈ recency).
      let n = hullCache.size >> 1;
      for (const k of hullCache.keys()) {
        if (n-- <= 0) break;
        hullCache.delete(k);
      }
    }
    v = buildProxyHullVertices(generateBuildingPlan(seed, attrs));
    hullCache.set(key, v);
  }
  return v;
};

/** The building's sealed hull at its spawn origin (feet at ground height y);
 *  `attrs` = the kind's plan-shaping attributes (the actor spec's `hull`). */
export const createBuildingCollider = (
  pw: PhysicsWorld,
  attrs: BuildingAttributes,
  x: number,
  y: number,
  z: number,
): ProxyColliderHandle => {
  const handle = createProxyCollider({ world: pw.world, rapier: RAPIER }, [x, y, z], hullVerticesFor(buildingSeed(x, z), attrs));
  pw.markQueriesDirty();
  return handle;
};
