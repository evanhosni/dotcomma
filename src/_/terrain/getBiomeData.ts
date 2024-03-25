import Delaunator from "delaunator";
import * as THREE from "three";
import { Biome } from "../../types/Biome";
import { VertexData, vertexData_default } from "../../types/VertexData";
import { _math } from "../math";
import { TerrainNoiseParams, _noise } from "../noise";

interface Grid {
  point: THREE.Vector3;
  biome: Biome;
}

const regionGridSize = 2500; //TODO implement regions
const regionGridCache: Record<string, Grid[]> = {};
const gridSize = 500;
const gridCache: Record<string, Grid[]> = {};
const joinableCache: Record<string, any> = {};
export const roadWidth = 12;
const defaultBlendWidth = 200; //TODO add noise to blendwidth and make biome dependent

const roadNoise: TerrainNoiseParams = {
  type: "perlin",
  octaves: 2,
  persistence: 1,
  lacunarity: 1,
  exponentiation: 1,
  height: 150, //100 seems safe
  scale: 250,
};

export const getBiomeData = (x: number, y: number, biomes: Biome[], preventLoop?: boolean) => {
  //TODO name something other than biomedata
  var biomeData: VertexData = { ...vertexData_default, x, y };
  var currentVertex = new THREE.Vector3(x + _noise.terrain(roadNoise, y, 0), y + _noise.terrain(roadNoise, x, 0), 0);

  const currentRegionGrid = [Math.floor(x / regionGridSize), Math.floor(y / regionGridSize)]; //TODO {x,y} rather than [0,1]
  var regionGrid: Grid[] = [];

  if (regionGridCache[currentRegionGrid.toString()]) {
    regionGrid = regionGridCache[currentRegionGrid.toString()];
  } else {
    for (let ix = currentRegionGrid[0] - 2; ix <= currentRegionGrid[0] + 2; ix++) {
      for (let iy = currentRegionGrid[1] - 2; iy <= currentRegionGrid[1] + 2; iy++) {
        let pointX = _math.seed_rand(ix + "X" + iy);
        let pointY = _math.seed_rand(ix + "Y" + iy);
        let point = new THREE.Vector3((ix + pointX) * regionGridSize, (iy + pointY) * regionGridSize, 0);
        let uuid = _math.seed_rand(JSON.stringify(point));
        let biome = biomes[Math.floor(uuid * biomes.length)];
        regionGrid.push({ point, biome });
      }
    }
    regionGridCache[currentRegionGrid.toString()] = regionGrid;

    for (const key in regionGridCache) {
      const cachedGrid = key.split(",").map(Number);
      if (Math.abs(currentRegionGrid[0] - cachedGrid[0]) > 5 || Math.abs(currentRegionGrid[1] - cachedGrid[1]) > 5) {
        delete regionGridCache[key];
      }
    }
  }

  const currentGrid = [Math.floor(x / gridSize), Math.floor(y / gridSize)]; //TODO {x,y} rather than [0,1]
  var grid: Grid[] = [];

  if (gridCache[currentGrid.toString()]) {
    grid = gridCache[currentGrid.toString()];
  } else {
    for (let ix = currentGrid[0] - 2; ix <= currentGrid[0] + 2; ix++) {
      for (let iy = currentGrid[1] - 2; iy <= currentGrid[1] + 2; iy++) {
        let pointX = _math.seed_rand(ix + "X" + iy);
        let pointY = _math.seed_rand(ix + "Y" + iy);
        let point = new THREE.Vector3((ix + pointX) * gridSize, (iy + pointY) * gridSize, 0);
        regionGrid.sort((a, b) => point.distanceTo(a.point) - point.distanceTo(b.point));
        // let uuid = _math.seed_rand(JSON.stringify(point));
        let biome = regionGrid[0].biome; //*/ biomes[Math.floor(uuid * biomes.length)];
        grid.push({ point, biome });
      }
    }
    gridCache[currentGrid.toString()] = grid;

    for (const key in gridCache) {
      const cachedGrid = key.split(",").map(Number);
      if (Math.abs(currentGrid[0] - cachedGrid[0]) > 20 || Math.abs(currentGrid[1] - cachedGrid[1]) > 20) {
        delete gridCache[key];
      }
    }
  }

  grid.sort((a, b) => currentVertex.distanceTo(a.point) - currentVertex.distanceTo(b.point));

  const biome = grid[0].biome;
  if (!preventLoop) biomeData.attributes.biome = biome;
  if (!preventLoop) biomeData.attributes.biomeId = biomes.indexOf(biome);

  const points = grid.map(({ point }) => point);

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

      const mid = new THREE.Vector3((v1.x + v2.x) / 2, (v1.y + v2.y) / 2, 0);
      const label = `${Math.floor(mid.x)},${Math.floor(mid.y)}`;

      if (joinableCache[label] === undefined) {
        var midClosestPoints = grid.sort((a, b) => a.point.distanceTo(mid) - b.point.distanceTo(mid));
        joinableCache[label] = {
          grid: currentGrid,
          joinable: midClosestPoints[0].biome.joinable && midClosestPoints[0].biome === midClosestPoints[1].biome,
        };

        for (const key in joinableCache) {
          const cachedGrid = joinableCache[key].grid;
          if (Math.abs(currentGrid[0] - cachedGrid[0]) > 5 || Math.abs(currentGrid[1] - cachedGrid[1]) > 5) {
            delete joinableCache[key];
          }
        }
      }

      //TODO somewhere around here, check if other side of wall is a diff (blendable) biome. if so, try one more time for biome blending

      if (!joinableCache[label].joinable) {
        voronoiWalls.push(new THREE.Line3(v1, v2));
      }
    }
  }

  var closestPoints = [];
  for (let i = 0; i < voronoiWalls.length; i++) {
    var closestPoint = new THREE.Vector3(0, 0, 0);
    voronoiWalls[i].closestPointToPoint(currentVertex, true, closestPoint);
    closestPoints.push(closestPoint);
  }
  closestPoints.sort((a, b) => a.distanceTo(currentVertex) - b.distanceTo(currentVertex));

  const distance = closestPoints[0] ? currentVertex.distanceTo(closestPoints[0]) : 9999; //TODO temp solution. closestPoints[0] doesnt exist for some vertices of joinable biomes
  // const distance =  currentVertex.distanceTo(closestPoints[0]);
  biomeData.attributes.distanceToRoadCenter = distance;

  const blendWidth = biome.blendWidth || defaultBlendWidth;

  if (!preventLoop) biomeData.attributes.blend = Math.min(blendWidth, Math.max(distance - roadWidth, 0)) / blendWidth;

  if (!preventLoop) biomeData.height = getHeight(biomeData);

  // if (distance === 9999) biomeData.height = 999; //TODO temp to check if above temp solution causes any issues

  biomeData.attributes.disterooni = distance;

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
    height = biomeData.attributes.biome.getVertexData(biomeData).height * biomeData.attributes.blend;

  return height + _noise.terrain(baseNoise, biomeData.x, biomeData.y);
};

const getGrid = (currentVertex: THREE.Vector3, currentGrid: number[]) => {
  // TODO - ideally this will work for both grid and regionGrid
};
