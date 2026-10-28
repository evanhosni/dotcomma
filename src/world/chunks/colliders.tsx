import { traceEvent } from "../../utils/spikeTrace";
import { useFrame } from "@react-three/fiber";
import { useRapier, type RapierRigidBody } from "@react-three/rapier";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { markFullSpeedSlope } from "../../physics/characterMovement";
import { reportContentError } from "../../utils/contentError";
import type { ColliderBody, ColliderMesh, ColliderPart } from "./types";

/**
 * A STREAMED CHUNK'S REAL COLLIDERS: the bodies of the chunks near the player, scanned from the
 * chunk registry and built as imperative Rapier bodies (the dressing's useSolidDressing and the
 * tunnels both wire them this way).
 */

/** A mounted collider body: a chunk's ColliderBody (types.ts) keyed for React. */
interface LiveColliderBody {
  /** The body's own key, or `${x}_${z}` (types.ts ColliderBody). */
  key: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  parts?: ColliderPart[];
  mesh?: ColliderMesh;
}

/** Thin street furniture only needs to be solid where the player can reach it. */
export const CHUNK_COLLIDER_DISTANCE = 90;

const _colliderEuler = new THREE.Euler();
const _colliderQuat = new THREE.Quaternion();

/** One fixed Rapier body per point, created IMPERATIVELY (like the terrain heightfields and the
 *  building proxies): r-t-r's frame loop syncs every mounted <RigidBody> each frame and a fixed
 *  body never reads as sleeping. Same shapes and transforms as `<RigidBody rotation={[0, yaw,
 *  pitch]}>` + a `<CuboidCollider>` per part — the server builds the same (physics/obstacles.ts). */
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

/** Whether two bodies listed under one key are the same body (a point two chunks both list). */
const sameBody = (a: ColliderBody, b: ColliderBody): boolean =>
  a.y === b.y && a.yaw === b.yaw && (a.pitch ?? 0) === (b.pitch ?? 0) && (a.parts?.length ?? -1) === (b.parts?.length ?? -1) && (a.mesh?.indices.length ?? -1) === (b.mesh?.indices.length ?? -1);

/** Real colliders only within `colliderDistance` (thousands of Rapier shapes would cost more than the
 *  instancing saved). The registry sweep must run every interval even when the scan is skipped:
 *  forEachAlive is what prunes unmounted chunks and fires their onRemove. */
export const useChunkColliders = <T extends { points: ColliderBody[] }>(
  registry: { forEachAlive: (cb: (entry: T) => void) => void },
  options: { colliderDistance?: number; scanIntervalFrames?: number } = {},
): LiveColliderBody[] => {
  const { colliderDistance = CHUNK_COLLIDER_DISTANCE, scanIntervalFrames = 10 } = options;
  const [colliders, setColliders] = useState<LiveColliderBody[]>([]);
  const frameCount = useRef(0);
  const aliveScratch = useRef<T[]>([]);
  const keyScratch = useRef(new Map<string, ColliderBody>());
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

    const near: LiveColliderBody[] = [];
    const byKey = keyScratch.current;
    byKey.clear();
    let hash = 0;
    const maxDistSq = colliderDistance * colliderDistance;
    for (const chunk of alive) {
      for (const p of chunk.points) {
        const dx = p.x - camera.position.x;
        const dz = p.z - camera.position.z;
        if (dx * dx + dz * dz < maxDistSq) {
          const key = p.key ?? `${p.x}_${p.z}`;
          // One body per key, and the bodies a key drops must be the SAME body (a point two chunks list):
          // a different one there would never be built — a missing collider, a fall through the world.
          const same = byKey.get(key);
          if (same) {
            if (!sameBody(same, p)) reportContentError(`[chunk colliders] two different bodies share the key "${key}": one would never be built. Give the feature's bodies unique \`key\`s (types.ts ColliderBody).`);
            continue;
          }
          byKey.set(key, p);
          near.push({ key, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch ?? 0, parts: p.parts, mesh: p.mesh });
          hash += p.x * 31 + p.z * 17 + p.y;
        }
      }
    }
    byKey.clear();
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
