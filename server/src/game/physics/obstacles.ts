import * as RAPIER from "@dimforge/rapier3d-compat";
import { computeVertexData, getCityFreewaySidePoints, getCityTrafficLightPoints } from "../../../../src/utils/workers/vertexCompute";
import { generateDensityPoints } from "../../../../src/utils/workers/densityPoints";
import { CITY_BIOME_ID } from "../../../../src/world/constants";
import { DRESSING_CHUNK_SIZE, yawFromDir, type DressingColliderPart } from "../../../../src/objects/dressing/types";
import { LAMP_COLLIDER_PARTS, LAMP_PLACEMENT, lampYaw } from "../../../../src/objects/dressing/street-lamps/lampSpec";
import { SIGNAL_COLLIDER_PARTS, SIGNAL_DEFAULT_CHANCE } from "../../../../src/objects/dressing/traffic-lights/signalSpec";
import { POLE_COLLIDER_PARTS, POLE_PLACEMENT } from "../../../../src/objects/dressing/power-lines/poleSpec";
import type { PhysicsWorld } from "./physicsWorld.js";

/**
 * DRESSING OBSTACLES on the server — street lamps, traffic signals, utility
 * poles — as the SAME cuboid colliders the client mounts near the camera
 * (Dressing.tsx DressingPartColliders: one fixed body per point carrying the
 * instance yaw, one cuboid per part), placed by the SAME enumerators the
 * dressing worker runs (generateDensityPoints / getCityTrafficLightPoints /
 * getCityFreewaySidePoints) with the SAME spec defaults (lampSpec / signalSpec /
 * poleSpec). So an NPC that walks around a lamp post on the server walks
 * around the lamp post every client draws.
 *
 * Built per DRESSING_CHUNK_SIZE (256u) chunk, refcounted by the NPCs standing
 * near them (PhysicsWorld holds the chunk lifecycle; this file only knows how
 * to build one chunk). Chunk size MUST stay the client's: the belt-freeway
 * pole coverage depends on the query center's wall set (vertexCompute note).
 *
 * The CITY biome's mounts use every spec default (`<TrafficLights chance={0.45}/>`
 * equals SIGNAL_DEFAULT_CHANCE) — if a mount ever overrides a knob, mirror it
 * in SERVER_DRESSING below.
 */

export const SERVER_DRESSING = {
  lamps: LAMP_PLACEMENT,
  signals: { chance: SIGNAL_DEFAULT_CHANCE },
  poles: POLE_PLACEMENT,
};

export interface ObstaclePoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
  parts: DressingColliderPart[];
}

/** Mirror of the dressing worker's probe: a chunk with no city in it has no
 *  dressing, so skip the enumerators entirely. */
const probeEmpty = (minX: number, minZ: number, maxX: number, maxZ: number): boolean => {
  const vd = computeVertexData((minX + maxX) / 2, (minZ + maxZ) / 2);
  return vd.biomeId !== CITY_BIOME_ID && vd.distanceToBiomeBoundaryCenter > (maxX - minX) * 0.75;
};

/** Every dressing collider body in the chunk at dressing-grid index (gx, gz);
 *  `freewayWidth` from the physics domain's config (pole lateral offset). */
export const enumerateObstacles = (gx: number, gz: number, freewayWidth: number): ObstaclePoint[] => {
  const cs = DRESSING_CHUNK_SIZE;
  const minX = gx * cs;
  const minZ = gz * cs;
  const maxX = minX + cs;
  const maxZ = minZ + cs;
  if (probeEmpty(minX, minZ, maxX, maxZ)) return [];
  const out: ObstaclePoint[] = [];
  for (const p of generateDensityPoints(minX, minZ, maxX, maxZ, SERVER_DRESSING.lamps)) {
    out.push({ x: p.x, y: p.y, z: p.z, yaw: lampYaw(p.x, p.z), parts: LAMP_COLLIDER_PARTS });
  }
  for (const p of getCityTrafficLightPoints(minX, minZ, maxX, maxZ, SERVER_DRESSING.signals.chance)) {
    out.push({ x: p.x, y: p.y, z: p.z, yaw: yawFromDir(p.dirX, p.dirZ), parts: SIGNAL_COLLIDER_PARTS });
  }
  const lateral = freewayWidth + SERVER_DRESSING.poles.lateralMargin;
  for (const p of getCityFreewaySidePoints(minX, minZ, maxX, maxZ, SERVER_DRESSING.poles.spacing, lateral, SERVER_DRESSING.poles.junctionClear, false)) {
    if (p.side !== SERVER_DRESSING.poles.side) continue;
    out.push({ x: p.x, y: p.y, z: p.z, yaw: yawFromDir(p.dirX, p.dirZ), parts: POLE_COLLIDER_PARTS });
  }
  return out;
};

/** One fixed body per point, yaw about Y, a cuboid per part — exactly
 *  <RigidBody position rotation={[0, yaw, 0]}><CuboidCollider args={[w/2,h/2,d/2]} position={[x, y, 0]}/></RigidBody>. */
export const createObstacleBodies = (pw: PhysicsWorld, points: ObstaclePoint[]): RAPIER.RigidBody[] => {
  const bodies: RAPIER.RigidBody[] = [];
  for (const p of points) {
    const half = p.yaw / 2;
    const body = pw.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(p.x, p.y, p.z).setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }),
    );
    for (const part of p.parts) {
      pw.world.createCollider(RAPIER.ColliderDesc.cuboid(part.w / 2, part.h / 2, part.d / 2).setTranslation(part.x, part.y, 0), body);
    }
    bodies.push(body);
  }
  return bodies;
};
