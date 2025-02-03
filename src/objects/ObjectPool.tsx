import { useThree } from "@react-three/fiber";
import React, { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { EMPTY_FUNCTION } from "../utils/constants";
import { OBJECT_RENDER_DISTANCE } from "../utils/scatter/_scatter";
import { Dimension } from "../world/types";
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

export const ObjectPool = ({ dimension }: { dimension: Dimension }) => {
  const [objects, setObjects] = useState<GameObjectProps[]>([]);
  const isGeneratingRef = useRef(false);
  const { camera } = useThree();

  // Track destroyed objects that shouldn't respawn while in range
  const destroyedObjectsRef = useRef(new Set<string>());

  const onDestroy = useCallback((id: string) => {
    setObjects((prevObjects) => prevObjects.filter((obj) => obj.id !== id));

    // When destroying an object, add its ID to the Set
    destroyedObjectsRef.current.add(id);
  }, []);

  const generateSpawners = useCallback(async () => {
    if (isGeneratingRef.current) return;
    isGeneratingRef.current = true;

    try {
      const points = await dimension.getSpawners(camera.position.x, camera.position.z);

      // For each destroyed object, check if player is out of range
      destroyedObjectsRef.current.forEach((id) => {
        // Parse the coordinates from the ID (since it's in format "x_z")
        const [x, z] = id.split("_").map(Number);
        const distance = Math.sqrt(Math.pow(camera.position.x - x, 2) + Math.pow(camera.position.z - z, 2));

        // If player is far enough away, remove from destroyed set
        if (distance > OBJECT_RENDER_DISTANCE) {
          // Use whatever distance threshold makes sense
          destroyedObjectsRef.current.delete(id);
        }
      });

      // Process all points in parallel
      const newObjectPromises = points.map(({ element, point }) => createObjectEntry(element, point, dimension));
      const newObjects = (await Promise.all(newObjectPromises)).filter((obj): obj is GameObjectProps => obj !== null);

      if (newObjects.length > 0) {
        setObjects((prevObjects) => {
          const uniqueNewObjects = newObjects.filter(
            (newObj) =>
              // Don't spawn if it's in the destroyed set
              !destroyedObjectsRef.current.has(newObj.id) &&
              // Don't spawn if it already exists
              !prevObjects.some((existingObj) => existingObj.id === newObj.id)
          );
          return [...prevObjects, ...uniqueNewObjects];
        });
      }
    } catch (error) {
      console.error("Error in generateSpawners:", error);
    } finally {
      isGeneratingRef.current = false;
    }
  }, [camera.position.x, camera.position.z, dimension]);

  useEffect(() => {
    const intervalId = setInterval(generateSpawners, 100);
    return () => clearInterval(intervalId);
  }, [generateSpawners]);

  return (
    <>
      {objects.map(({ component: Component, ...props }) => (
        <Component key={props.id} {...props} onDestroy={() => onDestroy(props.id)} />
      ))}
    </>
  );
};
