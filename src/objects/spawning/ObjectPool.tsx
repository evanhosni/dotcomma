import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGameContext } from "../../context/GameContext";
import { buildWorldConfig } from "../../workers/buildWorldConfig";
import { WORLD_REGIONS } from "../../world/world";
import { collectDescriptors } from "./collectDescriptors";
import {
  cleanupSpawnCache,
  generateSpawnPoints,
  getNearbyChunkKeys,
  initSpawnWorker,
  serializeDescriptors,
  updateSpawnFootprint,
} from "./generateSpawnPoints";
import { SpawnDescriptor, SpawnedObjectProps } from "./types";

const MAX_ACTIVE_OBJECTS = 200;
const MIN_FRAMES_BETWEEN_BATCHES = 5; // ~83ms at 60fps — responsive to player movement

export const ObjectPool = () => {
  const [stableComponents, setStableComponents] = useState<React.ReactNode[]>([]);

  const objectsMapRef = useRef(new Map<string, React.ReactNode>());
  const destroyedObjectsRef = useRef(new Set<string>());
  const isGeneratingRef = useRef(false);
  const frameCountRef = useRef(0);
  const lastBatchFrameRef = useRef(0);
  const workerReadyRef = useRef(false);

  const { camera } = useThree();
  const { terrain_loaded, progress, terrainHighLODPending, spawnPending } = useGameContext();

  // Collect all spawn descriptors from this dimension
  const descriptors = useMemo(() => collectDescriptors(WORLD_REGIONS), []);

  // Build descriptor lookup map
  const descriptorMap = useMemo(() => {
    const map = new Map<string, SpawnDescriptor>();
    for (const d of descriptors) map.set(d.id, d);
    return map;
  }, [descriptors]);

  // Serialized descriptors for worker communication (no React components)
  const serializedDescriptors = useMemo(
    () => serializeDescriptors(descriptors),
    [descriptors]
  );

  // Max render distance across all descriptors
  const maxRenderDistance = useMemo(
    () => Math.max(...descriptors.map((d) => d.renderDistance), 500),
    [descriptors]
  );

  // Max footprint for spatial hash cell sizing
  const maxFootprint = useMemo(
    () => Math.max(...descriptors.map((d) => d.footprint), 10),
    [descriptors]
  );

  // Initialize spawn worker
  useEffect(() => {
    const config = buildWorldConfig(WORLD_REGIONS);
    initSpawnWorker(config, maxFootprint).then(() => {
      workerReadyRef.current = true;
    });
  }, [maxFootprint]);

  // Update spatial hash when footprint changes
  useEffect(() => {
    if (workerReadyRef.current) {
      updateSpawnFootprint(maxFootprint);
    }
  }, [maxFootprint]);

  // Preload all GLTF models referenced by descriptors
  useEffect(() => {
    for (const desc of descriptors) {
      if (desc.model) {
        useGLTF.preload(desc.model);
      }
    }
  }, [descriptors]);

  // Clean up destroyed objects that have moved back out of range
  const cleanupDestroyedObjects = useCallback(() => {
    destroyedObjectsRef.current.forEach((id) => {
      const parts = id.split("_");
      if (parts.length < 3) return;
      const x = Number(parts[0]);
      const z = Number(parts[1]);
      const descId = parts.slice(2).join("_");
      const desc = descriptorMap.get(descId);
      if (!desc) return;

      const dx = camera.position.x - x;
      const dz = camera.position.z - z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist > desc.renderDistance / 2) {
        destroyedObjectsRef.current.delete(id);
      }
    });
  }, [camera, descriptorMap]);

  const generateSpawners = useCallback(async () => {
    if (isGeneratingRef.current) return;
    if (!workerReadyRef.current) return;
    if (descriptors.length === 0) return;

    isGeneratingRef.current = true;
    spawnPending.current = true;

    try {
      cleanupDestroyedObjects();
      cleanupSpawnCache(camera.position.x, camera.position.z, maxRenderDistance * 2);

      const chunkKeys = getNearbyChunkKeys(
        camera.position.x,
        camera.position.z,
        maxRenderDistance
      );

      // Send all chunk keys to the worker in one message
      const points = await generateSpawnPoints(chunkKeys, serializedDescriptors);

      const newObjectIds = new Set<string>();
      let hasChanges = false;

      for (const point of points) {
        const desc = descriptorMap.get(point.descriptorId);
        if (!desc) continue;

        // Distance check per descriptor's render distance
        const dx = point.x - camera.position.x;
        const dz = point.z - camera.position.z;
        const distSq = dx * dx + dz * dz;
        if (distSq > desc.renderDistance * desc.renderDistance) continue;

        const objId = `${point.x}_${point.z}_${point.descriptorId}`;

        if (destroyedObjectsRef.current.has(objId)) continue;

        newObjectIds.add(objId);

        if (objectsMapRef.current.has(objId)) continue;

        // Create component
        const Component = desc.component;
        const props: SpawnedObjectProps = {
          id: objId,
          coordinates: [point.x, point.height, point.z],
          renderDistance: desc.renderDistance,
          frustumPadding: desc.frustumPadding ?? 3,
          onDestroy: (id: string) => {
            destroyedObjectsRef.current.add(objId);
            objectsMapRef.current.delete(objId);
            hasChanges = true;
          },
        };

        objectsMapRef.current.set(
          objId,
          <Component key={objId} {...props} />
        );
        hasChanges = true;
      }

      // Remove objects no longer in range
      objectsMapRef.current.forEach((_component, id) => {
        if (!newObjectIds.has(id)) {
          objectsMapRef.current.delete(id);
          hasChanges = true;
        }
      });

      // Cap to MAX_ACTIVE_OBJECTS — keep closest
      if (objectsMapRef.current.size > MAX_ACTIVE_OBJECTS) {
        const entries = Array.from(objectsMapRef.current.entries());
        entries.sort((a, b) => {
          const parseCoords = (key: string) => {
            const parts = key.split("_");
            return { x: Number(parts[0]), z: Number(parts[1]) };
          };
          const ca = parseCoords(a[0]);
          const cb = parseCoords(b[0]);
          const distA = (ca.x - camera.position.x) ** 2 + (ca.z - camera.position.z) ** 2;
          const distB = (cb.x - camera.position.x) ** 2 + (cb.z - camera.position.z) ** 2;
          return distA - distB;
        });

        const toRemove = entries.slice(MAX_ACTIVE_OBJECTS);
        for (const [id] of toRemove) {
          objectsMapRef.current.delete(id);
          hasChanges = true;
        }
      }

      if (hasChanges) {
        setStableComponents(Array.from(objectsMapRef.current.values()));
      }
    } catch (error) {
      console.error("Error in spawn generation:", error);
    } finally {
      isGeneratingRef.current = false;
      spawnPending.current = false;
    }
  }, [
    camera,
    descriptors,
    serializedDescriptors,
    descriptorMap,
    maxRenderDistance,
    cleanupDestroyedObjects,
    spawnPending,
  ]);

  useFrame(() => {
    frameCountRef.current++;

    // Gate 1: Don't spawn until initial terrain is loaded
    if (!terrain_loaded && progress < 0.5) return;

    // Gate 2: Minimum frames between spawn batches
    if (frameCountRef.current - lastBatchFrameRef.current < MIN_FRAMES_BETWEEN_BATCHES) return;

    // Gate 3: Only defer to HIGH-RES terrain (LOD1/2), not all terrain.
    // Low-LOD terrain (LOD3-5) defers to US via spawnPending.
    if (terrainHighLODPending.current) return;

    // Gate 4: Worker must be initialized
    if (!workerReadyRef.current) return;

    lastBatchFrameRef.current = frameCountRef.current;
    generateSpawners();
  });

  return <>{stableComponents}</>;
};
