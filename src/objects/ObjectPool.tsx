import { useFrame, useThree } from "@react-three/fiber";
import React, { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { EMPTY_FUNCTION } from "../utils/constants";
import { utils } from "../utils/utils";
import { Dimension, SPAWN_SIZE } from "../world/types";
import { SIZE_BASED_RENDER_DISTANCES, getSpawnPoints } from "./getSpawnPoints";
import { GameObjectProps } from "./types";

const createObjectEntry = async (
  element: React.FC<any>,
  point: THREE.Vector3,
  dimension: Dimension,
  spawn_size: SPAWN_SIZE // Add spawn_size parameter
): Promise<GameObjectProps | null> => {
  const id = `${point.x}_${point.z}`;
  try {
    const vertexData = await dimension.getVertexData(point.x, point.z); //TODO pass vertexData through spawner instead to half the amount of times we getVertexData

    // Get the appropriate render distance for this spawn size
    const renderDistance = SIZE_BASED_RENDER_DISTANCES[spawn_size];

    return {
      component: element,
      coordinates: [point.x, vertexData.height, point.z],
      scale: [1, 1, 1],
      rotation: [0, 0, 0],
      onDestroy: EMPTY_FUNCTION,
      id,
      render_distance: renderDistance, // Add the render_distance property
      spawn_size,
    };
  } catch (error) {
    console.error(`Error getting vertex data for point ${id}:`, error);
    return null;
  }
};

export const OBJECT_RENDER_DISTANCE = 500;

export const ObjectPool = ({ dimension }: { dimension: Dimension }) => {
  // Single state for stable components
  const [stableComponents, setStableComponents] = useState<React.ReactNode[]>([]);

  // Cache of all object data and component instances
  const objectsMapRef = useRef(new Map<string, GameObjectProps>());
  const componentsMapRef = useRef(new Map<string, React.ReactNode>());
  const destroyedObjectsRef = useRef(new Set<string>());

  // useEffect(() => {
  //   console.log("Objects Map size:", objectsMapRef.current.size);
  //   console.log("Components Map size:", componentsMapRef.current.size);
  //   console.log("Destroyed Objects Set size:", destroyedObjectsRef.current.size);
  // }, [objectsMapRef.current.size, componentsMapRef.current.size, destroyedObjectsRef.current.size]);

  const isGeneratingRef = useRef(false);
  // const lastPositionRef = useRef(new THREE.Vector3());
  const { camera } = useThree();

  // Clean up destroyed objects that are now out of range
  const cleanupDestroyedObjects = useCallback(() => {
    destroyedObjectsRef.current.forEach((id) => {
      const [x, z] = id.split("_").map(Number);
      const distance = utils.getDistance2D(camera.position, new THREE.Vector3(x, 0, z));

      if (distance > OBJECT_RENDER_DISTANCE / 2) {
        destroyedObjectsRef.current.delete(id);
      }
    });
  }, [camera.position]);

  // Generate and manage spawners
  const generateSpawners = useCallback(async () => {
    if (isGeneratingRef.current) return;

    isGeneratingRef.current = true;

    try {
      cleanupDestroyedObjects();

      // Get new potential spawners
      const spawners = await getSpawnPoints(dimension, camera.position.x, camera.position.z);

      // Track which objects should be in the scene
      const newObjectIds = new Set<string>();
      let hasChanges = false;

      // Process spawners
      for (const { element, point, spawn_size } of spawners) {
        const id = `${point.x}_${point.z}`;

        // Skip destroyed objects
        if (destroyedObjectsRef.current.has(id)) continue;

        newObjectIds.add(id);

        // Skip if we already have this object
        if (componentsMapRef.current.has(id)) continue;

        // Create new object - now passing the spawn_size parameter
        const objProps = await createObjectEntry(element, point, dimension, spawn_size);
        if (!objProps) continue;

        // Create enhanced props with onDestroy
        const enhancedProps = {
          ...objProps,
          onDestroy: () => {
            destroyedObjectsRef.current.add(id);
            componentsMapRef.current.delete(id);
            objectsMapRef.current.delete(id);
            hasChanges = true;
          },
        };

        // Store object data
        objectsMapRef.current.set(id, enhancedProps);

        // Create and store component instance
        const { component: Component, ...props } = enhancedProps;
        componentsMapRef.current.set(id, <Component key={id} {...props} />);

        hasChanges = true;
      }

      // Find objects to remove (they exist in our maps but aren't in newObjectIds)
      componentsMapRef.current.forEach((_, id) => {
        if (!newObjectIds.has(id) && !destroyedObjectsRef.current.has(id)) {
          // Call onDestroy to clean up properly
          const obj = objectsMapRef.current.get(id);
          if (obj && typeof obj.onDestroy === "function") {
            obj.onDestroy(id);
          } else {
            // Fall back to manual cleanup
            destroyedObjectsRef.current.add(id);
            componentsMapRef.current.delete(id);
            objectsMapRef.current.delete(id);
            hasChanges = true;
          }
        }
      });

      // Update stable components if there are changes
      if (hasChanges) {
        const updatedComponents = Array.from(componentsMapRef.current.values());
        setStableComponents(updatedComponents);
      }
    } catch (error) {
      console.error("Error in generateSpawners:", error);
    } finally {
      isGeneratingRef.current = false;
    }
  }, [camera.position.x, camera.position.z, dimension, cleanupDestroyedObjects]);

  // Initialize and set up interval
  useEffect(() => {
    setInterval(generateSpawners, 500);
  }, [generateSpawners]);

  useFrame(() => {
    //TODO not robust enough. If moving quickly (and easiest if far away from spawn) and player changes direction quickly and goes backwards, some objects directly under player may disappear and not come back
    cleanupDestroyedObjects();
  });

  // Simply render the stable components
  return <>{stableComponents}</>;
};
