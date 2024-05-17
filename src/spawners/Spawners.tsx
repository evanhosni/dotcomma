import { useFrame, useThree } from "@react-three/fiber";
import React, { useCallback, useMemo, useState } from "react";
import { Apartment } from "../biomes/city/blocks/apartment/Apartment";
import { Dimension } from "../types/Dimension";
import { Spawner } from "../types/Spawner";

interface Spawners {
  group: Map<string, Spawner>;
}

export const Spawners = ({ dimension }: { dimension: Dimension }) => {
  const { camera } = useThree();
  const [spawners, setSpawners] = useState<Spawners>({ group: new Map() });
  const frameCountRef = React.useRef(0);

  const UpdateSpawners = useCallback(() => {
    const points = dimension.getSpawners(dimension, camera.position.x, camera.position.z);
    const currentKeys = new Set(points.map((point) => JSON.stringify(point)));

    setSpawners((prevSpawners) => {
      const newGroup = new Map(prevSpawners.group);

      // Add new spawners
      points.forEach((point) => {
        const key = JSON.stringify(point);
        if (!newGroup.has(key)) {
          newGroup.set(key, {
            key,
            component: Apartment,
            coordinates: [point.x, 0, point.z],
          });
        }
      });

      // Remove old spawners
      Array.from(newGroup.keys()).forEach((key) => {
        if (!currentKeys.has(key)) {
          newGroup.delete(key);
        }
      });

      return { group: newGroup };
    });
  }, [dimension, camera.position.x, camera.position.z]);

  useFrame(() => {
    frameCountRef.current += 1;
    if (frameCountRef.current >= 50) {
      //TODO this is for efficiency. might be better ways to do this
      UpdateSpawners();
      frameCountRef.current = 0;
    }
  });

  const spawnerComponents = useMemo(() => {
    return Array.from(spawners.group.values()).map((spawner: Spawner) => (
      <TerrainSpawner key={spawner.key} {...spawner} />
    ));
  }, [spawners.group]);

  return <>{spawnerComponents}</>;
};

export const TerrainSpawner: React.FC<Spawner> = React.memo(({ coordinates }: Spawner) => {
  return <Apartment coordinates={coordinates} />;
});
