import * as THREE from "three";
import { Dimension } from "../../types/Dimension";
import { Spawner } from "../../types/Spawner";
import { VertexData } from "../../types/VertexData";
import { Apartment } from "./blocks/apartment/Apartment";

export const getSpawners = (dimension: Dimension) => {
  const spawners: Spawner[] = [];
  const points: THREE.Vector3[] = [];

  points.push(
    new THREE.Vector3(200, 0, -350),
    new THREE.Vector3(-450, 0, 220),
    new THREE.Vector3(320, 0, 180),
    new THREE.Vector3(-150, 0, 90),
    new THREE.Vector3(300, 0, -400),
    new THREE.Vector3(-400, 0, -300),
    new THREE.Vector3(450, 0, 100),
    new THREE.Vector3(-250, 0, -120),
    new THREE.Vector3(50, 0, 380),
    new THREE.Vector3(-100, 0, 500),
    new THREE.Vector3(480, 0, -250),
    new THREE.Vector3(-230, 0, 360),
    new THREE.Vector3(200, 0, -10),
    new THREE.Vector3(-360, 0, 30),
    new THREE.Vector3(420, 0, 450)
  );

  points.forEach((point) => {
    spawners.push(SpawnManager(dimension.getVertexData(point.x, point.z, dimension.regions)));
  });

  return spawners;
};

const SpawnManager = (vertexData: VertexData) => {
  // if (vertexData.attributes.biome !== City) return; //TODO note: this prevents unnecessary calculation

  return { component: Apartment, coordinates: [vertexData.x, vertexData.height, vertexData.y] };
};
