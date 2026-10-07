import * as RAPIER from "@dimforge/rapier3d-compat";
import type { ObstaclePoint } from "./obstaclePoints.js";
import type { PhysicsWorld } from "./physicsWorld.js";

/** The dressing obstacles (obstaclePoints.ts) as the client's exact colliders (Dressing.tsx DressingPartColliders):
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
      pw.world.createCollider(desc, body);
    }
    // A bridge chord's drawn slab and walls, exactly: the client's <TrimeshCollider args={[vertices, indices]}>.
    if (p.mesh) pw.world.createCollider(RAPIER.ColliderDesc.trimesh(p.mesh.vertices, p.mesh.indices), body);
    bodies.push(body);
  }
  return bodies;
};
