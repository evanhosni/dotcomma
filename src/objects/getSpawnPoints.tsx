import * as THREE from "three";
import { Apartment } from "../dimensions/glitch-city/biomes/city/blocks/apartment/Apartment";
import { Beeple } from "../dimensions/glitch-city/biomes/city/creatures/beeple/Beeple";
import { BigBeeple } from "../dimensions/glitch-city/biomes/city/creatures/big-beeple/BigBeeple";
// Import the new XL and XXL elements (you'll need to create these)
import { XLElement } from "../dimensions/glitch-city/biomes/city/creatures/xl-element/XLElement"; // Create this
import { XXLElement } from "../dimensions/glitch-city/biomes/city/creatures/xxl-element/XXLElement"; // Create this
import { _math } from "../utils/math/_math";
import { Dimension, Spawner } from "../world/types";
import { OBJECT_RENDER_DISTANCE } from "./ObjectPool";

// Static grid configurations
const GRID_SIZE = 50;
const OFFSET_GRID = 0.5 * GRID_SIZE;
const BUFFER = 2 * GRID_SIZE;

// Define a fixed chunk size for the world - always aligned to grid
const CHUNK_SIZE = 5 * GRID_SIZE; // Each chunk is 5x5 grid cells

// Spawner type definitions
type SpawnerType = "small" | "medium" | "large" | "xl" | "xxl";

// Spacing requirements for each spawner type
const SPACING_REQUIREMENTS: Record<SpawnerType, Record<SpawnerType, number>> = {
  small: {
    small: GRID_SIZE / 2,
    medium: GRID_SIZE,
    large: 2 * GRID_SIZE,
    xl: 2.5 * GRID_SIZE,
    xxl: 3 * GRID_SIZE,
  },
  medium: {
    small: GRID_SIZE,
    medium: 2 * GRID_SIZE,
    large: 2.5 * GRID_SIZE,
    xl: 3 * GRID_SIZE,
    xxl: 3.5 * GRID_SIZE,
  },
  large: {
    small: 2 * GRID_SIZE,
    medium: 2.5 * GRID_SIZE,
    large: 3 * GRID_SIZE,
    xl: 3.5 * GRID_SIZE,
    xxl: 4 * GRID_SIZE,
  },
  xl: {
    small: 2.5 * GRID_SIZE,
    medium: 3 * GRID_SIZE,
    large: 3.5 * GRID_SIZE,
    xl: 4 * GRID_SIZE,
    xxl: 4.5 * GRID_SIZE,
  },
  xxl: {
    small: 3 * GRID_SIZE,
    medium: 3.5 * GRID_SIZE,
    large: 4 * GRID_SIZE,
    xl: 4.5 * GRID_SIZE,
    xxl: 5 * GRID_SIZE,
  },
};

// Map spawner types to their element classes
const SPAWNER_ELEMENTS: Record<SpawnerType, any> = {
  small: Beeple,
  medium: Apartment,
  large: BigBeeple,
  xl: XLElement,
  xxl: XXLElement,
};

// Global cache of determined spawners - permanent for the session
const globalSpawnerCache = new Map<string, Spawner[]>();

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

// Deterministic random functions with position-based seeds
const isXXLAtPosition = (x: number, y: number): boolean => {
  // Create a position-based seed
  const positionSeed = _math.seedRand(`xxl_${Math.floor(x / GRID_SIZE)}_${Math.floor(y / GRID_SIZE)}`);
  // Even rarer than large - 1/80 probability
  return Math.floor(positionSeed * 80) === 0;
};

const isLargeAtPosition = (x: number, y: number): boolean => {
  // Check if this position is taken by XXL first
  if (isXXLAtPosition(x, y)) return false;

  // Create a position-based seed that's consistent regardless of player approach
  const positionSeed = _math.seedRand(`large_${Math.floor(x / GRID_SIZE)}_${Math.floor(y / GRID_SIZE)}`);
  // 1/40 probability of being large
  return Math.floor(positionSeed * 40) === 0;
};

const isXLAtPosition = (x: number, y: number): boolean => {
  // Position-based seed for XL spawners
  const positionSeed = _math.seedRand(`xl_${Math.floor(x / OFFSET_GRID)}_${Math.floor(y / OFFSET_GRID)}`);
  // 1/10 probability of being XL (less common than medium, more common than large)
  return Math.floor(positionSeed * 10) === 0;
};

const isMedAtPosition = (x: number, y: number): boolean => {
  // Don't allow medium where XL already exists
  if (isXLAtPosition(x, y)) return false;

  // Position-based seed for medium spawners
  const positionSeed = _math.seedRand(`medium_${Math.floor(x / OFFSET_GRID)}_${Math.floor(y / OFFSET_GRID)}`);
  // 1/3 probability of being medium
  return Math.floor(positionSeed * 3) === 0;
};

// Helper function to get deterministic chunk key from world coordinates
const getChunkKey = (x: number, y: number): string => {
  // Align to chunk boundaries for consistent keys regardless of player position
  const chunkX = Math.floor(x / CHUNK_SIZE);
  const chunkY = Math.floor(y / CHUNK_SIZE);
  return `${chunkX}_${chunkY}`;
};

// Get nearby chunk keys from player position
const getNearbyChunkKeys = (playerX: number, playerY: number): string[] => {
  const centerChunkX = Math.floor(playerX / CHUNK_SIZE);
  const centerChunkY = Math.floor(playerY / CHUNK_SIZE);
  const viewDistance = Math.ceil(OBJECT_RENDER_DISTANCE / CHUNK_SIZE) + 1;

  const chunkKeys: string[] = [];

  for (let dx = -viewDistance; dx <= viewDistance; dx++) {
    for (let dy = -viewDistance; dy <= viewDistance; dy++) {
      const chunkX = centerChunkX + dx;
      const chunkY = centerChunkY + dy;

      // Calculate distance to chunk center to skip far chunks
      const chunkCenterX = (chunkX + 0.5) * CHUNK_SIZE;
      const chunkCenterY = (chunkY + 0.5) * CHUNK_SIZE;
      const distToChunk = Math.sqrt(Math.pow(playerX - chunkCenterX, 2) + Math.pow(playerY - chunkCenterY, 2));

      if (distToChunk <= OBJECT_RENDER_DISTANCE + CHUNK_SIZE) {
        chunkKeys.push(`${chunkX}_${chunkY}`);
      }
    }
  }

  return chunkKeys;
};

// Direct distance calculation helper for safety checks
const checkDistanceDirectly = (x1: number, y1: number, x2: number, z2: number): number => {
  return Math.sqrt(Math.pow(x1 - x2, 2) + Math.pow(y1 - z2, 2));
};

// Improved check for neighboring spawners across chunks
const checkNeighboringChunks = async (
  dimension: Dimension,
  pointX: number,
  pointY: number,
  spawnerType: SpawnerType
): Promise<boolean> => {
  // Calculate which chunks could contain spawners that are too close
  // Add extra padding to ensure we catch everything
  const maxSpacing = Math.max(...Object.values(SPACING_REQUIREMENTS[spawnerType]).map((val) => val));

  const chunkRadius = Math.ceil((maxSpacing + GRID_SIZE) / CHUNK_SIZE) + 1;
  const centerChunkX = Math.floor(pointX / CHUNK_SIZE);
  const centerChunkY = Math.floor(pointY / CHUNK_SIZE);

  // Check all potentially overlapping chunks
  for (let dx = -chunkRadius; dx <= chunkRadius; dx++) {
    for (let dy = -chunkRadius; dy <= chunkRadius; dy++) {
      const neighborChunkX = centerChunkX + dx;
      const neighborChunkY = centerChunkY + dy;
      const neighborChunkKey = `${neighborChunkX}_${neighborChunkY}`;

      // Skip if this is a chunk we haven't processed yet
      if (!globalSpawnerCache.has(neighborChunkKey)) continue;

      // Check against existing spawners in this chunk
      const chunkSpawners = globalSpawnerCache.get(neighborChunkKey)!;

      for (const spawner of chunkSpawners) {
        // Determine the type of existing spawner
        let existingType: SpawnerType;
        if (spawner.element === Beeple) existingType = "small";
        else if (spawner.element === Apartment) existingType = "medium";
        else if (spawner.element === BigBeeple) existingType = "large";
        else if (spawner.element === XLElement) existingType = "xl";
        else if (spawner.element === XXLElement) existingType = "xxl";
        else continue; // Skip if not one of our managed types

        // Get required minimum distance between these two types
        const minDistance = SPACING_REQUIREMENTS[spawnerType][existingType];
        const minDistanceSquared = minDistance * minDistance;

        // Compare coordinates with correct mapping
        const distanceSquared = Math.pow(pointX - spawner.point.x, 2) + Math.pow(pointY - spawner.point.z, 2);

        // If too close, return false
        if (distanceSquared < minDistanceSquared) {
          return false;
        }
      }
    }
  }

  // If we get here, point is far enough from all existing spawners
  return true;
};

// Primary function to generate spawners for a specific chunk
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

  // Create expanded grid for proper neighbor checking
  const maxSpacing = Math.max(...Object.values(SPACING_REQUIREMENTS.xxl).map((val) => val));
  const expansionBuffer = maxSpacing; // Use the maximum spacing requirement
  const expandedMinX = chunkMinX - expansionBuffer;
  const expandedMaxX = chunkMaxX + expansionBuffer;
  const expandedMinY = chunkMinY - expansionBuffer;
  const expandedMaxY = chunkMaxY + expansionBuffer;

  // Generate all grid points in expanded chunk
  const grid: Record<string, GridPoint> = {};
  const promises: Promise<void>[] = [];

  // Generate main grid points (for large and XXL)
  for (let x = expandedMinX; x <= expandedMaxX; x += GRID_SIZE) {
    for (let y = expandedMinY; y <= expandedMaxY; y += GRID_SIZE) {
      const id = `${x}_${y}`;
      const isXXL = isXXLAtPosition(x, y);
      const isLarge = isLargeAtPosition(x, y);

      // Fetch vertex data for all points in buffer zone
      const promise = dimension.getVertexData(x, y).then((vertexData) => {
        grid[id] = {
          id,
          x,
          y,
          vertexData,
          main_grid: true,
          offset_grid: false,
          isLarge,
          isXXL,
          isMed: false,
          isXL: false,
        };
      });

      promises.push(promise);
    }
  }

  // Generate offset grid points (for medium and XL)
  for (let x = expandedMinX + OFFSET_GRID; x < expandedMaxX; x += GRID_SIZE) {
    for (let y = expandedMinY + OFFSET_GRID; y < expandedMaxY; y += GRID_SIZE) {
      const id = `${x}_${y}`;
      const isXL = isXLAtPosition(x, y);
      const isMed = isMedAtPosition(x, y);

      // Fetch vertex data for all points in buffer zone
      const promise = dimension.getVertexData(x, y).then((vertexData) => {
        grid[id] = {
          id,
          x,
          y,
          vertexData,
          main_grid: false,
          offset_grid: true,
          isLarge: false,
          isXXL: false,
          isMed,
          isXL,
        };
      });

      promises.push(promise);
    }
  }

  // Wait for all vertex data to be fetched
  await Promise.all(promises);

  // Get quick lookup function
  const getGridPoint = (x: number, y: number): GridPoint | undefined => {
    return grid[`${x}_${y}`];
  };

  // Filter grid to points inside the actual chunk (without buffer)
  const chunkPoints = Object.values(grid).filter(
    (point) => point.x >= chunkMinX && point.x < chunkMaxX && point.y >= chunkMinY && point.y < chunkMaxY
  );

  // The actual spawners for this chunk
  const chunkSpawners: Spawner[] = [];

  // Process order: XXL (biggest) -> XL -> Large -> Medium -> Small (smallest)
  // This ensures that bigger and rarer elements get priority

  // Phase 1: Process XXL spawners (biggest, rarest, highest priority)
  const xxlPoints = Object.values(grid)
    .filter((point) => point.main_grid && point.isXXL)
    .sort((a, b) => {
      if (a.x !== b.x) return a.x - b.x;
      return a.y - b.y;
    });

  for (const point of xxlPoints) {
    // Skip if outside this chunk
    if (!(point.x >= chunkMinX && point.x < chunkMaxX && point.y >= chunkMinY && point.y < chunkMaxY)) {
      continue;
    }

    // Check neighboring chunks for any spawners that would conflict
    const canPlace = await checkNeighboringChunks(dimension, point.x, point.y, "xxl");

    if (canPlace) {
      point.isActuallyXXL = true;
      point.spawnerType = "xxl";

      chunkSpawners.push({
        point: new THREE.Vector3(point.x, 0, point.y),
        element: XXLElement,
      });
    }
  }

  // Phase 2: Process XL spawners
  const xlPoints = Object.values(grid)
    .filter((point) => point.offset_grid && point.isXL)
    .sort((a, b) => {
      if (a.x !== b.x) return a.x - b.x;
      return a.y - b.y;
    });

  for (const point of xlPoints) {
    // Skip if outside this chunk
    if (!(point.x >= chunkMinX && point.x < chunkMaxX && point.y >= chunkMinY && point.y < chunkMaxY)) {
      continue;
    }

    // Check spacing against all existing spawners in this chunk
    let tooClose = false;

    // Check against existing spawners in the grid
    for (const existingPoint of Object.values(grid)) {
      // Only check against points marked as actual spawners
      if (!existingPoint.spawnerType) continue;

      // Calculate exact distance
      const distanceSquared = Math.pow(point.x - existingPoint.x, 2) + Math.pow(point.y - existingPoint.y, 2);

      // Get minimum required distance
      const minDistance = SPACING_REQUIREMENTS["xl"][existingPoint.spawnerType];

      // Check against minimum distance
      if (distanceSquared < minDistance * minDistance) {
        tooClose = true;
        break;
      }
    }

    // Skip if too close to existing spawners
    if (tooClose) continue;

    // Check neighboring chunks
    const canPlace = await checkNeighboringChunks(dimension, point.x, point.y, "xl");

    if (canPlace) {
      point.isActuallyXL = true;
      point.spawnerType = "xl";

      chunkSpawners.push({
        point: new THREE.Vector3(point.x, 0, point.y),
        element: XLElement,
      });
    }
  }

  // Phase 3: Process large spawners
  const largePoints = Object.values(grid)
    .filter((point) => point.main_grid && point.isLarge)
    .sort((a, b) => {
      if (a.x !== b.x) return a.x - b.x;
      return a.y - b.y;
    });

  for (const point of largePoints) {
    // Skip if outside this chunk
    if (!(point.x >= chunkMinX && point.x < chunkMaxX && point.y >= chunkMinY && point.y < chunkMaxY)) {
      continue;
    }

    // Check spacing against all existing spawners in this chunk
    let tooClose = false;

    // Check against existing spawners in the grid
    for (const existingPoint of Object.values(grid)) {
      // Only check against points marked as actual spawners
      if (!existingPoint.spawnerType) continue;

      // Calculate exact distance
      const distanceSquared = Math.pow(point.x - existingPoint.x, 2) + Math.pow(point.y - existingPoint.y, 2);

      // Get minimum required distance
      const minDistance = SPACING_REQUIREMENTS["large"][existingPoint.spawnerType];

      // Check against minimum distance
      if (distanceSquared < minDistance * minDistance) {
        tooClose = true;
        break;
      }
    }

    // Skip if too close to existing spawners
    if (tooClose) continue;

    // Check neighboring chunks
    const canPlace = await checkNeighboringChunks(dimension, point.x, point.y, "large");

    if (canPlace) {
      point.isActuallyLarge = true;
      point.spawnerType = "large";

      chunkSpawners.push({
        point: new THREE.Vector3(point.x, 0, point.y),
        element: BigBeeple,
      });
    }
  }

  // Phase 4: Process medium spawners
  const mediumPoints = Object.values(grid)
    .filter((point) => point.offset_grid && point.isMed)
    .sort((a, b) => {
      if (a.x !== b.x) return a.x - b.x;
      return a.y - b.y;
    });

  for (const point of mediumPoints) {
    // Skip if outside this chunk
    if (!(point.x >= chunkMinX && point.x < chunkMaxX && point.y >= chunkMinY && point.y < chunkMaxY)) {
      continue;
    }

    // Check spacing against all existing spawners in this chunk
    let tooClose = false;

    // Check against existing spawners in the grid
    for (const existingPoint of Object.values(grid)) {
      // Only check against points marked as actual spawners
      if (!existingPoint.spawnerType) continue;

      // Calculate exact distance
      const distanceSquared = Math.pow(point.x - existingPoint.x, 2) + Math.pow(point.y - existingPoint.y, 2);

      // Get minimum required distance
      const minDistance = SPACING_REQUIREMENTS["medium"][existingPoint.spawnerType];

      // Check against minimum distance
      if (distanceSquared < minDistance * minDistance) {
        tooClose = true;
        break;
      }
    }

    // Skip if too close to existing spawners
    if (tooClose) continue;

    // Check neighboring chunks
    const canPlace = await checkNeighboringChunks(dimension, point.x, point.y, "medium");

    if (canPlace) {
      point.isActuallyMed = true;
      point.spawnerType = "medium";

      chunkSpawners.push({
        point: new THREE.Vector3(point.x, 0, point.y),
        element: Apartment,
      });
    }
  }

  // Phase 5: Process small spawners (lowest priority)
  const smallPoints = chunkPoints
    .filter(
      (point) =>
        point.main_grid &&
        !point.isXXL &&
        !point.isLarge &&
        !point.spawnerType &&
        point.x >= chunkMinX &&
        point.x < chunkMaxX &&
        point.y >= chunkMinY &&
        point.y < chunkMaxY
    )
    .sort((a, b) => {
      if (a.x !== b.x) return a.x - b.x;
      return a.y - b.y;
    });

  // Helper function to check if a point has a spawner of specified type nearby
  const hasNearbySpawnerType = (point: GridPoint, spawnerType: SpawnerType, checkRadius: number): boolean => {
    const checkRadiusSquared = checkRadius * checkRadius;

    for (const existingPoint of Object.values(grid)) {
      // Only check against points marked as the specified spawner type
      if (existingPoint.spawnerType !== spawnerType) continue;

      // Calculate exact distance
      const distanceSquared = Math.pow(point.x - existingPoint.x, 2) + Math.pow(point.y - existingPoint.y, 2);

      // Check against radius
      if (distanceSquared < checkRadiusSquared) {
        return true;
      }
    }

    return false;
  };

  // Check direct neighbors in global cache for safety (similar to original script)
  const hasNearbySpawnerInCache = (point: GridPoint, spawnerType: SpawnerType, checkRadius: number): boolean => {
    const checkRadiusSquared = checkRadius * checkRadius;

    // Get all cached spawners
    for (const [cachedChunkKey, cachedSpawners] of globalSpawnerCache.entries() as any) {
      for (const spawner of cachedSpawners) {
        // Only check against the relevant spawner type
        const isRelevantType = spawner.element === SPAWNER_ELEMENTS[spawnerType];
        if (!isRelevantType) continue;

        // Direct distance check with correct coordinates
        const distanceSquared = Math.pow(point.x - spawner.point.x, 2) + Math.pow(point.y - spawner.point.z, 2);

        if (distanceSquared < checkRadiusSquared) {
          return true;
        }
      }
    }

    return false;
  };

  for (const point of smallPoints) {
    // First check for large and larger neighbors (similar to original script)
    if (hasNearbySpawnerType(point, "xxl", SPACING_REQUIREMENTS["small"]["xxl"])) continue;
    if (hasNearbySpawnerType(point, "xl", SPACING_REQUIREMENTS["small"]["xl"])) continue;
    if (hasNearbySpawnerType(point, "large", SPACING_REQUIREMENTS["small"]["large"])) continue;

    // Extra safety: Check in global cache too
    if (hasNearbySpawnerInCache(point, "xxl", SPACING_REQUIREMENTS["small"]["xxl"])) continue;
    if (hasNearbySpawnerInCache(point, "xl", SPACING_REQUIREMENTS["small"]["xl"])) continue;
    if (hasNearbySpawnerInCache(point, "large", SPACING_REQUIREMENTS["small"]["large"])) continue;

    // Then check medium spawners
    if (hasNearbySpawnerType(point, "medium", SPACING_REQUIREMENTS["small"]["medium"])) continue;
    if (hasNearbySpawnerInCache(point, "medium", SPACING_REQUIREMENTS["small"]["medium"])) continue;

    // Check other small spawners too
    if (hasNearbySpawnerType(point, "small", SPACING_REQUIREMENTS["small"]["small"])) continue;

    // Additional comprehensive check
    let tooClose = false;

    // Check against existing spawners in the grid
    for (const existingPoint of Object.values(grid)) {
      // Only check against points marked as actual spawners
      if (!existingPoint.spawnerType) continue;

      // Calculate exact distance
      const distanceSquared = Math.pow(point.x - existingPoint.x, 2) + Math.pow(point.y - existingPoint.y, 2);

      // Get minimum required distance
      const minDistance = SPACING_REQUIREMENTS["small"][existingPoint.spawnerType];

      // Check against minimum distance
      if (distanceSquared < minDistance * minDistance) {
        tooClose = true;
        break;
      }
    }

    // Skip if too close to existing spawners
    if (tooClose) continue;

    // Final check with neighboring chunks (similar to medium spawners in original)
    const canPlace = await checkNeighboringChunks(dimension, point.x, point.y, "small");
    if (!canPlace) continue;

    // If it passes all checks, add the small spawner
    point.spawnerType = "small";

    chunkSpawners.push({
      point: new THREE.Vector3(point.x, 0, point.y),
      element: Beeple,
    });
  }

  // Cache the results for this chunk
  globalSpawnerCache.set(chunkKey, chunkSpawners);

  return chunkSpawners;
};

// Main function that returns spawners for the player's current position
export const getSpawnPoints = async (dimension: Dimension, playerX: number, playerY: number): Promise<Spawner[]> => {
  // Get nearby chunk keys based on player position
  const chunkKeys = getNearbyChunkKeys(playerX, playerY);

  // Sort chunk keys by distance from player for deterministic ordering
  chunkKeys.sort((a, b) => {
    const [ax, ay] = a.split("_").map(Number);
    const [bx, by] = b.split("_").map(Number);

    const distA =
      Math.pow(ax - Math.floor(playerX / CHUNK_SIZE), 2) + Math.pow(ay - Math.floor(playerY / CHUNK_SIZE), 2);
    const distB =
      Math.pow(bx - Math.floor(playerX / CHUNK_SIZE), 2) + Math.pow(by - Math.floor(playerY / CHUNK_SIZE), 2);

    return distA - distB;
  });

  // Process chunks sequentially instead of in parallel to avoid race conditions
  const allSpawners: Spawner[] = [];

  for (const chunkKey of chunkKeys) {
    const spawners = await generateChunkSpawners(dimension, chunkKey);
    allSpawners.push(...spawners);
  }

  // Filter to show only spawners within render distance
  const renderDistanceSquared = OBJECT_RENDER_DISTANCE * OBJECT_RENDER_DISTANCE;
  const visibleSpawners = allSpawners.filter((spawner) => {
    const dx = spawner.point.x - playerX;
    const dz = spawner.point.z - playerY;
    const distanceSquared = dx * dx + dz * dz;
    return distanceSquared <= renderDistanceSquared;
  });

  return visibleSpawners;
};

// For debugging and testing
export const _testing = {
  clearCache: () => {
    globalSpawnerCache.clear();
  },
  getCacheStats: () => ({
    chunks: globalSpawnerCache.size,
    totalSpawners: Array.from(globalSpawnerCache.values()).reduce((acc, spawners) => acc + spawners.length, 0),
    spawnerCounts: Array.from(globalSpawnerCache.values())
      .flat()
      .reduce((counts, spawner) => {
        if (spawner.element === Beeple) counts.small = (counts.small || 0) + 1;
        else if (spawner.element === Apartment) counts.medium = (counts.medium || 0) + 1;
        else if (spawner.element === BigBeeple) counts.large = (counts.large || 0) + 1;
        else if (spawner.element === XLElement) counts.xl = (counts.xl || 0) + 1;
        else if (spawner.element === XXLElement) counts.xxl = (counts.xxl || 0) + 1;
        return counts;
      }, {} as Record<string, number>),
  }),
  getChunkSpawners: (chunkKey: string) => globalSpawnerCache.get(chunkKey) || [],
};
