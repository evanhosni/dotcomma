import Delaunator from "delaunator";
import * as THREE from "three";
import { Biome } from "../../types/Biome";
import { VertexData, vertexData_default } from "../../types/VertexData";
import { _math } from "../math";
import { TerrainNoiseParams, _noise } from "../noise";

const pointsCache: Record<string, THREE.Vector3[]> = {};
const gridSize = 800; //TODO more like 2000
export const roadWidth = 10;
const blendWidth = 200; //TODO add noise to blendwidth and make biome dependent

const roadNoise: TerrainNoiseParams = {
  type: "perlin",
  octaves: 2,
  persistence: 1,
  lacunarity: 1,
  exponentiation: 1,
  height: 100,
  scale: 250,
};

export const getBiomeData = (x: number, y: number, biomes: Biome[]) => {
  //TODO name something other than biomedata
  const currentGrid = [Math.floor(x / gridSize), Math.floor(y / gridSize)];
  var points: THREE.Vector3[] = [];
  var biomeData: VertexData = { ...vertexData_default, x: x, y: y };

  var currentVertex = new THREE.Vector3(x + _noise.terrain(roadNoise, y, 0), y + _noise.terrain(roadNoise, x, 0), 0);

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
  biomeData.attributes.biome = biome;
  biomeData.attributes.biomeId = biomes.indexOf(biome);

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
      const v1 = circumcenters[Math.floor(i / 3)];
      const v2 = circumcenters[Math.floor(edge / 3)];

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
  biomeData.attributes.distanceToRoadCenter = distance;

  biomeData.attributes.blend = Math.min(blendWidth, Math.max(distance - roadWidth, 0)) / blendWidth;

  biomeData.height = getHeight(biomeData);

  return biomeData;
};

const baseNoise: TerrainNoiseParams = {
  type: "perlin",
  octaves: 3,
  persistence: 2,
  lacunarity: 2,
  exponentiation: 2,
  height: 500,
  scale: 5000,
};

const getHeight = (biomeData: VertexData) => {
  let height = 0;

  if (biomeData.attributes.distanceToRoadCenter > roadWidth)
    height = biomeData.attributes.biome.getVertexData(biomeData.x, biomeData.y).height * biomeData.attributes.blend; //TODO: pass all of vertexData into getVertexData

  return height + _noise.terrain(baseNoise, biomeData.x, biomeData.y);
};
