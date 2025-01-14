import * as THREE from "three";
import { TerrainNoiseParams, _noise } from "../../_/_noise";
import { VertexData, vertexData_default } from "../../types/VertexData";
import { voronoi } from "../../utils/voronoi/voronoi";
import { GlitchCity } from "./GlitchCity";

const regionGridSize = 2500; //TODO maybe make these dimension props?
const gridSize = 500;
const roadWidth = 14; //NOTE was 12
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

export const getVertexData = async (x: number, y: number) => {
  var vertexData: VertexData = { ...vertexData_default, x, y };
  var currentVertex = new THREE.Vector2(x + _noise.terrain(roadNoise, y, 0), y + _noise.terrain(roadNoise, x, 0));

  const { biome, distance, walls } = (await voronoi.create({
    seed: "123",
    currentVertex,
    gridSize,
    regionGridSize,
    regions: GlitchCity.regions,
  })) as any; //TODO fix as any

  const blendWidth = biome.blendWidth || defaultBlendWidth;

  vertexData.attributes.biome = biome;
  vertexData.attributes.biomeId = biome.id;
  vertexData.attributes.walls = walls;
  vertexData.attributes.distanceToRoadCenter = distance;
  vertexData.attributes.blend = Math.min(blendWidth, Math.max(distance - roadWidth, 0)) / blendWidth;
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

  if (vertexData.attributes.distanceToRoadCenter > roadWidth) {
    const biome_vertexData = await vertexData.attributes.biome.getVertexData(vertexData);
    height = biome_vertexData.height * vertexData.attributes.blend;
  }

  return height + _noise.terrain(baseNoise, vertexData.x, vertexData.y);
};
