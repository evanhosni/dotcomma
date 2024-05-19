import * as THREE from "three";
import { TerrainNoiseParams, _noise } from "../../_/_noise";
import { _voronoi } from "../../_/_voronoi";
import { Region } from "../../types/Region";
import { VertexData, vertexData_default } from "../../types/VertexData";

const regionGridSize = 2500; //TODO maybe make these dimension props?
const gridSize = 500;
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

export const getVertexData = (x: number, y: number, regions: Region[]) => {
  var vertexData: VertexData = { ...vertexData_default, x, y };
  var currentVertex = new THREE.Vector3(x + _noise.terrain(roadNoise, y, 0), y + _noise.terrain(roadNoise, x, 0), 0);

  const voronoiData = _voronoi.create({
    seed: "123",
    currentVertex,
    gridSize,
    regionGridSize,
    regions,
  });

  const { biome, distance, walls } = voronoiData;
  const blendWidth = biome.blendWidth || defaultBlendWidth;

  vertexData.attributes.biome = biome;
  vertexData.attributes.biomeId = biome.id;
  vertexData.attributes.walls = walls;
  vertexData.attributes.distanceToRoadCenter = distance;
  vertexData.attributes.blend = Math.min(blendWidth, Math.max(distance - roadWidth, 0)) / blendWidth;
  vertexData.height = getHeight(vertexData);

  return vertexData;
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

const getHeight = (vertexData: VertexData) => {
  let height = 0;

  if (vertexData.attributes.distanceToRoadCenter > roadWidth)
    height = vertexData.attributes.biome.getVertexData(vertexData).height * vertexData.attributes.blend;

  return height + _noise.terrain(baseNoise, vertexData.x, vertexData.y);
};

// import * as THREE from "three";
// import { TerrainNoiseParams, _noise } from "../../_/_noise";
// import { _voronoi } from "../../_/_voronoi";
// import { Biome } from "../../types/Biome";
// import { Region } from "../../types/Region";
// import { VertexData, vertexData_default } from "../../types/VertexData";

// const regionGridSize = 2500;
// const gridSize = 500;
// export const roadWidth = 12;
// const defaultBlendWidth = 200;

// const roadNoise: TerrainNoiseParams = {
//   type: "perlin",
//   octaves: 2,
//   persistence: 1,
//   lacunarity: 1,
//   exponentiation: 1,
//   height: 150,
//   scale: 250,
// };

// export const getVertexData = (x: number, y: number, regions: Region[]): VertexData => {
//   const vertexData: VertexData = { ...vertexData_default, x, y };
//   const currentVertex = new THREE.Vector3(x + _noise.terrain(roadNoise, y, 0), y + _noise.terrain(roadNoise, x, 0), 0);

//   const voronoiData = _voronoi.create({
//     seed: "123",
//     currentVertex,
//     gridSize,
//     regionGridSize,
//     regions,
//   });

//   const { grid } = voronoiData;

//   // Sort the grid by distance to the current vertex
//   grid.sort((a, b) => currentVertex.distanceTo(a.point) - currentVertex.distanceTo(b.point));

//   // Consider the closest k Voronoi sites
//   const k = 4;
//   const closestSites = grid.slice(0, k);

//   // Calculate distances
//   const distances = closestSites.map((site) => currentVertex.distanceTo(site.point));

//   // Calculate weights using inverse distance weighting
//   const totalInverseDistance = distances.reduce((sum, dist) => sum + 1 / dist, 0);
//   const weights = distances.map((dist) => 1 / dist / totalInverseDistance);

//   // Calculate blended biome attributes and store blend data
//   const blendedBiome: Partial<Biome> = {};
//   vertexData.attributes.blendData = [];
//   for (let i = 0; i < closestSites.length; i++) {
//     const weight = weights[i];
//     const biome: Biome = closestSites[i].element as Biome;
//     vertexData.attributes.blendData.push({ weight, biome });
//   }

//   vertexData.attributes.biome = blendedBiome as Biome;
//   vertexData.attributes.biomeId = blendedBiome.id; // assuming the id is numeric and blended
//   vertexData.attributes.walls = voronoiData.walls;
//   vertexData.attributes.distanceToRoadCenter = 0; // no roads in this case
//   vertexData.attributes.blend = 1; // full blend

//   vertexData.height = getHeight(vertexData);

//   return vertexData;
// };

// const baseNoise: TerrainNoiseParams = {
//   type: "perlin",
//   octaves: 3,
//   persistence: 2,
//   lacunarity: 2,
//   exponentiation: 2,
//   height: 500,
//   scale: 5000,
// };

// const getHeight = (vertexData: VertexData): number => {
//   let height = 0;

//   // Use the blendData array to calculate the blended height
//   for (const blend of vertexData.attributes.blendData) {
//     height += blend.biome.getVertexData(vertexData).height * blend.weight;
//   }

//   return height + _noise.terrain(baseNoise, vertexData.x, vertexData.y);
// };
