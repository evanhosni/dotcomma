import * as THREE from "three";
import { _scatter } from "../../_/_scatter";
import { Spawner } from "../../types/Spawner";
import { GlitchCityDimension } from "../glitch-city/GlitchCity";
import { City } from "./City";
import { Apartment } from "./blocks/apartment/Apartment";
import { GRID_SIZE, ROAD_WIDTH } from "./getVertexData";

export const getSpawners = (x: number, y: number): Spawner[] => {
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
    filter: (point: THREE.Vector3) => {
      const vertexData = GlitchCityDimension.getVertexData(point.x, point.z);

      if (vertexData.attributes.biome !== City) return null;
      if (!vertexData.attributes.block) return null;
      if (vertexData.attributes.distanceToRoadCenter < (GRID_SIZE - ROAD_WIDTH) / 2) return null;
      if (vertexData.attributes.block.name === "apartments") return Apartment;
      return null;
    },
  });

  return points;
};
