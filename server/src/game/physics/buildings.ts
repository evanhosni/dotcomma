import * as RAPIER from "@dimforge/rapier3d-compat";
import { generateBuildingPlan } from "../../../../src/objects/actors/building/generatePlan";
import { buildProxyHullVertices, createProxyCollider, type ProxyColliderHandle } from "../../../../src/objects/actors/building/proxyCollider";
import type { BuildingAttributes } from "../../../../src/objects/actors/building/types";
import type { PhysicsWorld } from "./physicsWorld.js";

/**
 * The client's own sealed silhouette hull (building/proxyCollider.ts) over the client's
 * own plan, so an NPC the server keeps out of a wall is kept out of the wall every
 * client draws. Convex = no door: NPCs never enter buildings. The same plan gives the
 * door positions the interact gate measures a door click from. The plan costs ~1ms per
 * seed; what the server keeps of it is cached per seed|attributes.
 */

interface PlanFacts {
  hull: Float32Array;
  /** Each door's position relative to the building origin, x/z interleaved, in plan order (= `door:<i>`). */
  doorsXZ: Float64Array;
}

const planCache = new Map<string, PlanFacts>();
const MAX_PLAN_CACHE = 4096;

/** Building.tsx's seed rule (no descriptor sets an explicit seed). */
export const buildingSeed = (x: number, z: number): string => `${Math.round(x)}_${Math.round(z)}`;

const planFactsFor = (seed: string, attrs: BuildingAttributes): PlanFacts => {
  const key = `${seed}|${JSON.stringify(attrs)}`;
  let facts = planCache.get(key);
  if (!facts) {
    if (planCache.size >= MAX_PLAN_CACHE) {
      let n = planCache.size >> 1;
      for (const k of planCache.keys()) {
        if (n-- <= 0) break;
        planCache.delete(k);
      }
    }
    const plan = generateBuildingPlan(seed, attrs);
    const doorsXZ = new Float64Array(plan.doors.length * 2);
    plan.doors.forEach((d, i) => {
      doorsXZ[i * 2] = d.position[0];
      doorsXZ[i * 2 + 1] = d.position[2];
    });
    facts = { hull: buildProxyHullVertices(plan), doorsXZ };
    planCache.set(key, facts);
  }
  return facts;
};

export const hullVerticesFor = (seed: string, attrs: BuildingAttributes): Float32Array => planFactsFor(seed, attrs).hull;

/** Door offsets from the building at (x, z) — the leaves Building.tsx places from the same plan. */
export const doorOffsetsFor = (attrs: BuildingAttributes, x: number, z: number): Float64Array =>
  planFactsFor(buildingSeed(x, z), attrs).doorsXZ;

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
