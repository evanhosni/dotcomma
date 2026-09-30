import * as RAPIER from "@dimforge/rapier3d-compat";
import { DRESSING_COLLIDER_SPECS } from "../../../../src/objects/dressing/catalog";
import { runDressingEnumerator } from "../../../../src/objects/dressing/enumerators";
import { DRESSING_CHUNK_SIZE, type DressingColliderBody, type DressingColliderPart } from "../../../../src/objects/dressing/types";
import type { PhysicsWorld } from "./physicsWorld.js";

/**
 * Every collider-bearing dressing feature (objects/dressing/catalog.ts) as the client's exact
 * cuboid colliders (Dressing.tsx DressingPartColliders): each spec's enumerator run in-thread with
 * its spec placement, each point through its spec's bodiesOf. Chunk size MUST stay
 * DRESSING_CHUNK_SIZE: belt-freeway pole and bridge coverage depend on the query center's wall set.
 */

export interface ObstaclePoint extends DressingColliderBody {
  parts: DressingColliderPart[];
}

export const enumerateObstacles = (gx: number, gz: number): ObstaclePoint[] => {
  const cs = DRESSING_CHUNK_SIZE;
  const bounds = { minX: gx * cs, minZ: gz * cs, maxX: (gx + 1) * cs, maxZ: (gz + 1) * cs };
  const out: ObstaclePoint[] = [];
  for (const spec of DRESSING_COLLIDER_SPECS) {
    for (const point of runDressingEnumerator(spec.enumerator, bounds, spec.placement)) {
      for (const body of spec.bodiesOf(point)) out.push({ ...body, parts: body.parts ?? spec.colliderParts });
    }
  }
  return out;
};

/** Exactly the client's <RigidBody rotation={[0, yaw, pitch]}><CuboidCollider args={[w/2,h/2,d/2]} position={[x, y, z]}/> (+ a mesh):
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
      pw.world.createCollider(desc, body);
    }
    // A bridge chord's drawn slab and walls, exactly: the client's <TrimeshCollider args={[vertices, indices]}>.
    if (p.mesh) pw.world.createCollider(RAPIER.ColliderDesc.trimesh(p.mesh.vertices, p.mesh.indices), body);
    bodies.push(body);
  }
  return bodies;
};
