import * as RAPIER from "@dimforge/rapier3d-compat";
import { generateBuildingPlan } from "../../../../src/objects/actors/building/generatePlan";
import { buildProxyHullVertices, createProxyCollider, type ProxyColliderHandle } from "../../../../src/objects/actors/building/proxyCollider";
import type { BuildingAttributes } from "../../../../src/objects/actors/building/types";
import type { PhysicsWorld } from "./world.js";

/**
 * The client's far-range proxy hull (building/proxyCollider.ts) from the
 * client's plan, so the server keeps an NPC out of exactly the wall every
 * client draws. Convex = sealed: NPCs never enter buildings.
 */

export interface BuildingKindSpec {
  attrs: BuildingAttributes;
}

/** The plan generator costs ~1ms per seed. */
const hullCache = new Map<string, Float32Array>();
const MAX_HULL_CACHE = 4096;

/** Must match Building.tsx's default seed rule. */
export const buildingSeed = (x: number, z: number): string => `${Math.round(x)}_${Math.round(z)}`;

export const hullVerticesFor = (seed: string, spec: BuildingKindSpec): Float32Array => {
  const key = `${seed}|${JSON.stringify(spec.attrs)}`;
  let v = hullCache.get(key);
  if (!v) {
    if (hullCache.size >= MAX_HULL_CACHE) {
      let n = hullCache.size >> 1;
      for (const k of hullCache.keys()) {
        if (n-- <= 0) break;
        hullCache.delete(k);
      }
    }
    v = buildProxyHullVertices(generateBuildingPlan(seed, spec.attrs));
    hullCache.set(key, v);
  }
  return v;
};

export const createBuildingCollider = (
  pw: PhysicsWorld,
  spec: BuildingKindSpec,
  x: number,
  y: number,
  z: number,
): ProxyColliderHandle => {
  const handle = createProxyCollider({ world: pw.world, rapier: RAPIER }, [x, y, z], hullVerticesFor(buildingSeed(x, z), spec));
  pw.markQueriesDirty();
  return handle;
};
