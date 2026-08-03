import * as THREE from "three";
import { _noise } from "../utils/noise/_noise";
import { voronoi } from "../utils/voronoi/voronoi";
import { getActiveRegions, getWorldTerrainParams, whenWorldReady } from "./registry";
import { VertexData, vertexData_default } from "./types";

/**
 * Main-thread vertex pipeline (Player raycasts, ad-hoc queries).
 * Terrain chunks use the inlined worker pipeline (workers/vertexCompute.ts);
 * both read the same world data — regions and global terrain rules come from
 * the registry committed by the <World> component tree.
 */
export const getVertexData = async (x: number, y: number, isTerrain?: boolean) => {
  await whenWorldReady();
  const params = getWorldTerrainParams();
  const regions = getActiveRegions();

  var vertexData: VertexData = { ...vertexData_default, x, y };
  var currentVertex = new THREE.Vector2(
    x + _noise.terrain(params.roadNoise, y, 0),
    y + _noise.terrain(params.roadNoise, x, 0)
  );

  const { biome, distanceToBiomeBoundary, distanceToRiver, walls } = (await voronoi.create({
    seed: params.seed,
    currentVertex,
    gridSize: params.gridSize,
    regionGridSize: params.regionGridSize,
    regions,
    isTerrain,
  })) as any; //TODO fix as any

  const blendWidth = biome.blendWidth || params.defaultBlendWidth;

  vertexData.attributes = {
    ...vertexData.attributes,
    biome,
    biomeId: biome.id,
    walls,
    distanceToBiomeBoundaryCenter: distanceToBiomeBoundary, // Distance to nearest biome boundary
    distanceToRiverCenter: distanceToRiver, // Distance to nearest river center
    distanceToRoadCenter: distanceToBiomeBoundary, // Initialize to biome boundary (City will override)
    blend: Math.min(blendWidth, Math.max(distanceToBiomeBoundary - params.boundaryWidth, 0)) / blendWidth,
  };
  vertexData.height = await getHeight(vertexData);

  return vertexData;
};

const getHeight = async (vertexData: VertexData) => {
  const params = getWorldTerrainParams();
  let height = 0;

  if (vertexData.attributes.distanceToRiverCenter > params.riverWidth) {
    const riverFade = Math.min(
      1.0,
      (vertexData.attributes.distanceToRiverCenter - params.riverWidth) / params.riverWidth
    );
    const biome_vertexData = await vertexData.attributes.biome.getVertexData(vertexData);
    height = biome_vertexData.height * vertexData.attributes.blend * riverFade;
  }

  return height + _noise.terrain(params.baseNoise, vertexData.x, vertexData.y);
};
