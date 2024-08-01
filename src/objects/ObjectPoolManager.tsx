import { useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

interface ObjectPoolEntry {
  component: React.FC<any>;
  coordinates: THREE.Vector3Tuple;
  scale?: THREE.Vector3Tuple;
  rotation?: THREE.Vector3Tuple;
  active: boolean;
  id: string;
}

const objectPools: { [key: string]: ObjectPoolEntry[] } = {};

const getObjectPool = (componentType: string): ObjectPoolEntry[] => {
  if (!objectPools[componentType]) {
    objectPools[componentType] = [];
  }
  // console.log(`Pool size for ${componentType}: ${objectPools[componentType].length}`);
  return objectPools[componentType];
};

const getObjectFromPool = (componentType: string, component: React.FC<any>): ObjectPoolEntry | null => {
  const pool = getObjectPool(componentType);
  const inactiveObject = pool.find((entry) => !entry.active);

  if (inactiveObject) {
    inactiveObject.active = true;
    // console.log(`Reusing object from pool: ${componentType}`);
    return inactiveObject;
  }

  // if (pool.length < 50) {
  //TODO maybe increase to like 100? this is OBJECT_COUNT so make a const
  const newObject: ObjectPoolEntry = {
    component,
    coordinates: [0, 0, 0],
    active: true,
    id: `${componentType}_${pool.length}`,
  };
  pool.push(newObject);
  // console.log(`Adding new object to pool: ${componentType}. New size: ${pool.length}`);
  return newObject;
  // }

  // console.log(`Pool is full for ${componentType}. Cannot add new object.`);
  // return null;
};

export const spawnObject = ({
  component,
  coordinates,
  scale,
  rotation,
}: {
  component: React.FC<any>;
  coordinates: THREE.Vector3Tuple;
  scale?: THREE.Vector3Tuple;
  rotation?: THREE.Vector3Tuple;
}) => {
  const componentType = component.displayName || component.name;
  if (!componentType) {
    console.error("Component must have a displayName or name property.");
    return;
  }

  const poolEntry = getObjectFromPool(componentType, component);

  if (poolEntry) {
    poolEntry.coordinates = coordinates;
    poolEntry.scale = scale;
    poolEntry.rotation = rotation;
  }
};

export const ObjectPoolManager = () => {
  const [activeObjectIds, setActiveObjectIds] = useState<Set<string>>(new Set());
  const distanceThreshold = 1500;
  const { camera } = useThree();
  const sceneObjectsRef = useRef<Map<string, ObjectPoolEntry>>(new Map());

  useEffect(() => {
    const updateRenderedObjects = () => {
      const allObjects = Object.values(objectPools).flat();
      const newActiveObjectIds = new Set<string>();
      allObjects.forEach((entry) => {
        if (entry.active) {
          const objectPosition = new THREE.Vector3(...entry.coordinates);
          const distance = camera.position.distanceTo(objectPosition);
          if (distance > distanceThreshold) {
            entry.active = false; // Return to pool
            if (sceneObjectsRef.current.has(entry.id)) {
              sceneObjectsRef.current.delete(entry.id);
            }
          } else {
            newActiveObjectIds.add(entry.id);
          }
        }
      });
      setActiveObjectIds(newActiveObjectIds);
    };

    const interval = setInterval(updateRenderedObjects, 1000 / 60); // Update at 60 FPS
    return () => clearInterval(interval);
  }, [camera]);

  return (
    <>
      {Array.from(activeObjectIds).map((id) => {
        const entry = Object.values(objectPools)
          .flat()
          .find((e) => e.id === id);
        if (!entry) return null;

        // Update the reference to ensure it's only rendered once
        if (!sceneObjectsRef.current.has(id)) {
          sceneObjectsRef.current.set(id, entry);
        }

        const Component = entry.component;

        return <Component key={id} coordinates={entry.coordinates} scale={entry.scale} rotation={entry.rotation} />;
      })}
    </>
  );
};

//maybe dont need object pool. instead, use this logic to separate the spawning and move that into terrain
