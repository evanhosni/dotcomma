import * as THREE from "three";
import { _scatter } from "../../_/_scatter";
import { Spawner } from "../../types/Spawner";
import { GlitchCity } from "../glitch-city/GlitchCity";
import { City } from "./City";
import { gridSize, roadWidth } from "./getVertexData";

export const getSpawners = async (x: number, y: number): Promise<Spawner[]> => {
  const points = _scatter.create({
    seed: "city",
    currentVertex: new THREE.Vector2(x, y),
    gridSize: 100,
    density: 0,
    uniformity: 0,
    shift: {
      x: 0,
      z: 0,
    },
    filter: async (point: THREE.Vector3) => {
      const { attributes } = await GlitchCity.getVertexData(point.x, point.z);

      if (attributes.biome !== City) return null;
      if (!attributes.block) return null;
      if (attributes.distanceToRoadCenter < (gridSize - roadWidth) / 2) return null;

      const component = attributes.block.components[Math.floor(attributes.block.components.length * Math.random())];
      if (!component) return null;

      return component;
    },
  });

  return points;
};
