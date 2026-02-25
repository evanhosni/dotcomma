import { useHeightfield } from "@react-three/cannon";
import { useFrame, useThree } from "@react-three/fiber";
import React, { useEffect, useState } from "react";
import * as THREE from "three";
import { useGameContext } from "../../context/GameContext";
import { Dimension } from "../types";
import { LOD_LEVELS, LODLevel } from "./lodConfig";
import { Chunk, TerrainColliderProps, TerrainProps } from "./types";

export const CHUNK_SIZE = 420;

const terrain: TerrainProps = {
  group: new THREE.Group(),
  chunks: {},
  active_chunk: null,
  queued_to_build: [],
  queued_to_destroy: [],
};

const computeDesiredChunks = (playerX: number, playerZ: number) => {
  const desired: { [key: string]: { position: number[]; lod: LODLevel } } = {};

  // Single grid — every cell is CHUNK_SIZE. Each cell gets the finest LOD whose
  // maxDistance covers it. LOD level is part of the key so that a resolution
  // change triggers a rebuild.

  const coarsest = LOD_LEVELS[LOD_LEVELS.length - 1];
  const radius = Math.ceil(coarsest.maxDistance / CHUNK_SIZE);

  const playerGridX = Math.floor(playerX / CHUNK_SIZE);
  const playerGridZ = Math.floor(playerZ / CHUNK_SIZE);

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const cx = playerGridX + dx;
      const cz = playerGridZ + dz;

      // Distance from player to the center of this cell
      const cellCenterX = (cx + 0.5) * CHUNK_SIZE;
      const cellCenterZ = (cz + 0.5) * CHUNK_SIZE;
      const dist = Math.sqrt(
        (cellCenterX - playerX) ** 2 + (cellCenterZ - playerZ) ** 2
      );

      // Find the finest LOD that covers this distance
      let bestLod: LODLevel | null = null;
      for (const lod of LOD_LEVELS) {
        if (dist <= lod.maxDistance) {
          bestLod = lod;
          break; // LOD_LEVELS is sorted finest-first (level 0, 1, 2)
        }
      }

      if (!bestLod) continue; // beyond all LOD ranges

      desired[`${bestLod.level}/${cx}/${cz}`] = {
        position: [cx, cz],
        lod: bestLod,
      };
    }
  }

  return desired;
};

// Check if any unbuilt chunk shares the same grid position (same x/z)
const hasUnbuiltOverlap = (targetChunk: Chunk): boolean => {
  const tx = targetChunk.offset.x;
  const tz = targetChunk.offset.y;

  for (const key in terrain.chunks) {
    const other = terrain.chunks[key].chunk;
    if (other === targetChunk || other.plane.visible) continue;

    // Same grid position = same offset (all chunks are CHUNK_SIZE)
    if (other.offset.x === tx && other.offset.y === tz) {
      return true;
    }
  }
  return false;
};

export const Terrain = ({ dimension }: { dimension: Dimension }) => {
  const { camera, scene } = useThree();
  const [gameLoaded, setGameLoaded] = useState(false);
  const [remainingChunks, setRemainingChunks] = useState<number | null>(null);
  const [totalChunks, setTotalChunks] = useState<number>(0);
  const [terrainMaterial, setTerrainMaterial] = useState<THREE.Material | null>(null);
  const { terrain_loaded, setProgress, setTerrainLoaded } = useGameContext();

  scene.add(terrain.group);

  useEffect(() => {
    if (!terrain_loaded) {
      if (remainingChunks !== null) {
        setProgress(1 - remainingChunks / totalChunks);
      }
      remainingChunks === 0 && setTerrainLoaded(true);
    }
  }, [remainingChunks, terrain_loaded]);

  useEffect(() => {
    dimension.getMaterial().then(setTerrainMaterial);
  }, []);

  useFrame(() => {
    if (terrainMaterial) {
      UpdateTerrain(terrainMaterial);
    }
  });

  const UpdateTerrain = async (material: THREE.Material) => {
    DestroyChunk(); //TODO still kinda taxing even though it only deletes 1 per frame. optimize deletion somehow

    const playerX = camera.position.x;
    const playerZ = camera.position.z;

    if (terrain.active_chunk) {
      const currentChunk = terrain.active_chunk;
      try {
        const iteratorResult = await terrain.active_chunk.rebuildIterator!.next();
        if (iteratorResult.done) {
          if (terrain.active_chunk === currentChunk) {
            terrain.active_chunk = null;
          }
          if (currentChunk.plane) {
            setTimeout(() => {
              currentChunk.plane.visible = true;
            }, 100);
          }
        }
      } catch (error) {
        console.error("Error updating terrain:", error);
        if (terrain.active_chunk === currentChunk) {
          terrain.active_chunk = null;
        }
      }
    } else {
      // Filter out chunks that have been destroyed, and sort by LOD priority then distance
      if (terrain.queued_to_build.length > 0) {
        terrain.queued_to_build = terrain.queued_to_build.filter((chunk) => {
          // Check if this chunk is still tracked (not destroyed while queued)
          const gridX = Math.round(chunk.offset.x / CHUNK_SIZE);
          const gridZ = Math.round(chunk.offset.y / CHUNK_SIZE);
          const key = `${chunk.lod.level}/${gridX}/${gridZ}`;
          return key in terrain.chunks;
        });

        // Sort so pop() grabs highest priority: LOD 0 first, closest first
        // Array end = highest priority (popped first)
        // So: higher LOD levels earlier in array, furthest earlier in array
        terrain.queued_to_build.sort((a, b) => {
          if (a.lod.level !== b.lod.level) {
            return b.lod.level - a.lod.level;
          }
          const distA = Math.sqrt(
            Math.pow(a.offset.x + CHUNK_SIZE / 2 - playerX, 2) +
              Math.pow(a.offset.y + CHUNK_SIZE / 2 - playerZ, 2)
          );
          const distB = Math.sqrt(
            Math.pow(b.offset.x + CHUNK_SIZE / 2 - playerX, 2) +
              Math.pow(b.offset.y + CHUNK_SIZE / 2 - playerZ, 2)
          );
          return distB - distA;
        });
      }

      const chunk = terrain.queued_to_build.pop();
      if (chunk) {
        terrain.active_chunk = chunk;
        terrain.active_chunk.rebuildIterator = BuildChunk(chunk, material);
      }
    }

    if (!terrain.active_chunk) {
      const desiredChunks = computeDesiredChunks(playerX, playerZ);

      // Remove chunks that are out of range, but only if replacements are visible
      for (const chunkKey in terrain.chunks) {
        if (!desiredChunks[chunkKey] && !terrain.queued_to_destroy.includes(chunkKey)) {
          // Don't destroy if unbuilt replacement chunks overlap this area
          if (!hasUnbuiltOverlap(terrain.chunks[chunkKey].chunk)) {
            terrain.queued_to_destroy.push(chunkKey);
          }
        }
      }

      if (terrain.queued_to_destroy.length > 1) {
        terrain.queued_to_destroy.sort((a, b) => {
          const chunkDataA = terrain.chunks[a];
          const chunkDataB = terrain.chunks[b];

          if (chunkDataA && chunkDataB) {
            // Higher LOD level (less detail) destroyed first
            if (chunkDataA.chunk.lod.level !== chunkDataB.chunk.lod.level) {
              return chunkDataB.chunk.lod.level - chunkDataA.chunk.lod.level;
            }

            // Within same LOD, furthest destroyed first (shift takes from front)
            const distanceA =
              Math.pow(chunkDataA.chunk.offset.x + CHUNK_SIZE / 2 - playerX, 2) +
              Math.pow(chunkDataA.chunk.offset.y + CHUNK_SIZE / 2 - playerZ, 2);
            const distanceB =
              Math.pow(chunkDataB.chunk.offset.x + CHUNK_SIZE / 2 - playerX, 2) +
              Math.pow(chunkDataB.chunk.offset.y + CHUNK_SIZE / 2 - playerZ, 2);

            return distanceB - distanceA;
          }
          return 0;
        });
      }

      // Add new chunks that are within range
      for (const chunkKey in desiredChunks) {
        if (chunkKey in terrain.chunks) {
          continue;
        }

        const { position, lod } = desiredChunks[chunkKey];
        const [xp, zp] = position;
        const offset = new THREE.Vector2(xp * CHUNK_SIZE, zp * CHUNK_SIZE);

        const chunk = QueueChunk(offset, lod, material);
        terrain.chunks[chunkKey] = {
          position: [xp, zp],
          chunk: chunk,
        };
      }
    }

    if (remainingChunks === null) setTotalChunks(terrain.queued_to_build.length);
    setRemainingChunks(terrain.queued_to_build.length);
  };

  const QueueChunk = (offset: THREE.Vector2, lod: LODLevel, material: THREE.Material) => {
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, lod.segments, lod.segments),
      material
    );
    plane.visible = false; //TODO problemA: maybe somewhere around here, not sure. plane flashes briefly at 0,0,0 before moving to its correct spot. one solution is add 50 to the height or smth, but thats too hacky. try to prevent this flashing
    plane.castShadow = false;
    plane.receiveShadow = true;
    plane.rotation.x = -Math.PI / 2;
    const chunk: Chunk = {
      offset: new THREE.Vector2(offset.x, offset.y),
      plane: plane,
      rebuildIterator: null,
      collider: null,
      lod: lod,
    };

    terrain.group.add(plane);
    terrain.queued_to_build.push(chunk);

    return chunk;
  };

  const BuildChunk = async function* (chunk: Chunk, material: THREE.Material) {
    const offset = chunk.offset;
    const pos = chunk.plane.geometry.attributes.position;
    const attributeBuffers: any = {};
    const verts = [];

    for (let i = 0; i < pos.count; i++) {
      const vert = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      verts.push(vert);
    }

    const bulkVertexData = await Promise.all(
      verts.map(async (vert) => {
        const data = await dimension.getVertexData(vert.x + offset.x, -vert.y + offset.y, true);
        return data;
      })
    );

    for (let i = 0; i < pos.count; i++) {
      const vert = verts[i];
      const vertexData = bulkVertexData[i];
      pos.setXYZ(i, vert.x, vert.y, vertexData.height);

      if (i === 0) {
        for (const attrName in vertexData.attributes) {
          attributeBuffers[attrName] = new Float32Array(pos.count);
        }
      }

      for (const attrName in vertexData.attributes) {
        if (attributeBuffers[attrName]) {
          attributeBuffers[attrName][i] = vertexData.attributes[attrName];
        }
      }
    }

    for (const attrName in attributeBuffers) {
      const bufferAttribute = new THREE.BufferAttribute(attributeBuffers[attrName], 1);
      chunk.plane.geometry.setAttribute(attrName, bufferAttribute);
    }

    // Apply material and update geometry immediately
    chunk.plane.material = material;
    chunk.plane.geometry.attributes.position.needsUpdate = true;
    chunk.plane.geometry.computeVertexNormals();
    chunk.plane.position.set(offset.x, 0, offset.y);

    if (chunk.lod.hasCollider) {
      GenerateColliders(chunk, offset);
    }

    yield;
  };

  const DestroyChunk = () => {
    const chunkKey = terrain.queued_to_destroy[0];
    if (!chunkKey) return;

    if (!terrain.chunks[chunkKey]) {
      // Already gone, just remove from queue
      terrain.queued_to_destroy.shift();
      return;
    }

    const chunkData = terrain.chunks[chunkKey];
    const tx = chunkData.chunk.offset.x;
    const tz = chunkData.chunk.offset.y;

    // Don't destroy if a replacement at the same grid position is still building
    for (const otherKey in terrain.chunks) {
      if (otherKey === chunkKey) continue;
      const other = terrain.chunks[otherKey].chunk;
      if (other.offset.x === tx && other.offset.y === tz && !other.plane.visible) {
        return; // replacement exists but isn't ready yet — keep old chunk visible
      }
    }

    terrain.queued_to_destroy.shift();
    if (chunkData.chunk.plane) {
      chunkData.chunk.plane.geometry.dispose();
      terrain.group.remove(chunkData.chunk.plane);
    }
    delete terrain.chunks[chunkKey];
  };

  const GenerateColliders = (chunk: Chunk, offset: THREE.Vector2) => {
    const segments = chunk.lod.segments;
    const linearArray = chunk.plane.geometry.attributes.position.array;
    const gridSize = Math.sqrt(linearArray.length / 3);
    const heightfield = Array.from({ length: gridSize }, () => Array(gridSize).fill(0));

    for (let i = 0; i < linearArray.length; i += 3) {
      const x = linearArray[i];
      const z = linearArray[i + 1];
      const height = linearArray[i + 2];

      const xIndex = Math.round((x - -(CHUNK_SIZE / 2)) / (CHUNK_SIZE / segments));
      const zIndex = Math.round((z - -(CHUNK_SIZE / 2)) / (CHUNK_SIZE / segments));

      const transformedXIndex = segments - xIndex;

      if (
        zIndex >= 0 &&
        zIndex < segments + 1 &&
        transformedXIndex >= 0 &&
        transformedXIndex < segments + 1
      ) {
        heightfield[zIndex][transformedXIndex] = height;
      }
    }

    const chunkKey = `${offset.x / CHUNK_SIZE}/${offset.y / CHUNK_SIZE}`;
    chunk.collider = {
      chunkKey: chunkKey,
      heightfield,
      position: offset.toArray(),
      elementSize: CHUNK_SIZE / segments,
    };
  };

  return (
    <>
      {Object.values(terrain.chunks).map(({ chunk }) => {
        if (chunk.collider) {
          return <TerrainCollider key={chunk.collider.chunkKey} {...chunk.collider} />;
        }
        return null;
      })}
    </>
  );
};

export const TerrainCollider: React.FC<TerrainColliderProps> = ({ heightfield, position, elementSize }) => {
  const [ref] = useHeightfield(() => ({
    args: [heightfield, { elementSize }],
    position: [position[0] + CHUNK_SIZE / 2, 0, position[1] + CHUNK_SIZE / 2],
    rotation: [-Math.PI / 2, 0, Math.PI / 2],
  }));

  return <mesh ref={ref as any} />;
};
