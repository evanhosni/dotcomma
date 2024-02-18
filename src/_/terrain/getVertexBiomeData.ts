import * as THREE from "three";
import { Biome } from "../../types/Biome";
import { VertexData, vertexData_default } from "../../types/VertexData";
import { _math } from "../math";

const pointsCache: Record<string, { point: THREE.Vector3; biome: Biome }[]> = {};
const gridSize = 2500; //more like 2500+
export const roadWidth = 30;
const blendWidth = 200;

export const getVertexBiomeData = (x: number, y: number, biomes: Biome[]) => {
  const currentGrid = [Math.floor(x / gridSize), Math.floor(y / gridSize)];
  var points: { point: THREE.Vector3; biome: Biome }[] = [];
  var vertexData: VertexData = { ...vertexData_default, x: x, y: y };

  var currentVertex = new THREE.Vector3(x, y, 0); //TODO make road curvy

  if (pointsCache[currentGrid.toString()]) {
    points = pointsCache[currentGrid.toString()];
  } else {
    for (let ix = currentGrid[0] - 2; ix <= currentGrid[0] + 2; ix++) {
      for (let iy = currentGrid[1] - 2; iy <= currentGrid[1] + 2; iy++) {
        var pointX = _math.seed_rand(ix + "X" + iy);
        var pointY = _math.seed_rand(ix + "Y" + iy);
        var point = new THREE.Vector3((ix + pointX) * gridSize, (iy + pointY) * gridSize, 0);
        var _biome = biomes[Math.floor(_math.seed_rand(JSON.stringify(point)) * biomes.length)];
        points.push({ point: point, biome: _biome });
      }
    }
    pointsCache[currentGrid.toString()] = points;

    for (const key in pointsCache) {
      const cachedGrid = key.split(",").map(Number);
      if (Math.abs(currentGrid[0] - cachedGrid[0]) > 5 || Math.abs(currentGrid[1] - cachedGrid[1]) > 5) {
        delete pointsCache[key];
      }
    }
  }

  points.sort((a, b) => currentVertex.distanceTo(a.point) - currentVertex.distanceTo(b.point));

  const biome = points[0].biome;
  vertexData.attributes.biome = biome;
  vertexData.attributes.biomeId = biomes.indexOf(biome);

  const newArray = [points[0]];
  for (let i = 1; i < points.length; i++) {
    if (points[i].biome !== vertexData.attributes.biome) {
      newArray.push(points[i]);
    }
  }

  const distance =
    newArray.length > 1
      ? currentVertex.distanceTo(newArray[1].point) - currentVertex.distanceTo(newArray[0].point)
      : 999; //TODO something other than 999?

  vertexData.attributes.blend = Math.min(blendWidth, Math.max(distance - roadWidth, 0)) / blendWidth;

  if (distance <= roadWidth) {
    vertexData.attributes.isRoad = true;
  } else {
    vertexData.attributes.isRoad = false;
  }

  vertexData.attributes.distanceToRoadCenter = distance;

  vertexData.height = getHeight(vertexData);

  return vertexData;
};

const getHeight = (vertexData: VertexData) => {
  if (vertexData.attributes.isRoad) return 0;

  let height =
    vertexData.attributes.biome.getVertexData(vertexData.x, vertexData.y).height * vertexData.attributes.blend;

  return height;
};
