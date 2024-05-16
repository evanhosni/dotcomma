import * as THREE from "three";
import { ScatterGrid, _scatter } from "../../_/_scatter";
import { Dimension } from "../../types/Dimension";

export const getSpawners = (dimension: Dimension, x: number, y: number): ScatterGrid[] => {
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
  });

  // console.log(points);

  return points;
};
