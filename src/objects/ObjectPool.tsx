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
  // Use a Map for better object tracking
  const objectsMapRef = useRef(new Map<string, GameObjectProps>());

  // Track active object IDs only (minimizes state updates)
  const [activeObjectIds, setActiveObjectIds] = useState<Set<string>>(new Set());

  const isGeneratingRef = useRef(false);
  const { camera } = useThree();

  // Track destroyed objects that shouldn't respawn while in range
  const destroyedObjectsRef = useRef(new Set<string>());

  // This function now only cleans up entries from destroyedObjectsRef that are out of range,
  // but NEVER removes objects from objectsMapRef
  const cleanupDestroyedObjects = useCallback(() => {
    let hasChanges = false;

    // Clean up destroyed objects that are now out of range
    destroyedObjectsRef.current.forEach((id) => {
      const [x, z] = id.split("_").map(Number);
      const distance = utils.getDistance2D(camera.position, new THREE.Vector3(x, 0, z));

      if (distance > OBJECT_RENDER_DISTANCE / 2) {
        destroyedObjectsRef.current.delete(id);
        hasChanges = true;
        return;
      }
    });

    return hasChanges;
  }, [camera.position]);

  // Optimized object generation with Map-based tracking
  const generateSpawners = useCallback(async () => {
    if (isGeneratingRef.current) return;

    isGeneratingRef.current = true;

    try {
      // Only clean up the destroyedObjectsRef, not the actual objects
      cleanupDestroyedObjects();

      // Get new potential spawners
      const spawners = await getSpawnPoints(dimension, camera.position.x, camera.position.z);

      // Track current active objects to update state only once
      const currentActiveIds = new Set<string>(activeObjectIds);

      // Process spawners in batches for better performance
      const batchSize = 20;
      for (let i = 0; i < spawners.length; i += batchSize) {
        const batch = spawners.slice(i, i + batchSize);

        // Process each batch in parallel
        await Promise.all(
          batch.map(async ({ element, point }) => {
            const id = `${point.x}_${point.z}`;

            // if (!element) return//TODO if nullable, we can escape early

            // Skip destroyed objects
            if (destroyedObjectsRef.current.has(id)) return;

            // Skip if already in the object map
            if (objectsMapRef.current.has(id)) {
              currentActiveIds.add(id);
              return;
            }

            // Create new object
            const objProps = await createObjectEntry(element, point, dimension);
            if (objProps) {
              // Create custom onDestroy function for each object
              const enhancedProps = {
                ...objProps,
                onDestroy: () => {
                  // This is the ONLY place where objects are removed from objectsMapRef
                  // It's called from the GameObject component when the object is too far from the player
                  destroyedObjectsRef.current.add(id);
                  objectsMapRef.current.delete(id);
                  setActiveObjectIds((prev) => {
                    const newSet = new Set(prev);
                    newSet.delete(id);
                    return newSet;
                  });
                },
              };

              // Add to map and mark as active
              objectsMapRef.current.set(id, enhancedProps);
              currentActiveIds.add(id);
            }
          })
        );
      }

      // Update active objects state once at the end
      setActiveObjectIds(currentActiveIds);
    } catch (error) {
      console.error("Error in generateSpawners:", error);
    } finally {
      isGeneratingRef.current = false;
    }
  }, [camera.position.x, camera.position.z, dimension, cleanupDestroyedObjects, activeObjectIds]);

  // Run generator on interval, but only if we've moved to a new grid cell
  useEffect(() => {
    const intervalId = setInterval(generateSpawners, 100);
    return () => clearInterval(intervalId);
  }, [generateSpawners]);

  // Memoize rendered objects to prevent unnecessary re-renders
  const renderedObjects = useMemo(() => {
    return Array.from(activeObjectIds)
      .map((id) => {
        const obj = objectsMapRef.current.get(id);
        if (!obj) return null;

        const { component: Component, ...props } = obj;
        return <Component key={id} {...props} />;
      })
      .filter(Boolean);
  }, [activeObjectIds]);

  return <>{renderedObjects}</>;
};
