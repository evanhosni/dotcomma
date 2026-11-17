import * as RAPIER from "@dimforge/rapier3d-compat";
import { generateBuildingPlan } from "../../../../../src/objects/actors/building";
import { buildProxyHullVertices, createProxyCollider } from "../../../../../src/objects/actors/building/collider";
import type { ProxyColliderHandle } from "../../../../../src/objects/actors/building/collider/types";
import { buildingSeedAt } from "../../../../../src/objects/actors/building/spec";
import type { BuildingAttributes } from "../../../../../src/objects/actors/building/types";
import type { PhysicsWorld } from "../physicsWorld.js";
import { DEFAULT_COLLIDER } from "../../../../../src/objects/actors/spec";
import type { ActorSpec } from "../../../../../src/objects/actors/spec";
import { FreeBody } from "./FreeBody.js";
import { GroundBody } from "./GroundBody.js";
import type { NpcBody } from "./types";
import { markFullSpeedSlope } from "../../../../../src/physics";
import type { ObstaclePoint } from "../types.js";

/**
 * The client's own sealed silhouette hull (objects/actors/building/collider/index.ts) over the client's
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

/**
 * The physical half of a simulated actor: `step` BEFORE the world step with the
 * machine's motion output (u/s; vy null = gravity/ground), `resolvePose` AFTER it with
 * the FEET position and ACTUAL velocity that get published. The body follows the spec:
 * kinematic+ground → GroundBody, kinematic+free → FreeBody, else none. The client's
 * objects/actors/model/hooks.ts has the same two branches — adding a movement kind = a class here
 * + a branch there.
 */

/** `hintFeetY`: where the body stands until the server's own ground is answered (PhysicsWorld.heightAt). */
export const createNpcBody = (pw: PhysicsWorld, spec: ActorSpec, x: number, z: number, hintFeetY: number): NpcBody | null => {
  if (spec.body !== "kinematic") return null;
  return (spec.movement ?? "ground") === "free"
    ? new FreeBody(pw, x, z, hintFeetY)
    : new GroundBody(pw, x, z, spec.collider ?? DEFAULT_COLLIDER, hintFeetY);
};

/** The dressing obstacles (server/src/game/physics/utils.ts) as the client's exact colliders (Dressing.tsx ChunkColliders):
 *  the client's <RigidBody rotation={[0, yaw, pitch]}><CuboidCollider args={[w/2,h/2,d/2]} position={[x, y, z]}/> (+ a mesh).
 *  Euler XYZ = qY(yaw) · qZ(pitch), composed here by hand. */
export const createObstacleBodies = (pw: PhysicsWorld, points: ObstaclePoint[]): RAPIER.RigidBody[] => {
  const bodies: RAPIER.RigidBody[] = [];
  for (const p of points) {
    const sy = Math.sin(p.yaw / 2);
    const cy = Math.cos(p.yaw / 2);
    const sz = Math.sin((p.pitch ?? 0) / 2);
    const cz = Math.cos((p.pitch ?? 0) / 2);
    const body = pw.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(p.x, p.y, p.z).setRotation({ x: sy * sz, y: sy * cz, z: cy * sz, w: cy * cz }),
    );
    for (const part of p.parts) {
      // A part's own yaw (about the body's local y): the client's <CuboidCollider rotation={[0, yaw, 0]}>.
      const py = (part.yaw ?? 0) / 2;
      const desc = RAPIER.ColliderDesc.cuboid(part.w / 2, part.h / 2, part.d / 2).setTranslation(part.x, part.y, part.z ?? 0);
      if (part.yaw) desc.setRotation({ x: 0, y: Math.sin(py), z: 0, w: Math.cos(py) });
      const collider = pw.world.createCollider(desc, body);
      if (part.fullSpeedSlope) markFullSpeedSlope(collider);
    }
    // A bridge chord's drawn slab and walls, exactly: the client's <TrimeshCollider args={[vertices, indices]}>.
    if (p.mesh) {
      const mesh = pw.world.createCollider(RAPIER.ColliderDesc.trimesh(p.mesh.vertices, p.mesh.indices), body);
      if (p.mesh.fullSpeedSlope) markFullSpeedSlope(mesh);
    }
    bodies.push(body);
  }
  return bodies;
};
