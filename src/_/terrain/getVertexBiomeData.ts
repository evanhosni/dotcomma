import Delaunator from "delaunator";
import * as THREE from "three";
import { Biome } from "../../types/Biome";
import { VertexData, vertexData_default } from "../../types/VertexData";
import { _math } from "../math";

const pointsCache: Record<string, THREE.Vector3[]> = {};
const gridSize = 2500; //more like 2500+
export const roadWidth = 30;
const blendWidth = 200;

export const getVertexBiomeData = (x: number, y: number, biomes: Biome[]) => {
  const currentGrid = [Math.floor(x / gridSize), Math.floor(y / gridSize)];
  var points: THREE.Vector3[] = [];
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
        points.push(point);
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

  points.sort((a, b) => currentVertex.distanceTo(a) - currentVertex.distanceTo(b));

  const biome = biomes[Math.floor(_math.seed_rand(JSON.stringify(points[0])) * biomes.length)];
  vertexData.attributes.biome = biome;
  vertexData.attributes.biomeId = biomes.indexOf(biome); //TODO do this instead
  // console.log(biomes.indexOf(biome));
  // for (let i = 0; i < biomes.length; i++) {
  //   vertexData.attributes[`biome_${biomes[i].name}`] = false;
  // }
  // vertexData.attributes[`biome_${biome.name}`] = true;

  const delaunay = Delaunator.from(points.map((point) => [point.x, point.y]));

  const circumcenters: THREE.Vector3[] = [];
  for (let i = 0; i < delaunay.triangles.length; i += 3) {
    const a = points[delaunay.triangles[i]];
    const b = points[delaunay.triangles[i + 1]];
    const c = points[delaunay.triangles[i + 2]];

    const ad = a.x * a.x + a.y * a.y;
    const bd = b.x * b.x + b.y * b.y;
    const cd = c.x * c.x + c.y * c.y;
    const D = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    const circumcenter = new THREE.Vector3(
      (1 / D) * (ad * (b.y - c.y) + bd * (c.y - a.y) + cd * (a.y - b.y)),
      (1 / D) * (ad * (c.x - b.x) + bd * (a.x - c.x) + cd * (b.x - a.x)),
      0
    );

    circumcenters.push(circumcenter);
  }

  const voronoiWalls = [];
  for (let i = 0; i < delaunay.halfedges.length; i++) {
    const edge = delaunay.halfedges[i];

    if (edge !== -1) {
      // const v1 = circumcenters[Math.floor(i / 3)];
      // const v2 = circumcenters[Math.floor(edge / 3)];

      const v1Index = Math.floor(i / 3);
      const v2Index = Math.floor(edge / 3);

      const v1 = circumcenters[v1Index];
      const v2 = circumcenters[v2Index];

      //TODO the below commented section grabs relevant delaunay points for getting biome info, but slows shit down hella. might be useful later
      // const pointIndex1 = delaunay.triangles[3 * v1Index + (edge % 3)];
      // const pointIndex2 = delaunay.triangles[3 * v2Index + ((edge + 1) % 3)];

      // const point1 = points[pointIndex1];
      // const point2 = points[pointIndex2];

      // if (
      //   biomes[Math.floor(_math.seed_rand(JSON.stringify(point1)) * biomes.length)] !==
      //   biomes[Math.floor(_math.seed_rand(JSON.stringify(point2)) * biomes.length)]
      // )
      voronoiWalls.push(new THREE.Line3(v1, v2));
    }
  }

  var closestPoints = [];
  for (let i = 0; i < voronoiWalls.length; i++) {
    var closestPoint = new THREE.Vector3(0, 0, 0);
    voronoiWalls[i].closestPointToPoint(currentVertex, true, closestPoint);
    closestPoints.push(closestPoint);
  }
  closestPoints.sort((a, b) => a.distanceTo(currentVertex) - b.distanceTo(currentVertex));

  const distance = currentVertex.distanceTo(closestPoints[0]);

  vertexData.attributes.blend = Math.min(blendWidth, Math.max(distance - roadWidth, 0)) / blendWidth; //TODO this still sets road height between two of the same biome

  if (
    distance <= roadWidth
    // && biomes[Math.floor(_math.seed_rand(JSON.stringify(points[0])) * biomes.length)] !==
    //   biomes[Math.floor(_math.seed_rand(JSON.stringify(points[1])) * biomes.length)]
  ) {
    vertexData.attributes.isRoad = true;
  } else {
    vertexData.attributes.isRoad = false;
  }

  vertexData.attributes.distanceToRoadCenter = distance;

  vertexData.height = getHeight(vertexData);

  return vertexData; //.attributes.biome.getVertexData(x, y);
};

const getHeight = (vertexData: VertexData) => {
  if (vertexData.attributes.isRoad) return 0;

  let height =
    vertexData.attributes.biome.getVertexData(vertexData.x, vertexData.y).height * vertexData.attributes.blend;

  return height;
};
