import * as RAPIER from "@dimforge/rapier3d-compat";
import { generateBuildingPlan } from "../../../../src/objects/actors/building/generatePlan";
import { buildProxyHullVertices, createProxyCollider, type ProxyColliderHandle } from "../../../../src/objects/actors/building/proxyCollider";
import { buildingSeedAt } from "../../../../src/objects/actors/building/spec";
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

/** Insertion order ≈ age: the oldest half goes, never the whole cache. */
const evictOldestHalf = (cache: Map<string, unknown>): void => {
  let n = cache.size >> 1;
  for (const k of cache.keys()) {
    if (n-- <= 0) break;
    cache.delete(k);
  }
};

const readPlanFacts = (seed: string, attrs: BuildingAttributes): PlanFacts => {
  const plan = generateBuildingPlan(seed, attrs);
  const doorsXZ = new Float64Array(plan.doors.length * 2);
  plan.doors.forEach((d, i) => {
    doorsXZ[i * 2] = d.position[0];
    doorsXZ[i * 2 + 1] = d.position[2];
  });
  return { hull: buildProxyHullVertices(plan), doorsXZ };
};

/** The building at (x, z), seeded like Building.tsx (no spec sets an explicit seed). */
const planFactsAt = (attrs: BuildingAttributes, x: number, z: number): PlanFacts => {
  const seed = buildingSeedAt(x, z);
  const key = `${seed}|${JSON.stringify(attrs)}`;
  let facts = planCache.get(key);
  if (!facts) {
    if (planCache.size >= MAX_PLAN_CACHE) evictOldestHalf(planCache);
    facts = readPlanFacts(seed, attrs);
    planCache.set(key, facts);
  }
  return facts;
};

/** Door offsets from the building at (x, z) — the leaves Building.tsx places from the same plan. */
export const doorOffsetsFor = (attrs: BuildingAttributes, x: number, z: number): Float64Array => planFactsAt(attrs, x, z).doorsXZ;

/** `attrs` = the actor spec's `hull` (plan-shaping attributes); y = ground height. */
export const createBuildingCollider = (
  pw: PhysicsWorld,
  attrs: BuildingAttributes,
  x: number,
  y: number,
  z: number,
): ProxyColliderHandle => {
  const handle = createProxyCollider({ world: pw.world, rapier: RAPIER }, [x, y, z], planFactsAt(attrs, x, z).hull);
  pw.markQueriesDirty();
  return handle;
};
