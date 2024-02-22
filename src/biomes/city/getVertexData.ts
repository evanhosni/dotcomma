import * as THREE from "three";
import { VertexData, vertexData_default } from "../../types/VertexData";

const cityGridSize = 100;
const roadWidth = 10;

export const getVertexData = (biomeData: VertexData) => {
  const { x, y } = biomeData;
  var vertexData: VertexData = { ...vertexData_default, x: x, y: y };

  var currentVertex = new THREE.Vector3(x, y, 0);

  //TODO maybe just find a better way to accomplish this
  const absX = Math.abs(currentVertex.x);
  const absY = Math.abs(currentVertex.y);

  const distanceToStreetX = Math.min(absX % cityGridSize, cityGridSize - (absX % cityGridSize));
  const distanceToStreetY = Math.min(absY % cityGridSize, cityGridSize - (absY % cityGridSize));

  const distanceToStreet = Math.min(distanceToStreetX, distanceToStreetY);
  //TODO to solve rounding error for city block material, you will need to recalculate distanceToStreet within the shader :/ OR, you can make the road lower than the blocks and adjust shader according to fragment's height value

  vertexData.attributes.distanceToRoadCenter = Math.min(biomeData.attributes.distanceToRoadCenter, distanceToStreet);

  vertexData.height = getHeight(vertexData);

  return vertexData;
};

const getHeight = (vertexData: VertexData) => {
  let height = 0;

  if (vertexData.attributes.distanceToRoadCenter > roadWidth) {
    height = 1;
  }

  return height;
};
