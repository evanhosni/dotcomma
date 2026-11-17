import { traceEvent } from "../../utils/spike-trace";
import { useFrame } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import type { RapierRigidBody } from "@react-three/rapier";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { markFullSpeedSlope } from "../../physics";
import { reportContentError } from "../../utils/utils";
import type { ColliderPart, LiveColliderBody } from "./types";

const _colliderEuler = new THREE.Euler();
const _colliderQuat = new THREE.Quaternion();

/** One fixed Rapier body per point, created IMPERATIVELY (like the terrain heightfields and the
 *  building proxies): r-t-r's frame loop syncs every mounted <RigidBody> each frame and a fixed
 *  body never reads as sleeping. Same shapes and transforms as `<RigidBody rotation={[0, yaw,
 *  pitch]}>` + a `<CuboidCollider>` per part — the server builds the same (server/src/game/physics/bodies/index.ts). */
/** How many collider bodies a frame makes at most (a trimesh column is ~1ms; a fresh sewer is dozens). */
const COLLIDER_BODIES_PER_FRAME = 3;

export const ChunkColliders = ({
  colliders,
  parts,
}: {
  colliders: LiveColliderBody[];
  parts: ColliderPart[];
}): null => {
  const { world, rapier } = useRapier();
  const bodies = useRef(new Map<string, RapierRigidBody>()).current;
  const partsRef = useRef(parts);
  /** The points whose bodies are still to be made, nearest first (createBodies). */
  const pending = useRef<LiveColliderBody[]>([]).current;
  /** Bodies built on the previous `parts`: each stays until its successor is made in the same frame
   *  (a frame with no body let a walking capsule into a tunnel wall; `parts` must be one array per
   *  spec, never an inline literal). */
  const stale = useRef(new Set<string>()).current;

  useEffect(() => {
    // The shared boxes changed: every body is rebuilt, each replaced as its successor is made.
    if (partsRef.current !== parts) {
      partsRef.current = parts;
      bodies.forEach((_, key) => stale.add(key));
    }
    const wanted = new Set<string>();
    for (const c of colliders) wanted.add(c.key);
    bodies.forEach((body, key) => {
      if (wanted.has(key)) return;
      world.removeRigidBody(body);
      bodies.delete(key);
      stale.delete(key);
    });
    pending.length = 0;
    for (const c of colliders) if (!bodies.has(c.key) || stale.has(c.key)) pending.push(c);
  }, [colliders, parts, world, rapier, bodies, pending, stale]);

  // The bodies are made a few per frame, nearest the camera first: a fresh set (a sewer's trimesh
  // columns, a bridge's ribbons) made in one effect was a lag spike while flying.
  useFrame(({ camera }) => {
    if (pending.length === 0) return;
    if (pending.length > COLLIDER_BODIES_PER_FRAME) {
      const cx = camera.position.x;
      const cz = camera.position.z;
      pending.sort((a, b) => (a.x - cx) ** 2 + (a.z - cz) ** 2 - ((b.x - cx) ** 2 + (b.z - cz) ** 2));
    }
    const batch = pending.splice(0, COLLIDER_BODIES_PER_FRAME);
    const t0 = performance.now();
    for (const c of batch) {
      const old = bodies.get(c.key);
      if (old) {
        if (!stale.has(c.key)) continue;
        world.removeRigidBody(old);
        bodies.delete(c.key);
        stale.delete(c.key);
      }
      try {
        bodies.set(c.key, createBody(world, rapier, c, parts));
      } catch (err) {
        // Never silent: a body that failed to build is a hole in the world.
        reportContentError(`[chunk colliders] the body "${c.key}" at (${c.x}, ${c.y}, ${c.z}) failed to build: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    traceEvent("colliders:bodies", performance.now() - t0);
  });

  useEffect(
    () => () => {
      bodies.forEach((body) => world.removeRigidBody(body));
      bodies.clear();
      stale.clear();
    },
    [world, bodies, stale],
  );

  return null;
};

/** One collider point's fixed body: its shared or own boxes, and its mesh. */
const createBody = (world: ReturnType<typeof useRapier>["world"], rapier: ReturnType<typeof useRapier>["rapier"], c: LiveColliderBody, parts: ColliderPart[]): RapierRigidBody => {
  _colliderQuat.setFromEuler(_colliderEuler.set(0, c.yaw, c.pitch));
  const body = world.createRigidBody(
    rapier.RigidBodyDesc.fixed().setTranslation(c.x, c.y, c.z).setRotation(_colliderQuat),
  );
  for (const p of c.parts ?? parts) {
    _colliderQuat.setFromEuler(_colliderEuler.set(0, p.yaw ?? 0, 0));
    const part = world.createCollider(
      rapier.ColliderDesc.cuboid(p.w / 2, p.h / 2, p.d / 2).setTranslation(p.x, p.y, p.z ?? 0).setRotation(_colliderQuat),
      body,
    );
    if (p.fullSpeedSlope) markFullSpeedSlope(part);
  }
  if (c.mesh) {
    const mesh = world.createCollider(rapier.ColliderDesc.trimesh(c.mesh.vertices, c.mesh.indices), body);
    if (c.mesh.fullSpeedSlope) markFullSpeedSlope(mesh);
  }
  return body;
};
