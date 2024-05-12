import * as THREE from "three";
import { TerrainNoiseParams, _noise } from "../../_/_noise";
import { _voronoi } from "../../_/_voronoi";
import { Region } from "../../types/Biome";
import { VertexData, vertexData_default } from "../../types/VertexData";

const regionGridSize = 2500; //TODO implement regions
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

export const getRegionData = (x: number, y: number, regions: Region[], preventLoop?: boolean) => {
  var regionData: VertexData = { ...vertexData_default, x, y }; //TODO name something other than regionData, maybe just vertexData
  var currentVertex = new THREE.Vector3(x + _noise.terrain(roadNoise, y, 0), y + _noise.terrain(roadNoise, x, 0), 0);

  const voronoiData = _voronoi.create({
    seed: "123",
    currentVertex,
    gridSize,
    regionGridSize,
    regions,
  });

  const { biome, distance } = voronoiData;

  const blendWidth = biome.blendWidth || defaultBlendWidth;

  if (!preventLoop) regionData.attributes.biome = biome;
  if (!preventLoop) regionData.attributes.biomeId = biome.id;
  regionData.attributes.distanceToRoadCenter = distance;
  if (!preventLoop) regionData.attributes.blend = Math.min(blendWidth, Math.max(distance - roadWidth, 0)) / blendWidth;
  if (!preventLoop) regionData.height = getHeight(regionData);

  return regionData;
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

const getHeight = (regionData: VertexData) => {
  let height = 0;

  if (regionData.attributes.distanceToRoadCenter > roadWidth)
    height = regionData.attributes.biome.getVertexData(regionData).height * regionData.attributes.blend;

  return height + _noise.terrain(baseNoise, regionData.x, regionData.y);
};
