import * as THREE from "three";
import { TerrainNoiseParams, _noise } from "../utils/noise/_noise";
import { voronoi } from "../utils/voronoi/voronoi";
import { CityRegion, DesertRegion } from "../regions";
import { VertexData, vertexData_default } from "./types";

const regions = [CityRegion, DesertRegion];

const regionGridSize = 2500; //TODO maybe make these dimension props?
const gridSize = 500;
const boundaryWidth = 14; //NOTE was 12 - width of biome boundary blend offset
const riverWidth = 30; // height suppression zone near region boundaries (rivers)
const defaultBlendWidth = 200; //TODO add noise to blendwidth and make biome dependent

const roadNoise: TerrainNoiseParams = {
  type: "perlin",
  octaves: 2,
  persistence: 1,
  lacunarity: 1,
  exponentiation: 1,
  height: 150, //NOTE 100 seems safe
  scale: 250,
};

export const getVertexData = async (x: number, y: number, isTerrain?: boolean) => {
  var vertexData: VertexData = { ...vertexData_default, x, y };
  var currentVertex = new THREE.Vector2(x + _noise.terrain(roadNoise, y, 0), y + _noise.terrain(roadNoise, x, 0));

  const { biome, distanceToBiomeBoundary, distanceToRiver, walls } = (await voronoi.create({
    seed: "123",
    currentVertex,
    gridSize,
    regionGridSize,
    regions,
    isTerrain,
  })) as any; //TODO fix as any

  const blendWidth = biome.blendWidth || defaultBlendWidth;

  vertexData.attributes = {
    ...vertexData.attributes,
    biome,
    biomeId: biome.id,
    walls,
    distanceToBiomeBoundaryCenter: distanceToBiomeBoundary, // Distance to nearest biome boundary
    distanceToRiverCenter: distanceToRiver, // Distance to nearest river center
    distanceToRoadCenter: distanceToBiomeBoundary, // Initialize to biome boundary (City will override)
    blend: Math.min(blendWidth, Math.max(distanceToBiomeBoundary - boundaryWidth, 0)) / blendWidth,
  };
  vertexData.height = await getHeight(vertexData);

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

const getHeight = async (vertexData: VertexData) => {
  let height = 0;

  if (vertexData.attributes.distanceToRiverCenter > riverWidth) {
    const riverFade = Math.min(1.0, (vertexData.attributes.distanceToRiverCenter - riverWidth) / riverWidth);
    const biome_vertexData = await vertexData.attributes.biome.getVertexData(vertexData);
    height = biome_vertexData.height * vertexData.attributes.blend * riverFade;
  }

  return height + _noise.terrain(baseNoise, vertexData.x, vertexData.y);
};
