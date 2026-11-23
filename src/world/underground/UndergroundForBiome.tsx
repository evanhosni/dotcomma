/**
 * `<Caves/>` and `<Sewers/>`: DRESSING members on the base's chunk lifecycle, assets and collider
 * gating. A chunk is built on the tunnel worker (its own thread) and drawn by undergroundMeshes.ts;
 * the registry (undergroundRegistry.ts) owns what the player and the terrain read. The sewers add
 * the interaction: a click on a door or a manhole cover under the screen's center toggles it.
 */
import { traceSpan } from "../../utils/spike-trace";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { claimHover, releaseHover } from "../../utils/cursor";
import type { HoverTarget } from "../../utils/cursor/types";
import { meshTemplate, warmPrograms } from "../../utils/render";
import { COVER_RADIUS } from "../../generation/underground/sewers/constants";
import type { TunnelStyle } from "../../generation/underground/types";
import { LOD1_MAX_DISTANCE } from "../terrain/lod/constants";
import { terrainMaterialReady } from "../terrain/material";
import { hoveredDoor, swingDoors } from "../../objects/doors";
import { aimFromCamera } from "../../player/utils";
import { useChunkAssets, useChunkRegistry, useWorldChunks, useChunkColliders } from "../chunks/hooks";
import type { ChunkViewProps, ColliderPart } from "../chunks/types";
import { ChunkColliders } from "../chunks/ChunkColliders";
import { applyCoverPose, buildChunkObject, chunkColliderBodies, COVER_SLIDE_SECONDS, createTunnelAssets, entranceMaterialOf, tunnelWarmTemplates } from "./geometry";
import type { CoverRuntime, TunnelChunkObject } from "./types";
import { driveUnderground, entranceFadeOf, isCellLoaded, registerChunk, unregisterChunk } from "./registry";
import { isOpen, onToggle, toggleOpen } from "./store";
import { buildUndergroundChunk } from "./worker";
import { tickSewage } from "./material";
import { COVER_REACH, COVER_SLACK, HOLE_REACH, HOLE_SLACK, DOOR_CANDIDATE_REACH, DOOR_REACH, PICK_INTERVAL_FRAMES } from "./constants";
import { CAVE_RENDER_DISTANCE, SEWER_RENDER_DISTANCE, DEFAULT_COLLIDER_DISTANCE } from "./defaults";

/** The tunnels' bodies are their own meshes: no shared parts. ONE array: a fresh one per render
 *  would read as "the parts changed" and rebuild every column body. */
const NO_COLLIDER_PARTS: ColliderPart[] = [];

interface Hover {
  kind: "door" | "manhole";
  id: string;
}

const _aim = new THREE.Ray();
const _plane = new THREE.Plane();
const _hit = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _point = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();

/** The manhole under the screen's center: from above its COVER's disc wherever it lies; from below the
 *  hole, and only through the shaft's foot when under the box ceiling. */
const pickManhole = (camera: THREE.Camera, chunks: Iterable<TunnelChunkObject>, hit: { distance: number }): CoverRuntime | null => {
  const ray = aimFromCamera(camera, _aim);
  const eye = ray.origin;
  const camY = eye.y;
  let best: CoverRuntime | null = null;
  let bestDistance = Infinity;
  for (const obj of chunks) {
    for (const cover of obj.covers) {
      const e = cover.entrance;
      const d = Math.hypot(e.x - eye.x, e.z - eye.z);
      if (camY >= e.y) {
        if (d > COVER_REACH) continue;
        cover.mesh.getWorldPosition(_point);
        _normal.set(0, 1, 0).applyQuaternion(cover.mesh.getWorldQuaternion(_quaternion));
        _plane.setFromNormalAndCoplanarPoint(_normal, _point);
        const hit = ray.intersectPlane(_plane, _hit);
        if (!hit || hit.distanceTo(_point) > COVER_RADIUS + COVER_SLACK) continue;
        const dist = hit.distanceTo(eye);
        if (dist < bestDistance && dist <= COVER_REACH) {
          bestDistance = dist;
          best = cover;
        }
      } else {
        if (d > HOLE_REACH) continue;
        _plane.set(new THREE.Vector3(0, 1, 0), -e.y);
        const hit = ray.intersectPlane(_plane, _hit);
        if (!hit || Math.hypot(hit.x - e.x, hit.z - e.z) > e.radius + HOLE_SLACK) continue;
        if (camY < cover.info.ceilingY) {
          _plane.set(new THREE.Vector3(0, 1, 0), -cover.info.ceilingY);
          const foot = ray.intersectPlane(_plane, _point);
          if (!foot || Math.hypot(foot.x - e.x, foot.z - e.z) > e.radius) continue;
        }
        const dist = hit.distanceTo(eye);
        if (dist < bestDistance && dist <= HOLE_REACH) {
          bestDistance = dist;
          best = cover;
        }
      }
    }
  }
  hit.distance = bestDistance;
  return best;
};

/** A cover's slide toward its target, by `delta` seconds; re-posed when it moved. */
const slideCover = (cover: CoverRuntime, chunkCenterX: number, chunkCenterZ: number, delta: number): void => {
  if (cover.progress === cover.target) return;
  const step = delta / COVER_SLIDE_SECONDS;
  cover.progress = Math.abs(cover.target - cover.progress) <= step ? cover.target : cover.progress + Math.sign(cover.target - cover.progress) * step;
  applyCoverPose(cover, chunkCenterX, chunkCenterZ);
};

/** A chunk's frame: the entrance fade (the greatest of the chunk's mouths'; a cave chunk with no mouth
 *  shows within the LOD1 ring), the doors' swing and the covers' slide. */
const driveChunk = (obj: TunnelChunkObject, style: TunnelStyle, camX: number, camZ: number, delta: number): void => {
  if (obj.mouthIds.length > 0) {
    let fade = 0;
    for (const id of obj.mouthIds) fade = Math.max(fade, entranceFadeOf(id));
    obj.fade = fade;
    const visible = fade > 0;
    if (obj.walls) obj.walls.visible = visible;
    if (obj.patch) obj.patch.visible = visible;
  } else if (style === "cave" && obj.walls) {
    obj.walls.visible = Math.hypot(obj.chunk.centerX - camX, obj.chunk.centerZ - camZ) < LOD1_MAX_DISTANCE;
  }
  for (const cap of obj.caps) cap.mesh.visible = !isCellLoaded(cap.neighbor);
  if (obj.doors.length > 0) {
    for (let i = 0; i < obj.doors.length; i++) obj.doorsOpen[i] = isOpen(obj.doors[i].id);
    swingDoors(obj.doorHinges, obj.doorsOpen, delta);
  }
  for (const cover of obj.covers) slideCover(cover, obj.chunk.centerX, obj.chunk.centerZ, delta);
};

interface UndergroundProps extends ChunkViewProps {
  tunnel: TunnelStyle;
  /** The one biome these tunnels run under: its cells hold the systems, so each biome gets its own
   *  chunk lifecycle (they never overlap) rather than one driver merging them. */
  biomeId: number;
}

export const UndergroundForBiome = ({ tunnel: style, biomeId, renderDistance, colliderDistance }: UndergroundProps) => {
  const scene = useThree((s) => s.scene);
  const resolvedRender = renderDistance ?? (style === "cave" ? CAVE_RENDER_DISTANCE : SEWER_RENDER_DISTANCE);
  const resolvedCollider = colliderDistance ?? DEFAULT_COLLIDER_DISTANCE;
  const assets = useChunkAssets(createTunnelAssets, tunnelWarmTemplates);
  const entranceMaterialRef = useRef<THREE.ShaderMaterial | null>(null);
  const hoverRef = useRef<Hover | null>(null);
  const frameRef = useRef(0);

  // The entrance patch draws with the terrain's ENTRANCE variant: linked at load with the terrain's
  // other programs, not when the first entrance streams in.
  useEffect(() => {
    if (style !== "cave") return;
    let cancelled = false;
    let cancelWarm = () => {};
    terrainMaterialReady().then(({ base }) => {
      if (cancelled) return;
      entranceMaterialRef.current = entranceMaterialOf(base);
      cancelWarm = warmPrograms(scene, [meshTemplate(entranceMaterialRef.current)]);
    });
    return () => {
      cancelled = true;
      cancelWarm();
    };
  }, [style, scene]);

  const registry = useChunkRegistry<TunnelChunkObject>((obj) => unregisterChunk(obj.chunk));

  const groupRef = useWorldChunks({
    renderDistance: resolvedRender,
    build: async (bounds) => {
      const chunk = await buildUndergroundChunk(bounds, style, biomeId);
      if (!chunk) return null;
      if (style === "cave" && !entranceMaterialRef.current) entranceMaterialRef.current = entranceMaterialOf((await terrainMaterialReady()).base);
      const obj = traceSpan("tunnel:object", () => buildChunkObject(chunk, assets, entranceMaterialRef.current));
      traceSpan("tunnel:register", () => registerChunk(chunk));
      registry.add(obj);
      return obj.group;
    },
  });

  const colliders = useChunkColliders(registry, { colliderDistance: resolvedCollider });

  // A toggle rebuilds the bodies of the chunks holding the door (the collider scan sees the count change)
  // and starts the cover's slide from wherever it is now.
  useEffect(
    () =>
      onToggle((id, open) => {
        registry.forEachAlive((obj) => {
          if (obj.doors.some((d) => d.id === id)) obj.points = chunkColliderBodies(obj);
          for (const cover of obj.covers) if (cover.id === id) cover.target = open ? 1 : 0;
        });
      }),
    [registry],
  );

  /** Claimed while a door or manhole is hovered (utils/cursor): its click toggles it. */
  const hoverTarget = useMemo<HoverTarget>(
    () => ({
      distance: Infinity,
      growsCursor: true,
      onMouse: (e) => {
        if (e.type === "click" && e.button === 0 && hoverRef.current) toggleOpen(hoverRef.current.id);
      },
    }),
    [],
  );
  useEffect(() => () => releaseHover(hoverTarget), [hoverTarget]);

  // Scratch for the frame loop (nothing is allocated per frame).
  const aliveRef = useRef<TunnelChunkObject[]>([]);
  const leavesRef = useRef<THREE.Mesh[]>([]);
  const idsRef = useRef<string[]>([]);

  /** The door leaf (within DOOR_REACH, among the doors within DOOR_CANDIDATE_REACH) or the manhole under
   *  the screen's center, or null. */
  const pickHover = (camera: THREE.Camera, alive: readonly TunnelChunkObject[]): Hover | null => {
    const leaves = leavesRef.current;
    const ids = idsRef.current;
    leaves.length = 0;
    ids.length = 0;
    const eye = aimFromCamera(camera, _aim).origin;
    for (const obj of alive) {
      for (const d of obj.doors) {
        if (Math.hypot(d.door.x - eye.x, d.door.z - eye.z) > DOOR_CANDIDATE_REACH) continue;
        leaves.push(d.leaf);
        ids.push(d.id);
      }
    }
    const door = hoveredDoor(camera, leaves, DOOR_REACH, hoverTarget);
    if (door >= 0) return { kind: "door", id: ids[door] };
    const cover = pickManhole(camera, alive, hoverTarget);
    return cover ? { kind: "manhole", id: cover.id } : null;
  };

  useFrame((state, delta) => {
    driveUnderground(state, delta);
    tickSewage(assets.sewage.material, state.clock.elapsedTime);
    const cam = state.camera.position;
    const alive = aliveRef.current;
    alive.length = 0;
    registry.forEachAlive((obj) => {
      alive.push(obj);
      driveChunk(obj, style, cam.x, cam.z, delta);
    });

    if (style !== "sewer" || frameRef.current++ % PICK_INTERVAL_FRAMES !== 0) return;
    const hover = pickHover(state.camera, alive);
    if ((hover?.id ?? null) !== (hoverRef.current?.id ?? null)) {
      if (hover) claimHover(hoverTarget);
      else releaseHover(hoverTarget);
      hoverRef.current = hover;
    }
  });

  return (
    <>
      <group ref={groupRef} />
      <ChunkColliders colliders={colliders} parts={NO_COLLIDER_PARTS} />
    </>
  );
};
