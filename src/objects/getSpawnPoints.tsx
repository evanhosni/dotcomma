import * as THREE from "three";
import { Apartment } from "../dimensions/glitch-city/biomes/city/blocks/apartment/Apartment";
import { Beeple } from "../dimensions/glitch-city/biomes/city/creatures/beeple/Beeple";
import { BigBeeple } from "../dimensions/glitch-city/biomes/city/creatures/big-beeple/BigBeeple";
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

// Reverse map for element to type lookup (for efficient type determination)
const ELEMENT_TO_TYPE = new Map([
  [Beeple, "small"],
  [Apartment, "medium"],
  [BigBeeple, "large"],
  [XLElement, "xl"],
  [XXLElement, "xxl"],
]);

// Spacing requirements for each spawner type - stored squared to avoid costly sqrt operations
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

// Global cache of determined spawners - permanent for the session
const globalSpawnerCache = new Map<string, Spawner[]>();

// Spatial index for quick distance queries - maps chunk keys to spawners
const spatialIndex = new Map<string, Map<SpawnerType, Set<Spawner>>>();

interface GridPoint {
  id: string;
  x: number;
  y: number;
  vertexData: any;
  main_grid: boolean;
  offset_grid: boolean;
  isLarge: boolean;
  isMed: boolean;
  isXL: boolean;
  isXXL: boolean;
  isActuallyLarge?: boolean;
  isActuallyMed?: boolean;
  isActuallyXL?: boolean;
  isActuallyXXL?: boolean;
  spawnerType?: SpawnerType;
}

// Deterministic seed and result cache to avoid recalculating
const seedResultCache = new Map<string, boolean>();

// Optimized random functions with caching of results
const isXXLAtPosition = (x: number, y: number): boolean => {
  const key = `xxl_${Math.floor(x / GRID_SIZE)}_${Math.floor(y / GRID_SIZE)}`;

  if (seedResultCache.has(key)) {
    return seedResultCache.get(key)!;
  }

  // Create a position-based seed
  const positionSeed = _math.seedRand(key);
  // Even rarer than large - 1/80 probability
  const result = Math.floor(positionSeed * 40) === 0;

  seedResultCache.set(key, result);
  return result;
};

const isLargeAtPosition = (x: number, y: number): boolean => {
  // Check if this position is taken by XXL first - use cached XXL result if available
  if (isXXLAtPosition(x, y)) return false;

  const key = `large_${Math.floor(x / GRID_SIZE)}_${Math.floor(y / GRID_SIZE)}`;

  if (seedResultCache.has(key)) {
    return seedResultCache.get(key)!;
  }

  // Create a position-based seed that's consistent regardless of player approach
  const positionSeed = _math.seedRand(key);
  // 1/40 probability of being large
  const result = Math.floor(positionSeed * 40) === 0;

  seedResultCache.set(key, result);
  return result;
};

const isXLAtPosition = (x: number, y: number): boolean => {
  const key = `xl_${Math.floor(x / OFFSET_GRID)}_${Math.floor(y / OFFSET_GRID)}`;

  if (seedResultCache.has(key)) {
    return seedResultCache.get(key)!;
  }

  // Position-based seed for XL spawners
  const positionSeed = _math.seedRand(key);
  // 1/10 probability of being XL (less common than medium, more common than large)
  const result = Math.floor(positionSeed * 10) === 0;

  seedResultCache.set(key, result);
  return result;
};

const isMedAtPosition = (x: number, y: number): boolean => {
  // Don't allow medium where XL already exists - use cached XL result if available
  if (isXLAtPosition(x, y)) return false;

  const key = `medium_${Math.floor(x / OFFSET_GRID)}_${Math.floor(y / OFFSET_GRID)}`;

  if (seedResultCache.has(key)) {
    return seedResultCache.get(key)!;
  }

  // Position-based seed for medium spawners
  const positionSeed = _math.seedRand(key);
  // 1/3 probability of being medium
  const result = Math.floor(positionSeed * 3) === 0;

  seedResultCache.set(key, result);
  return result;
};

// Get nearby chunk keys from player position - optimized with distance squared
const getNearbyChunkKeys = (playerX: number, playerY: number): string[] => {
  const centerChunkX = Math.floor(playerX / CHUNK_SIZE);
  const centerChunkY = Math.floor(playerY / CHUNK_SIZE);
  const viewDistance = Math.ceil(OBJECT_RENDER_DISTANCE / CHUNK_SIZE) + 1;

  const chunkKeys: string[] = [];
  const renderDistanceSquared = Math.pow(OBJECT_RENDER_DISTANCE + CHUNK_SIZE, 2);

  for (let dx = -viewDistance; dx <= viewDistance; dx++) {
    for (let dy = -viewDistance; dy <= viewDistance; dy++) {
      const chunkX = centerChunkX + dx;
      const chunkY = centerChunkY + dy;

      // Calculate distance to chunk center to skip far chunks - use squared distance
      const chunkCenterX = (chunkX + 0.5) * CHUNK_SIZE;
      const chunkCenterY = (chunkY + 0.5) * CHUNK_SIZE;
      const distSquared = Math.pow(playerX - chunkCenterX, 2) + Math.pow(playerY - chunkCenterY, 2);

      if (distSquared <= renderDistanceSquared) {
        chunkKeys.push(`${chunkX}_${chunkY}`);
      }
    }
  }

  return chunkKeys;
};

// Add a spawner to the spatial index
const addToSpatialIndex = (spawner: Spawner, chunkKey: string): void => {
  if (!spatialIndex.has(chunkKey)) {
    spatialIndex.set(chunkKey, new Map());
  }

  const chunkIndex = spatialIndex.get(chunkKey)!;
  const elementType = ELEMENT_TO_TYPE.get(spawner.element);

  if (!elementType) return;

  if (!chunkIndex.has(elementType as any)) {
    chunkIndex.set(elementType as any, new Set());
  }

  chunkIndex.get(elementType as any)!.add(spawner);
};

// Quick proximity check using the spatial index
const isSpawnerTooClose = (
  x: number,
  y: number,
  spawnerType: SpawnerType,
  chunkRadius: number,
  centerChunkX: number,
  centerChunkY: number
): boolean => {
  // Check all neighboring chunks
  for (let dx = -chunkRadius; dx <= chunkRadius; dx++) {
    for (let dy = -chunkRadius; dy <= chunkRadius; dy++) {
      const neighborChunkX = centerChunkX + dx;
      const neighborChunkY = centerChunkY + dy;
      const neighborChunkKey = `${neighborChunkX}_${neighborChunkY}`;

      // Skip if this chunk has no spatial index
      if (!spatialIndex.has(neighborChunkKey)) continue;

      const chunkIndex = spatialIndex.get(neighborChunkKey)!;

      // For each spawner type, check distance constraints
      for (const [existingTypeKey, spawners] of chunkIndex.entries() as any) {
        // Make sure existingType is a valid SpawnerType
        const existingType = existingTypeKey as SpawnerType;

        // Get minimum squared distance
        const minDistanceSquared = SPACING_REQUIREMENTS[spawnerType][existingType];

        // Check all spawners of this type
        for (const spawner of spawners) {
          const distSquared = Math.pow(x - spawner.point.x, 2) + Math.pow(y - spawner.point.z, 2);

          if (distSquared < minDistanceSquared) {
            return true; // Too close to an existing spawner
          }
        }
      }
    }
  }

  return false; // Not too close to any existing spawner
};

// Improved check for neighboring spawners across chunks with spatial indexing
const checkNeighboringChunks = (pointX: number, pointY: number, spawnerType: SpawnerType): boolean => {
  // Calculate which chunks could contain spawners that are too close
  const maxSpacing = Math.max(...Object.values(SPACING_REQUIREMENTS[spawnerType]).map(Math.sqrt));
  const chunkRadius = Math.ceil((maxSpacing + GRID_SIZE) / CHUNK_SIZE) + 1;
  const centerChunkX = Math.floor(pointX / CHUNK_SIZE);
  const centerChunkY = Math.floor(pointY / CHUNK_SIZE);

  return !isSpawnerTooClose(pointX, pointY, spawnerType, chunkRadius, centerChunkX, centerChunkY);
};

// Optimized check for local grid proximity
const isPointTooCloseToGridSpawners = (
  point: GridPoint,
  spawnerType: SpawnerType,
  grid: Record<string, GridPoint>
): boolean => {
  for (const existingPoint of Object.values(grid)) {
    // Only check against points marked as actual spawners
    if (!existingPoint.spawnerType) continue;

    // Calculate exact distance squared
    const distanceSquared = Math.pow(point.x - existingPoint.x, 2) + Math.pow(point.y - existingPoint.y, 2);

    // Get minimum required squared distance
    const minDistanceSquared = SPACING_REQUIREMENTS[spawnerType][existingPoint.spawnerType];

    // Check against minimum distance
    if (distanceSquared < minDistanceSquared) {
      return true; // Too close
    }
  }

  return false; // Not too close
};

// Helper for checking if a small point has any spawner of a specific type nearby
const hasNearbySpawnerType = (
  point: GridPoint,
  spawnerType: SpawnerType,
  checkRadiusSquared: number,
  grid: Record<string, GridPoint>
): boolean => {
  for (const existingPoint of Object.values(grid)) {
    // Only check against points marked as the specified spawner type
    if (existingPoint.spawnerType !== spawnerType) continue;

    // Calculate exact distance squared
    const distanceSquared = Math.pow(point.x - existingPoint.x, 2) + Math.pow(point.y - existingPoint.y, 2);

    // Check against radius
    if (distanceSquared < checkRadiusSquared) {
      return true;
    }
  }

  return false;
};

// Primary function to generate spawners for a specific chunk - optimization focus
const generateChunkSpawners = async (dimension: Dimension, chunkKey: string): Promise<Spawner[]> => {
  // Check if we've already processed this chunk
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

  // Calculate expansion buffer based on maximum spacing requirement
  const maxSpacing = Math.max(...Object.values(SPACING_REQUIREMENTS.xxl).map(Math.sqrt));
  const expansionBuffer = maxSpacing;
  const expandedMinX = chunkMinX - expansionBuffer;
  const expandedMaxX = chunkMaxX + expansionBuffer;
  const expandedMinY = chunkMinY - expansionBuffer;
  const expandedMaxY = chunkMaxY + expansionBuffer;

  // Pre-filter points for candidates before getting vertex data
  interface GridCandidate {
    x: number;
    y: number;
    main_grid: boolean;
    offset_grid: boolean;
    isLarge: boolean;
    isMed: boolean;
    isXL: boolean;
    isXXL: boolean;
  }

  // Generate all grid candidate points in expanded chunk
  const gridCandidates: GridCandidate[] = [];

  // Generate main grid points (for large, xxl, and small)
  for (let x = expandedMinX; x <= expandedMaxX; x += GRID_SIZE) {
    for (let y = expandedMinY; y <= expandedMaxY; y += GRID_SIZE) {
      // First check XXL (highest priority)
      const isXXL = isXXLAtPosition(x, y);

      // Only check for large if not an XXL position
      const isLarge = !isXXL && isLargeAtPosition(x, y);

      gridCandidates.push({
        x,
        y,
        main_grid: true,
        offset_grid: false,
        isLarge,
        isXXL,
        isMed: false,
        isXL: false,
      });
    }
  }

  // Generate offset grid points (for medium and xl)
  for (let x = expandedMinX + OFFSET_GRID; x < expandedMaxX; x += GRID_SIZE) {
    for (let y = expandedMinY + OFFSET_GRID; y < expandedMaxY; y += GRID_SIZE) {
      // First check XL (higher priority)
      const isXL = isXLAtPosition(x, y);

      // Only check for medium if not an XL position
      const isMed = !isXL && isMedAtPosition(x, y);

      gridCandidates.push({
        x,
        y,
        main_grid: false,
        offset_grid: true,
        isLarge: false,
        isXXL: false,
        isMed,
        isXL,
      });
    }
  }

  // First filter candidates to those that might become actual spawners
  const potentialCandidates = gridCandidates.filter(
    (c) =>
      c.isXXL ||
      c.isLarge ||
      c.isXL ||
      c.isMed ||
      (c.main_grid && c.x >= chunkMinX && c.x < chunkMaxX && c.y >= chunkMinY && c.y < chunkMaxY)
  );

  // Only fetch vertex data for potential candidates
  const grid: Record<string, GridPoint> = {};
  const promises: Promise<void>[] = [];

  for (const candidate of potentialCandidates) {
    const id = `${candidate.x}_${candidate.y}`;

    // Fetch vertex data only for potential spawners
    const promise = dimension.getVertexData(candidate.x, candidate.y).then((vertexData) => {
      grid[id] = {
        id,
        x: candidate.x,
        y: candidate.y,
        vertexData,
        main_grid: candidate.main_grid,
        offset_grid: candidate.offset_grid,
        isLarge: candidate.isLarge,
        isXXL: candidate.isXXL,
        isMed: candidate.isMed,
        isXL: candidate.isXL,
      };
    });

    promises.push(promise);
  }

  // Wait for all vertex data to be fetched
  await Promise.all(promises);

  // Filter grid to points inside the actual chunk (without buffer)
  const chunkPoints = Object.values(grid).filter(
    (point) => point.x >= chunkMinX && point.x < chunkMaxX && point.y >= chunkMinY && point.y < chunkMaxY
  );

  // The actual spawners for this chunk
  const chunkSpawners: Spawner[] = [];

  // Create a spatial index for this chunk if it doesn't exist
  if (!spatialIndex.has(chunkKey)) {
    spatialIndex.set(chunkKey, new Map());
  }

  // OPTIMIZATION: Process spawners in order of rarity/priority
  // This reduces the number of checks needed for common spawners

  // Phase 1: Process XXL spawners (rarest, highest priority)
  const xxlPoints = Object.values(grid)
    .filter((point) => point.main_grid && point.isXXL)
    .sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));

  for (const point of xxlPoints) {
    // Skip if outside this chunk
    if (!(point.x >= chunkMinX && point.x < chunkMaxX && point.y >= chunkMinY && point.y < chunkMaxY)) {
      continue;
    }

    // Check neighboring chunks for any spawners that would conflict - use optimized check
    const canPlace = checkNeighboringChunks(point.x, point.y, "xxl");

    if (canPlace) {
      point.isActuallyXXL = true;
      point.spawnerType = "xxl";

      const spawner = {
        point: new THREE.Vector3(point.x, 0, point.y),
        element: XXLElement,
      };

      chunkSpawners.push(spawner);

      // Add to spatial index for efficient proximity checks
      addToSpatialIndex(spawner, chunkKey);
    }
  }

  // Phase 2: Process XL spawners
  const xlPoints = Object.values(grid)
    .filter((point) => point.offset_grid && point.isXL)
    .sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));

  for (const point of xlPoints) {
    // Skip if outside this chunk
    if (!(point.x >= chunkMinX && point.x < chunkMaxX && point.y >= chunkMinY && point.y < chunkMaxY)) {
      continue;
    }

    // Check spacing against existing grid spawners - optimized check
    if (isPointTooCloseToGridSpawners(point, "xl", grid)) continue;

    // Check neighboring chunks - use optimized spatial index
    const canPlace = checkNeighboringChunks(point.x, point.y, "xl");

    if (canPlace) {
      point.isActuallyXL = true;
      point.spawnerType = "xl";

      const spawner = {
        point: new THREE.Vector3(point.x, 0, point.y),
        element: XLElement,
      };

      chunkSpawners.push(spawner);

      // Add to spatial index
      addToSpatialIndex(spawner, chunkKey);
    }
  }

  // Phase 3: Process large spawners
  const largePoints = Object.values(grid)
    .filter((point) => point.main_grid && point.isLarge)
    .sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));

  for (const point of largePoints) {
    // Skip if outside this chunk
    if (!(point.x >= chunkMinX && point.x < chunkMaxX && point.y >= chunkMinY && point.y < chunkMaxY)) {
      continue;
    }

    // Check spacing against existing grid spawners - optimized check
    if (isPointTooCloseToGridSpawners(point, "large", grid)) continue;

    // Check neighboring chunks - use optimized spatial index
    const canPlace = checkNeighboringChunks(point.x, point.y, "large");

    if (canPlace) {
      point.isActuallyLarge = true;
      point.spawnerType = "large";

      const spawner = {
        point: new THREE.Vector3(point.x, 0, point.y),
        element: BigBeeple,
      };

      chunkSpawners.push(spawner);

      // Add to spatial index
      addToSpatialIndex(spawner, chunkKey);
    }
  }

  // Phase 4: Process medium spawners
  const mediumPoints = Object.values(grid)
    .filter((point) => point.offset_grid && point.isMed)
    .sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));

  for (const point of mediumPoints) {
    // Skip if outside this chunk
    if (!(point.x >= chunkMinX && point.x < chunkMaxX && point.y >= chunkMinY && point.y < chunkMaxY)) {
      continue;
    }

    // Check spacing against existing grid spawners - optimized check
    if (isPointTooCloseToGridSpawners(point, "medium", grid)) continue;

    // Check neighboring chunks
    const canPlace = checkNeighboringChunks(point.x, point.y, "medium");

    if (canPlace) {
      point.isActuallyMed = true;
      point.spawnerType = "medium";

      const spawner = {
        point: new THREE.Vector3(point.x, 0, point.y),
        element: Apartment,
      };

      chunkSpawners.push(spawner);

      // Add to spatial index
      addToSpatialIndex(spawner, chunkKey);
    }
  }

  // Phase 5: Process small spawners (most numerous, lowest priority)
  // Small spawners only need to be processed for the actual chunk
  const smallPoints = chunkPoints
    .filter((point) => point.main_grid && !point.isXXL && !point.isLarge && !point.spawnerType)
    .sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));

  // Batch process small spawners for better performance
  for (const point of smallPoints) {
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
    const canPlace = checkNeighboringChunks(point.x, point.y, "small");
    if (!canPlace) continue;

    // If it passes all checks, add the small spawner
    point.spawnerType = "small";

    const spawner = {
      point: new THREE.Vector3(point.x, 0, point.y),
      element: Beeple,
    };

    chunkSpawners.push(spawner);

    // Add to spatial index - optional for small since they're lowest priority
    addToSpatialIndex(spawner, chunkKey);
  }

  // Cache the results for this chunk
  globalSpawnerCache.set(chunkKey, chunkSpawners);

  return chunkSpawners;
};

// Main function that returns spawners for the player's current position - optimized
export const getSpawnPoints = async (dimension: Dimension, playerX: number, playerY: number): Promise<Spawner[]> => {
  // Get nearby chunk keys based on player position
  const chunkKeys = getNearbyChunkKeys(playerX, playerY);

  // Sort chunk keys by distance from player for deterministic ordering
  const centerChunkX = Math.floor(playerX / CHUNK_SIZE);
  const centerChunkY = Math.floor(playerY / CHUNK_SIZE);

  chunkKeys.sort((a, b) => {
    const [ax, ay] = a.split("_").map(Number);
    const [bx, by] = b.split("_").map(Number);

    const distA = Math.pow(ax - centerChunkX, 2) + Math.pow(ay - centerChunkY, 2);
    const distB = Math.pow(bx - centerChunkX, 2) + Math.pow(by - centerChunkY, 2);

    return distA - distB;
  });

  // Process chunks sequentially instead of in parallel to avoid race conditions
  const allSpawners: Spawner[] = [];

  for (const chunkKey of chunkKeys) {
    const spawners = await generateChunkSpawners(dimension, chunkKey);
    allSpawners.push(...spawners);
  }

  // Filter to show only spawners within render distance - use squared distance
  const renderDistanceSquared = OBJECT_RENDER_DISTANCE * OBJECT_RENDER_DISTANCE;
  const visibleSpawners = allSpawners.filter((spawner) => {
    const dx = spawner.point.x - playerX;
    const dz = spawner.point.z - playerY;
    const distanceSquared = dx * dx + dz * dz;
    return distanceSquared <= renderDistanceSquared;
  });

  return visibleSpawners;
};
