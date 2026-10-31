import { useRapier } from "@react-three/rapier";
import { useEffect } from "react";
import * as THREE from "three";
import type { ModelColliders } from "./types";

const _euler = new THREE.Euler();
const _quaternion = new THREE.Quaternion();

/**
 * A model's fitted shapes (createColliders) as ONE fixed Rapier body at the actor's feet, every shape a
 * collider on it at its model-space offset — built and removed imperatively, like every other body
 * (CLAUDE.md: never a <RigidBody> per object). Present while `active` (the lifecycle's distance gate). A
 * moving actor is `body: "kinematic"` (kinematicMover.tsx), never this.
 */
export const useModelColliders = (colliders: ModelColliders | null, coordinates: THREE.Vector3Tuple, active: boolean): void => {
  const { world, rapier } = useRapier();
  const [x, y, z] = coordinates;

  useEffect(() => {
    if (!active || !colliders) return;
    const body = world.createRigidBody(rapier.RigidBodyDesc.fixed().setTranslation(x, y, z));
    const add = (desc: InstanceType<typeof rapier.ColliderDesc>, position: THREE.Vector3Tuple, rotation?: THREE.Vector3Tuple): void => {
      desc.setTranslation(position[0], position[1], position[2]);
      if (rotation) {
        _quaternion.setFromEuler(_euler.set(rotation[0], rotation[1], rotation[2]));
        desc.setRotation({ x: _quaternion.x, y: _quaternion.y, z: _quaternion.z, w: _quaternion.w });
      }
      world.createCollider(desc, body);
    };
    for (const c of colliders.capsuleColliders) add(rapier.ColliderDesc.capsule(c.height / 2, c.radius), c.position);
    for (const c of colliders.sphereColliders) add(rapier.ColliderDesc.ball(c.radius), c.position);
    for (const c of colliders.boxColliders) add(rapier.ColliderDesc.cuboid(c.size[0] / 2, c.size[1] / 2, c.size[2] / 2), c.position, c.rotation);
    for (const c of colliders.trimeshColliders) add(rapier.ColliderDesc.trimesh(c.vertices, c.indices), c.position, c.rotation);
    return () => {
      world.removeRigidBody(body);
    };
  }, [world, rapier, colliders, active, x, y, z]);
};
