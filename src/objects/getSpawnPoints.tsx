import * as THREE from "three";
import { Apartment } from "../dimensions/glitch-city/biomes/city/blocks/apartment/Apartment";
import { Beeble } from "../dimensions/glitch-city/biomes/city/creatures/beeble/Beeble";
import { BigBeeble } from "../dimensions/glitch-city/biomes/city/creatures/big-beeble/BigBeeble";
import { XLElement } from "../dimensions/glitch-city/biomes/city/creatures/xl-element/XLElement";
import { XXLElement } from "../dimensions/glitch-city/biomes/city/creatures/xxl-element/XXLElement";
import { _math } from "../utils/math/_math";
import { Dimension, Spawner } from "../world/types";
import { OBJECT_RENDER_DISTANCE } from "./ObjectPool";

// Static grid configurations
const GRID_SIZE = 50;
const OFFSET_GRID = 0.5 * GRID_SIZE;

// Define a fixed chunk size for the world - always aligned to grid
const CHUNK_SIZE = 5 * GRID_SIZE; // Each chunk is 5x5 grid cells

// Spawner type definitions
type SpawnerType = "small" | "medium" | "large" | "xl" | "xxl";
type SpawnerElement = typeof Beeble | typeof Apartment | typeof BigBeeble | typeof XLElement | typeof XXLElement;

// Element constructors mapped to their type for faster lookup
const ELEMENT_TO_TYPE = new Map<SpawnerElement, SpawnerType>([
  [Beeble, "small"],
  [Apartment, "medium"],
  [BigBeeble, "large"],
  [XLElement, "xl"],
  [XXLElement, "xxl"],
]);

// Reverse mapping for faster instantiation
const TYPE_TO_ELEMENT = new Map<SpawnerType, SpawnerElement>([
  ["small", Beeble],
  ["medium", Apartment],
  ["large", BigBeeble],
  ["xl", XLElement],
  ["xxl", XXLElement],
]);

// Pre-computed squared spacing requirements
const SPACING_REQUIREMENTS: Record<SpawnerType, Record<SpawnerType, number>> = {
  small: {
    small: Math.pow(GRID_SIZE / 2, 2),
    medium: Math.pow(GRID_SIZE, 2),
    large: Math.pow(2 * GRID_SIZE, 2),
    xl: Math.pow(2.5 * GRID_SIZE, 2),
    xxl: Math.pow(3 * GRID_SIZE, 2),
  },
  medium: {
    small: Math.pow(GRID_SIZE, 2),
    medium: Math.pow(2 * GRID_SIZE, 2),
    large: Math.pow(2.5 * GRID_SIZE, 2),
    xl: Math.pow(3 * GRID_SIZE, 2),
    xxl: Math.pow(3.5 * GRID_SIZE, 2),
  },
  large: {
    small: Math.pow(2 * GRID_SIZE, 2),
    medium: Math.pow(2.5 * GRID_SIZE, 2),
    large: Math.pow(3 * GRID_SIZE, 2),
    xl: Math.pow(3.5 * GRID_SIZE, 2),
    xxl: Math.pow(4 * GRID_SIZE, 2),
  },
  xl: {
    small: Math.pow(2.5 * GRID_SIZE, 2),
    medium: Math.pow(3 * GRID_SIZE, 2),
    large: Math.pow(3.5 * GRID_SIZE, 2),
    xl: Math.pow(4 * GRID_SIZE, 2),
    xxl: Math.pow(4.5 * GRID_SIZE, 2),
  },
  xxl: {
    small: Math.pow(3 * GRID_SIZE, 2),
    medium: Math.pow(3.5 * GRID_SIZE, 2),
    large: Math.pow(4 * GRID_SIZE, 2),
    xl: Math.pow(4.5 * GRID_SIZE, 2),
    xxl: Math.pow(5 * GRID_SIZE, 2),
  },
};

// Cache systems for better performance
const globalSpawnerCache = new Map<string, Spawner[]>();
const spatialIndex = new Map<string, Map<SpawnerType, Set<Spawner>>>();
const seedResultCache = new Map<string, boolean>();
const vertexDataCache = new Map<string, any>();

// Maximum spacing values pre-computed to avoid recalculation
const MAX_SPACING_BY_TYPE: Record<SpawnerType, number> = {
  small: Math.sqrt(Math.max(...Object.values(SPACING_REQUIREMENTS.small))),
  medium: Math.sqrt(Math.max(...Object.values(SPACING_REQUIREMENTS.medium))),
  large: Math.sqrt(Math.max(...Object.values(SPACING_REQUIREMENTS.large))),
  xl: Math.sqrt(Math.max(...Object.values(SPACING_REQUIREMENTS.xl))),
  xxl: Math.sqrt(Math.max(...Object.values(SPACING_REQUIREMENTS.xxl))),
};
const ABSOLUTE_MAX_SPACING = Math.max(...Object.values(MAX_SPACING_BY_TYPE));

// Types for grid points
interface GridPoint {
  id: string;
  x: number;
  y: number;
  vertexData: any;
  main_grid: boolean;
  offset_grid: boolean;
  spawnerType?: SpawnerType;
}

// Optimized random functions with caching of results
function isTypeAtPosition(
  type: SpawnerType,
  x: number,
  y: number,
  probability: number,
  gridFactor: number = 1
): boolean {
  // Use the appropriate grid size based on gridFactor
  const effectiveGridSize = gridFactor === 0.5 ? OFFSET_GRID : GRID_SIZE;
  const key = `${type}_${Math.floor(x / effectiveGridSize)}_${Math.floor(y / effectiveGridSize)}`;

  if (seedResultCache.has(key)) {
    return seedResultCache.get(key)!;
  }

  // Create a position-based seed
  const positionSeed = _math.seedRand(key);
  // Check probability
  const result = Math.floor(positionSeed * probability) === 0;

  seedResultCache.set(key, result);
  return result;
}

// Specialized functions for each type using the generic function
const isXXLAtPosition = (x: number, y: number): boolean => isTypeAtPosition("xxl", x, y, 40);
const isLargeAtPosition = (x: number, y: number): boolean =>
  !isXXLAtPosition(x, y) && isTypeAtPosition("large", x, y, 40);
const isXLAtPosition = (x: number, y: number): boolean => isTypeAtPosition("xl", x, y, 10, 0.5);
const isMedAtPosition = (x: number, y: number): boolean =>
  !isXLAtPosition(x, y) && isTypeAtPosition("medium", x, y, 3, 0.5);

// Get nearby chunk keys efficiently
function getNearbyChunkKeys(playerX: number, playerY: number): string[] {
  const centerChunkX = Math.floor(playerX / CHUNK_SIZE);
  const centerChunkY = Math.floor(playerY / CHUNK_SIZE);
  const viewDistance = Math.ceil(OBJECT_RENDER_DISTANCE / CHUNK_SIZE) + 1;

  const chunkKeys: string[] = [];
  const renderDistanceSquared = Math.pow(OBJECT_RENDER_DISTANCE + CHUNK_SIZE, 2);

  // Preallocate array to avoid reallocation during iteration
  chunkKeys.length = (2 * viewDistance + 1) ** 2;
  let keyIndex = 0;

  for (let dx = -viewDistance; dx <= viewDistance; dx++) {
    for (let dy = -viewDistance; dy <= viewDistance; dy++) {
      const chunkX = centerChunkX + dx;
      const chunkY = centerChunkY + dy;

      // Use squared distance for efficiency
      const chunkCenterX = (chunkX + 0.5) * CHUNK_SIZE;
      const chunkCenterY = (chunkY + 0.5) * CHUNK_SIZE;
      const distSquared = Math.pow(playerX - chunkCenterX, 2) + Math.pow(playerY - chunkCenterY, 2);

      if (distSquared <= renderDistanceSquared) {
        chunkKeys[keyIndex++] = `${chunkX}_${chunkY}`;
      }
    }
  }

  // Trim array to actual size
  chunkKeys.length = keyIndex;
  return chunkKeys;
}

// Spatial index operations
function addToSpatialIndex(spawner: Spawner, chunkKey: string): void {
  if (!spatialIndex.has(chunkKey)) {
    spatialIndex.set(chunkKey, new Map());
  }

  const chunkIndex = spatialIndex.get(chunkKey)!;
  const elementType = ELEMENT_TO_TYPE.get(spawner.element as SpawnerElement);

  if (!elementType) return;

  if (!chunkIndex.has(elementType)) {
    chunkIndex.set(elementType, new Set());
  }

  chunkIndex.get(elementType)!.add(spawner);
}

// Check if a spawner is too close to any existing spawner
function isSpawnerTooClose(
  x: number,
  y: number,
  spawnerType: SpawnerType,
  chunkRadius: number,
  centerChunkX: number,
  centerChunkY: number
): boolean {
  // Use a flat array for faster iteration than nested loops
  const coordOffsets: [number, number][] = [];
  for (let dx = -chunkRadius; dx <= chunkRadius; dx++) {
    for (let dy = -chunkRadius; dy <= chunkRadius; dy++) {
      coordOffsets.push([dx, dy]);
    }
  }

  // Check all neighboring chunks using the flat array
  for (const [dx, dy] of coordOffsets) {
    const neighborChunkX = centerChunkX + dx;
    const neighborChunkY = centerChunkY + dy;
    const neighborChunkKey = `${neighborChunkX}_${neighborChunkY}`;

    // Skip if this chunk has no spatial index
    if (!spatialIndex.has(neighborChunkKey)) continue;

    const chunkIndex = spatialIndex.get(neighborChunkKey)!;

    // For each spawner type, check distance constraints
    for (const [existingTypeKey, spawners] of chunkIndex.entries() as any) {
      // Get minimum squared distance
      const minDistanceSquared = SPACING_REQUIREMENTS[spawnerType][existingTypeKey as SpawnerType];

      // Check all spawners of this type
      for (const spawner of spawners) {
        const dx = x - spawner.point.x;
        const dy = y - spawner.point.z;
        const distSquared = dx * dx + dy * dy;

        if (distSquared < minDistanceSquared) {
          return true; // Too close to an existing spawner
        }
      }
    }
  }

  return false; // Not too close to any existing spawner
}

// Optimized function to check neighboring chunks
function checkNeighboringChunks(pointX: number, pointY: number, spawnerType: SpawnerType): boolean {
  // Use pre-computed max spacing value
  const maxSpacing = MAX_SPACING_BY_TYPE[spawnerType];
  const chunkRadius = Math.ceil((maxSpacing + GRID_SIZE) / CHUNK_SIZE) + 1;
  const centerChunkX = Math.floor(pointX / CHUNK_SIZE);
  const centerChunkY = Math.floor(pointY / CHUNK_SIZE);

  return !isSpawnerTooClose(pointX, pointY, spawnerType, chunkRadius, centerChunkX, centerChunkY);
}

// Check if a point is too close to grid spawners - optimized
function isPointTooCloseToGridSpawners(
  point: GridPoint,
  spawnerType: SpawnerType,
  grid: Map<string, GridPoint>
): boolean {
  for (const existingPoint of grid.values() as any) {
    // Only check against points marked as actual spawners
    if (!existingPoint.spawnerType) continue;

    // Calculate exact distance squared
    const dx = point.x - existingPoint.x;
    const dy = point.y - existingPoint.y;
    const distanceSquared = dx * dx + dy * dy;

    // Get minimum required squared distance
    const minDistanceSquared = SPACING_REQUIREMENTS[spawnerType][existingPoint.spawnerType as SpawnerType];

    // Check against minimum distance
    if (distanceSquared < minDistanceSquared) {
      return true; // Too close
    }
  }

  return false; // Not too close
}

// Check if a point has nearby spawners of specific type - optimized
function hasNearbySpawnerType(
  point: GridPoint,
  spawnerType: SpawnerType,
  checkRadiusSquared: number,
  grid: Map<string, GridPoint>
): boolean {
  for (const existingPoint of grid.values() as any) {
    // Only check against points marked as the specified spawner type
    if (existingPoint.spawnerType !== spawnerType) continue;

    // Calculate exact distance squared
    const dx = point.x - existingPoint.x;
    const dy = point.y - existingPoint.y;
    const distanceSquared = dx * dx + dy * dy;

    // Check against radius
    if (distanceSquared < checkRadiusSquared) {
      return true;
    }
  }

  return false;
}

// Generate spawners for a specific chunk - optimized
async function generateChunkSpawners(dimension: Dimension, chunkKey: string): Promise<Spawner[]> {
  // Check cache first
  if (globalSpawnerCache.has(chunkKey)) {
    return globalSpawnerCache.get(chunkKey)!;
  }

  // Parse chunk coordinates from key
  const [chunkX, chunkY] = chunkKey.split("_").map(Number);

  // Define chunk boundaries
  const chunkMinX = chunkX * CHUNK_SIZE - OFFSET_GRID;
  const chunkMaxX = (chunkX + 1) * CHUNK_SIZE + OFFSET_GRID;
  const chunkMinY = chunkY * CHUNK_SIZE - OFFSET_GRID;
  const chunkMaxY = (chunkY + 1) * CHUNK_SIZE + OFFSET_GRID;

  // Use pre-computed max spacing
  const expansionBuffer = ABSOLUTE_MAX_SPACING;
  const expandedMinX = chunkMinX - expansionBuffer;
  const expandedMaxX = chunkMaxX + expansionBuffer;
  const expandedMinY = chunkMinY - expansionBuffer;
  const expandedMaxY = chunkMaxY + expansionBuffer;

  // Use a Map for grid points for faster lookups by id
  const grid = new Map<string, GridPoint>();
  const fetchPromises: Promise<void>[] = [];

  // Batch collections for different spawner types
  const xxlCandidates: [number, number][] = [];
  const largeCandidates: [number, number][] = [];
  const xlCandidates: [number, number][] = [];
  const mediumCandidates: [number, number][] = [];
  const smallCandidates: [number, number][] = [];

  // Main grid scan (for xxl, large, small)
  for (let x = expandedMinX; x <= expandedMaxX; x += GRID_SIZE) {
    for (let y = expandedMinY; y <= expandedMaxY; y += GRID_SIZE) {
      // Classify by type and store coordinates
      if (isXXLAtPosition(x, y)) {
        xxlCandidates.push([x, y]);
      } else if (isLargeAtPosition(x, y)) {
        largeCandidates.push([x, y]);
      } else if (x >= chunkMinX && x < chunkMaxX && y >= chunkMinY && y < chunkMaxY) {
        // Only consider small spawners within actual chunk borders
        smallCandidates.push([x, y]);
      }
    }
  }

  // Offset grid scan (for xl, medium)
  for (let x = expandedMinX + OFFSET_GRID; x < expandedMaxX; x += GRID_SIZE) {
    for (let y = expandedMinY + OFFSET_GRID; y < expandedMaxY; y += GRID_SIZE) {
      if (isXLAtPosition(x, y)) {
        xlCandidates.push([x, y]);
      } else if (isMedAtPosition(x, y)) {
        mediumCandidates.push([x, y]);
      }
    }
  }

  // Combine all candidates that need vertex data
  const allCandidates = [
    ...xxlCandidates,
    ...largeCandidates,
    ...xlCandidates,
    ...mediumCandidates,
    ...smallCandidates.filter((_, idx) => idx < 50), // Limit small candidates for performance
  ];

  // Fetch vertex data in parallel
  for (const [x, y] of allCandidates) {
    const id = `${x}_${y}`;

    // Check vertex data cache first
    if (vertexDataCache.has(id)) {
      const vertexData = vertexDataCache.get(id);
      const isMain = (x - expandedMinX) % GRID_SIZE === 0 && (y - expandedMinY) % GRID_SIZE === 0;

      grid.set(id, {
        id,
        x,
        y,
        vertexData,
        main_grid: isMain,
        offset_grid: !isMain,
      });
      continue;
    }

    // Fetch new vertex data
    const promise = dimension.getVertexData(x, y).then((vertexData) => {
      vertexDataCache.set(id, vertexData); // Cache the vertex data

      const isMain = (x - expandedMinX) % GRID_SIZE === 0 && (y - expandedMinY) % GRID_SIZE === 0;

      grid.set(id, {
        id,
        x,
        y,
        vertexData,
        main_grid: isMain,
        offset_grid: !isMain,
      });
    });

    fetchPromises.push(promise);
  }

  // Wait for all vertex data to be fetched
  await Promise.all(fetchPromises);

  // The actual spawners for this chunk
  const chunkSpawners: Spawner[] = [];

  // Create a spatial index for this chunk if it doesn't exist
  if (!spatialIndex.has(chunkKey)) {
    spatialIndex.set(chunkKey, new Map());
  }

  // Process spawners in order of rarity/priority

  // Phase 1: XXL spawners (rarest)
  for (const [x, y] of xxlCandidates) {
    // Only process points in this chunk
    if (!(x >= chunkMinX && x < chunkMaxX && y >= chunkMinY && y < chunkMaxY)) {
      continue;
    }

    const id = `${x}_${y}`;
    const point = grid.get(id);
    if (!point) continue;

    // Check neighboring chunks
    if (checkNeighboringChunks(x, y, "xxl")) {
      point.spawnerType = "xxl";

      const spawner: Spawner = {
        point: new THREE.Vector3(x, 0, y),
        element: XXLElement,
      };

      chunkSpawners.push(spawner);
      addToSpatialIndex(spawner, chunkKey);
    }
  }

  // Phase 2: XL spawners
  for (const [x, y] of xlCandidates) {
    // Only process points in this chunk
    if (!(x >= chunkMinX && x < chunkMaxX && y >= chunkMinY && y < chunkMaxY)) {
      continue;
    }

    const id = `${x}_${y}`;
    const point = grid.get(id);
    if (!point) continue;

    // Check spacing against existing grid spawners
    if (isPointTooCloseToGridSpawners(point, "xl", grid)) continue;

    // Check neighboring chunks
    if (checkNeighboringChunks(x, y, "xl")) {
      point.spawnerType = "xl";

      const spawner: Spawner = {
        point: new THREE.Vector3(x, 0, y),
        element: XLElement,
      };

      chunkSpawners.push(spawner);
      addToSpatialIndex(spawner, chunkKey);
    }
  }

  // Phase 3: Large spawners
  for (const [x, y] of largeCandidates) {
    // Only process points in this chunk
    if (!(x >= chunkMinX && x < chunkMaxX && y >= chunkMinY && y < chunkMaxY)) {
      continue;
    }

    const id = `${x}_${y}`;
    const point = grid.get(id);
    if (!point) continue;

    // Check spacing against existing grid spawners
    if (isPointTooCloseToGridSpawners(point, "large", grid)) continue;

    // Check neighboring chunks
    if (checkNeighboringChunks(x, y, "large")) {
      point.spawnerType = "large";

      const spawner: Spawner = {
        point: new THREE.Vector3(x, 0, y),
        element: BigBeeble,
      };

      chunkSpawners.push(spawner);
      addToSpatialIndex(spawner, chunkKey);
    }
  }

  // Phase 4: Medium spawners
  for (const [x, y] of mediumCandidates) {
    // Only process points in this chunk
    if (!(x >= chunkMinX && x < chunkMaxX && y >= chunkMinY && y < chunkMaxY)) {
      continue;
    }

    const id = `${x}_${y}`;
    const point = grid.get(id);
    if (!point) continue;

    // Check spacing against existing grid spawners
    if (isPointTooCloseToGridSpawners(point, "medium", grid)) continue;

    // Check neighboring chunks
    if (checkNeighboringChunks(x, y, "medium")) {
      point.spawnerType = "medium";

      const spawner: Spawner = {
        point: new THREE.Vector3(x, 0, y),
        element: Apartment,
      };

      chunkSpawners.push(spawner);
      addToSpatialIndex(spawner, chunkKey);
    }
  }

  // Phase 5: Small spawners (most numerous)
  for (const [x, y] of smallCandidates) {
    const id = `${x}_${y}`;
    const point = grid.get(id);
    if (!point) continue;

    // Quick check against all larger spawner types
    if (
      hasNearbySpawnerType(point, "xxl", SPACING_REQUIREMENTS["small"]["xxl"], grid) ||
      hasNearbySpawnerType(point, "xl", SPACING_REQUIREMENTS["small"]["xl"], grid) ||
      hasNearbySpawnerType(point, "large", SPACING_REQUIREMENTS["small"]["large"], grid) ||
      hasNearbySpawnerType(point, "medium", SPACING_REQUIREMENTS["small"]["medium"], grid) ||
      hasNearbySpawnerType(point, "small", SPACING_REQUIREMENTS["small"]["small"], grid)
    ) {
      continue;
    }

    // Final cross-chunk check
    if (checkNeighboringChunks(x, y, "small")) {
      point.spawnerType = "small";

      const spawner: Spawner = {
        point: new THREE.Vector3(x, 0, y),
        element: Beeble,
      };

      chunkSpawners.push(spawner);
      addToSpatialIndex(spawner, chunkKey);
    }
  }

  // Cache the results for this chunk
  globalSpawnerCache.set(chunkKey, chunkSpawners);

  return chunkSpawners;
}

// Main function for getting spawn points - optimized
export async function getSpawnPoints(dimension: Dimension, playerX: number, playerY: number): Promise<Spawner[]> {
  cleanupDistantChunks(playerX, playerY);
  // Get nearby chunk keys
  const chunkKeys = getNearbyChunkKeys(playerX, playerY);

  // Sort chunk keys by distance for deterministic ordering and better performance
  const centerChunkX = Math.floor(playerX / CHUNK_SIZE);
  const centerChunkY = Math.floor(playerY / CHUNK_SIZE);

  // // TODO cleanup caches (fix mem leak)
  // console.log(globalSpawnerCache.size);
  // console.log(spatialIndex.size);
  // console.log(seedResultCache.size);
  // console.log(vertexDataCache.size);

  chunkKeys.sort((a, b) => {
    const [ax, ay] = a.split("_").map(Number);
    const [bx, by] = b.split("_").map(Number);

    const distA = Math.pow(ax - centerChunkX, 2) + Math.pow(ay - centerChunkY, 2);
    const distB = Math.pow(bx - centerChunkX, 2) + Math.pow(by - centerChunkY, 2);

    return distA - distB;
  });

  // Process chunks - use Map for faster lookup
  const visibleSpawners = new Map<string, Spawner>();
  const renderDistanceSquared = OBJECT_RENDER_DISTANCE * OBJECT_RENDER_DISTANCE;

  // Process chunks in small batches to avoid blocking the main thread
  const BATCH_SIZE = 3;
  for (let i = 0; i < chunkKeys.length; i += BATCH_SIZE) {
    const batchChunks = chunkKeys.slice(i, i + BATCH_SIZE);
    const batchPromises = batchChunks.map((chunkKey) => generateChunkSpawners(dimension, chunkKey));

    const batchResults = await Promise.all(batchPromises);

    // Filter and add spawners
    for (const spawners of batchResults) {
      for (const spawner of spawners) {
        const dx = spawner.point.x - playerX;
        const dz = spawner.point.z - playerY;
        const distanceSquared = dx * dx + dz * dz;

        if (distanceSquared <= renderDistanceSquared) {
          // Use unique ID to avoid duplicates
          const elementType = ELEMENT_TO_TYPE.get(spawner.element as SpawnerElement);
          const spawnerId = `${spawner.point.x}_${spawner.point.z}_${elementType}`;
          visibleSpawners.set(spawnerId, spawner);
        }
      }
    }
  }

  return Array.from(visibleSpawners.values());
}

// Memory management function - call periodically to clear caches for distant chunks
export function cleanupDistantChunks(
  playerX: number,
  playerY: number,
  cleanupRadius: number = OBJECT_RENDER_DISTANCE * 2
): void {
  const centerChunkX = Math.floor(playerX / CHUNK_SIZE);
  const centerChunkY = Math.floor(playerY / CHUNK_SIZE);
  const cleanupRadiusInChunks = Math.ceil(cleanupRadius / CHUNK_SIZE);
  const cleanupRadiusSquared = Math.pow(cleanupRadius, 2);

  // Clean spawner cache and spatial index
  for (const chunkKey of [...(globalSpawnerCache.keys() as any), ...(spatialIndex.keys() as any)]) {
    const [chunkX, chunkY] = chunkKey.split("_").map(Number);
    const distanceSquared = Math.pow(chunkX - centerChunkX, 2) + Math.pow(chunkY - centerChunkY, 2);

    if (distanceSquared > Math.pow(cleanupRadiusInChunks, 2)) {
      globalSpawnerCache.delete(chunkKey);
      spatialIndex.delete(chunkKey);
    }
  }

  // Clean seedResultCache based on distance
  for (const key of seedResultCache.keys() as any) {
    // Parse the key to extract type and coordinates
    // Key format is "{type}_{x}_{y}"
    const parts = key.split("_");
    if (parts.length >= 3) {
      const gridX = parseFloat(parts[1]) * GRID_SIZE;
      const gridY = parseFloat(parts[2]) * GRID_SIZE;

      // Calculate distance from player
      const dx = gridX - playerX;
      const dy = gridY - playerY;
      const distanceSquared = dx * dx + dy * dy;

      if (distanceSquared > cleanupRadiusSquared) {
        seedResultCache.delete(key);
      }
    }
  }

  // Clean vertexDataCache based on distance instead of just limiting size
  for (const key of vertexDataCache.keys() as any) {
    // Parse the vertex position from the key
    // Key format is "{x}_{y}"
    const [x, y] = key.split("_").map(Number);

    // Calculate distance from player
    const dx = x - playerX;
    const dy = y - playerY;
    const distanceSquared = dx * dx + dy * dy;

    if (distanceSquared > cleanupRadiusSquared) {
      vertexDataCache.delete(key);
    }
  }
}
