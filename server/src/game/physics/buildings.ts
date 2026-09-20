import * as RAPIER from "@dimforge/rapier3d-compat";
import { generateBuildingPlan } from "../../../../src/objects/actors/building/generatePlan";
import { buildProxyHullVertices, createProxyCollider, type ProxyColliderHandle } from "../../../../src/objects/actors/building/proxyCollider";
import type { BuildingAttributes } from "../../../../src/objects/actors/building/types";
import type { PhysicsWorld } from "./physicsWorld.js";

/**
 * The client's own sealed silhouette hull (building/proxyCollider.ts) over the client's
 * own plan, so an NPC the server keeps out of a wall is kept out of the wall every
 * client draws. Convex = no door: NPCs never enter buildings. The plan costs ~1ms per
 * seed and is cached per seed|attributes.
 */

const hullCache = new Map<string, Float32Array>();
const MAX_HULL_CACHE = 4096;

/** Building.tsx's seed rule (no descriptor sets an explicit seed). */
export const buildingSeed = (x: number, z: number): string => `${Math.round(x)}_${Math.round(z)}`;

export const hullVerticesFor = (seed: string, attrs: BuildingAttributes): Float32Array => {
  const key = `${seed}|${JSON.stringify(attrs)}`;
  let v = hullCache.get(key);
  if (!v) {
    if (hullCache.size >= MAX_HULL_CACHE) {
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

/** `attrs` = the actor spec's `hull` (plan-shaping attributes); y = ground height. */
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
