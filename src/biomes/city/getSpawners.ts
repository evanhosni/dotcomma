import * as THREE from "three";
import { _scatter } from "../../_/_scatter";
import { Dimension } from "../../types/Dimension";
import { City } from "./City";
import { ROAD_WIDTH } from "./getVertexData";

export const getSpawners = (dimension: Dimension, x: number, y: number): THREE.Vector3[] => {
  const points = _scatter.create({
    seed: "city",
    currentVertex: new THREE.Vector3(x, y, 0), //TODO re-order. another y vs z thing
    gridSize: 100,
    density: 0,
    uniformity: 0,
    shift: {
      x: 0,
      z: 0,
    },
    filter: (point: THREE.Vector3) => {
      const vertexData = dimension.getVertexData(point.x, point.z, dimension.regions);

      if (vertexData.attributes.biome !== City) return false;
      if (!vertexData.attributes.block) return false;
      if (vertexData.attributes.block.name !== "apartments") return false;
      if (vertexData.attributes.distanceToRoadCenter < ROAD_WIDTH) return false;

      return true;
    },
  });

  // console.log(points);

  return points;
};
