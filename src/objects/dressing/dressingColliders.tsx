import { useFrame } from "@react-three/fiber";
import { useRapier, type RapierRigidBody } from "@react-three/rapier";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { markFullSpeedSlope } from "../../physics/characterMovement";
import type { DressingColliderBody, DressingColliderMesh, DressingColliderPart } from "./types";

/**
 * The dressing base's real colliders: the bodies of the chunks near the player, scanned from the
 * chunk registry and built as imperative Rapier bodies (used by useSolidDressing, Dressing.tsx).
 */

/** A mounted collider body: a chunk's DressingColliderBody (types.ts) keyed for React. */
interface DressingColliderPoint {
  key: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  parts?: DressingColliderPart[];
  mesh?: DressingColliderMesh;
}

/** Thin street furniture only needs to be solid where the player can reach it. */
export const DRESSING_COLLIDER_DISTANCE = 90;

const _colliderEuler = new THREE.Euler();
const _colliderQuat = new THREE.Quaternion();

/** One fixed Rapier body per point, created IMPERATIVELY (like the terrain heightfields and the
 *  building proxies): r-t-r's frame loop syncs every mounted <RigidBody> each frame and a fixed
 *  body never reads as sleeping. Same shapes and transforms as `<RigidBody rotation={[0, yaw,
 *  pitch]}>` + a `<CuboidCollider>` per part — the server builds the same (physics/obstacles.ts). */
export const DressingPartColliders = ({
  colliders,
  parts,
}: {
  colliders: DressingColliderPoint[];
  parts: DressingColliderPart[];
}): null => {
  const { world, rapier } = useRapier();
  const bodies = useRef(new Map<string, RapierRigidBody>()).current;
  const partsRef = useRef(parts);

  useEffect(() => {
    // The shared boxes changed: every body is rebuilt.
    if (partsRef.current !== parts) {
      partsRef.current = parts;
      bodies.forEach((body) => world.removeRigidBody(body));
      bodies.clear();
    }
    const wanted = new Set<string>();
    for (const c of colliders) wanted.add(c.key);
    bodies.forEach((body, key) => {
      if (wanted.has(key)) return;
      world.removeRigidBody(body);
      bodies.delete(key);
    });
    for (const c of colliders) {
      if (bodies.has(c.key)) continue;
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
      bodies.set(c.key, body);
    }
  }, [colliders, parts, world, rapier, bodies]);

  useEffect(
    () => () => {
      bodies.forEach((body) => world.removeRigidBody(body));
      bodies.clear();
    },
    [world, bodies],
  );

  return null;
};

/** Real colliders only within `colliderDistance` (thousands of Rapier shapes would cost more than the
 *  instancing saved). The registry sweep must run every interval even when the scan is skipped:
 *  forEachAlive is what prunes unmounted chunks and fires their onRemove. */
export const useDressingColliders = <T extends { points: DressingColliderBody[] }>(
  registry: { forEachAlive: (cb: (entry: T) => void) => void },
  options: { colliderDistance?: number; scanIntervalFrames?: number } = {},
): DressingColliderPoint[] => {
  const { colliderDistance = DRESSING_COLLIDER_DISTANCE, scanIntervalFrames = 10 } = options;
  const [colliders, setColliders] = useState<DressingColliderPoint[]>([]);
  const frameCount = useRef(0);
  const aliveScratch = useRef<T[]>([]);
  const lastScan = useRef({
    x: Infinity,
    z: Infinity,
    chunkCount: -1,
    pointCount: -1,
    colliderCount: -1,
    colliderHash: 0,
  });

  useFrame(({ camera }) => {
    if (frameCount.current++ % scanIntervalFrames !== 0) return;

    const alive = aliveScratch.current;
    alive.length = 0;
    let pointCount = 0;
    registry.forEachAlive((chunk) => {
      alive.push(chunk);
      pointCount += chunk.points.length;
    });

    const last = lastScan.current;
    const movedSq = (camera.position.x - last.x) ** 2 + (camera.position.z - last.z) ** 2;
    if (movedSq < 4 && alive.length === last.chunkCount && pointCount === last.pointCount) {
      alive.length = 0;
      return;
    }
    last.x = camera.position.x;
    last.z = camera.position.z;
    last.chunkCount = alive.length;
    last.pointCount = pointCount;

    const near: DressingColliderPoint[] = [];
    let hash = 0;
    const maxDistSq = colliderDistance * colliderDistance;
    for (const chunk of alive) {
      for (const p of chunk.points) {
        const dx = p.x - camera.position.x;
        const dz = p.z - camera.position.z;
        if (dx * dx + dz * dz < maxDistSq) {
          near.push({ key: `${p.x}_${p.z}`, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch ?? 0, parts: p.parts, mesh: p.mesh });
          hash += p.x * 31 + p.z * 17 + p.y;
        }
      }
    }
    alive.length = 0;
    // Positions are deterministic, so equal count + hash = the same set.
    if (near.length !== last.colliderCount || hash !== last.colliderHash) {
      last.colliderCount = near.length;
      last.colliderHash = hash;
      setColliders(near);
    }
  });

  return colliders;
};
