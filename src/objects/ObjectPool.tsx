import { useThree } from "@react-three/fiber";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { EMPTY_FUNCTION } from "../utils/constants";
import { utils } from "../utils/utils";
import { Dimension } from "../world/types";
import { getSpawnPoints } from "./getSpawnPoints";
import { GameObjectProps } from "./types";

const createObjectEntry = async (
  element: React.FC<any>,
  point: THREE.Vector3,
  dimension: Dimension
): Promise<GameObjectProps | null> => {
  const id = `${point.x}_${point.z}`;
  try {
    const vertexData = await dimension.getVertexData(point.x, point.z);
    return {
      component: element,
      coordinates: [point.x, vertexData.height, point.z],
      scale: [1, 1, 1],
      rotation: [0, 0, 0],
      onDestroy: EMPTY_FUNCTION,
      id,
    };
  } catch (error) {
    console.error(`Error getting vertex data for point ${id}:`, error);
    return null;
  }
};

export const OBJECT_RENDER_DISTANCE = 500;

export const ObjectPool = ({ dimension }: { dimension: Dimension }) => {
  // Split tracking between stable objects and new/removed objects
  const [stableComponents, setStableComponents] = useState<React.ReactNode[]>([]);
  const [dynamicObjectIds, setDynamicObjectIds] = useState<Set<string>>(new Set());

  // Cache of all instantiated components for lookup
  const objectsMapRef = useRef(new Map<string, GameObjectProps>());
  // Cache of rendered components to maintain stability
  const componentsMapRef = useRef(new Map<string, React.ReactNode>());

  const isGeneratingRef = useRef(false);
  const lastPositionRef = useRef(new THREE.Vector3());
  const { camera } = useThree();

  // Track destroyed objects that shouldn't respawn while in range
  const destroyedObjectsRef = useRef(new Set<string>());

  // Check if camera has moved significantly
  const hasCameraMoved = useCallback(() => {
    const minMovementThreshold = 1; // Distance in world units
    const dist = lastPositionRef.current.distanceToSquared(camera.position);
    if (dist > minMovementThreshold * minMovementThreshold) {
      lastPositionRef.current.copy(camera.position);
      return true;
    }
    return false;
  }, [camera.position]);

  // This function only cleans up entries from destroyedObjectsRef that are out of range
  const cleanupDestroyedObjects = useCallback(() => {
    let hasChanges = false;

    // Clean up destroyed objects that are now out of range
    destroyedObjectsRef.current.forEach((id) => {
      const [x, z] = id.split("_").map(Number);
      const distance = utils.getDistance2D(camera.position, new THREE.Vector3(x, 0, z));

      if (distance > OBJECT_RENDER_DISTANCE / 2) {
        destroyedObjectsRef.current.delete(id);
        hasChanges = true;
      }
    });

    return hasChanges;
  }, [camera.position]);

  // Generate and manage spawners
  const generateSpawners = useCallback(async () => {
    if (isGeneratingRef.current || !hasCameraMoved()) return;

    isGeneratingRef.current = true;

    try {
      cleanupDestroyedObjects();

      // Get new potential spawners
      const spawners = await getSpawnPoints(dimension, camera.position.x, camera.position.z);

      // Track new IDs to be rendered
      const newIds = new Set<string>();
      const objectsToAdd: Array<{ id: string; element: React.FC<any>; point: THREE.Vector3 }> = [];

      // First pass - identify which spawners are truly new
      for (const { element, point } of spawners) {
        const id = `${point.x}_${point.z}`;

        // Skip destroyed objects
        if (destroyedObjectsRef.current.has(id)) continue;

        newIds.add(id);

        // Skip if we already have this object
        if (objectsMapRef.current.has(id) || componentsMapRef.current.has(id)) continue;

        // This is a new object we need to create
        objectsToAdd.push({ id, element, point });
      }

      // Create new objects in batches
      if (objectsToAdd.length > 0) {
        const batchSize = 10;
        for (let i = 0; i < objectsToAdd.length; i += batchSize) {
          const batch = objectsToAdd.slice(i, i + batchSize);

          await Promise.all(
            batch.map(async ({ id, element, point }) => {
              const objProps = await createObjectEntry(element, point, dimension);
              if (!objProps) return;

              // Create enhanced props with onDestroy
              const enhancedProps = {
                ...objProps,
                onDestroy: () => {
                  destroyedObjectsRef.current.add(id);
                  componentsMapRef.current.delete(id);
                  objectsMapRef.current.delete(id);

                  // Remove from dynamic IDs if present
                  setDynamicObjectIds((prev) => {
                    const newSet = new Set(prev);
                    newSet.delete(id);
                    return newSet;
                  });
                },
              };

              // Store object data
              objectsMapRef.current.set(id, enhancedProps);

              // Create actual component instance
              const { component: Component, ...props } = enhancedProps;
              componentsMapRef.current.set(id, <Component key={id} {...props} />);

              // Add to dynamic IDs for render
              setDynamicObjectIds((prev) => {
                const newSet = new Set(prev);
                newSet.add(id);
                return newSet;
              });
            })
          );
        }
      }

      // Find objects to remove (they exist in our maps but aren't in newIds)
      const idsToRemove: string[] = [];
      componentsMapRef.current.forEach((_, id) => {
        if (!newIds.has(id) && !destroyedObjectsRef.current.has(id)) {
          idsToRemove.push(id);
        }
      });

      // Process removals if needed
      if (idsToRemove.length > 0) {
        // Remove objects cleanly
        idsToRemove.forEach((id) => {
          const obj = objectsMapRef.current.get(id);
          if (obj && typeof obj.onDestroy === "function") {
            // Call existing onDestroy to clean up properly
            obj.onDestroy(id);
          } else {
            // Fall back to manual cleanup if onDestroy isn't available
            destroyedObjectsRef.current.add(id);
            componentsMapRef.current.delete(id);
            objectsMapRef.current.delete(id);
          }
        });

        // Update dynamic IDs by removing these IDs
        setDynamicObjectIds((prev) => {
          const newSet = new Set(prev);
          idsToRemove.forEach((id) => newSet.delete(id));
          return newSet;
        });
      }

      // Stabilize components after a complete update cycle
      if (objectsToAdd.length > 0 || idsToRemove.length > 0) {
        // Schedule a stabilization in the next tick
        setTimeout(() => {
          const stableArray = Array.from(componentsMapRef.current.values());
          setStableComponents(stableArray);
          setDynamicObjectIds(new Set()); // Clear dynamic objects as they're now stable
        }, 100);
      }
    } catch (error) {
      console.error("Error in generateSpawners:", error);
    } finally {
      isGeneratingRef.current = false;
    }
  }, [camera.position.x, camera.position.z, dimension, cleanupDestroyedObjects, hasCameraMoved]);

  // Initialize and set up interval
  useEffect(() => {
    // Initialize position tracking
    lastPositionRef.current.copy(camera.position);

    const intervalId = setInterval(generateSpawners, 250); // Reduced frequency
    return () => clearInterval(intervalId);
  }, [generateSpawners]);

  // Render dynamic objects separate from stable ones
  const dynamicObjects = useMemo(() => {
    return Array.from(dynamicObjectIds)
      .map((id) => componentsMapRef.current.get(id))
      .filter(Boolean);
  }, [dynamicObjectIds]);

  // Combine stable and dynamic objects
  return (
    <>
      {stableComponents}
      {dynamicObjects}
    </>
  );
};
