import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { reportContentError } from "../../utils/contentError";
import { SPAWN_CHUNK_SIZE } from "../../utils/workers/constants";
import { meshTemplate, warmPrograms } from "../../utils/warmPrograms";
import { getActiveDomainConfig } from "../../world/domains/utils";
import { despawnRadiusOf, spawnRadiusOf } from "../actors/spawning/radii";
import type { ActorWarmupHooks, AnyActorDescriptor, SerializedActorDescriptor } from "../actors/spawning/types";
import { onSpriteDetail } from "./detail";
import { LookMesh } from "./LookMesh";
import { SPRITE_UNIFORMS } from "./spriteMaterial";
import {
  initSpriteWorkers,
  type LoadedSpriteChunk,
  loadedSpriteChunks,
  resetSpriteWorkers,
  spriteChunksVersion,
  spriteLoadingStats,
  updateSpriteLoading,
} from "./spriteWorker";
import type { SpriteKind, SpriteLook } from "./types";
import { spriteClock } from "./utils";

/**
 * THE SPRITE TIER (sprite-lod/README.md): every loaded sprite of one look in one instanced draw, rebased near
 * the camera, its per-instance detail kept in step with the actors' handoff reports (detail.ts).
 */

/** The camera may stray this far (u) from the rebase origin before everything is repacked around a new one. */
const REBASE_DISTANCE = 1000;

/** Only structured-clone-safe values can reach the generator threads. */
const isPlainData = (value: unknown): boolean => {
  if (typeof value === "function" || typeof value === "symbol") return false;
  if (value === null || typeof value !== "object") return true;
  if (Array.isArray(value)) return value.every(isPlainData);
  return Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(isPlainData);
};

/** Every descriptor with a `spriteLod`, by id. A kind whose member has no look, or two looks under one
 *  describer, are content errors. */
export const spriteKindsOf = (descriptors: AnyActorDescriptor[]): Map<string, SpriteKind> => {
  const kinds = new Map<string, SpriteKind>();
  const looks = new Map<string, SpriteLook>();
  for (const desc of descriptors) {
    if (!desc.spriteLod) continue;
    const look = (desc.component as ActorWarmupHooks).spriteLook;
    if (!look) {
      reportContentError(
        `[sprite-lod] "${desc.id}" has a spriteLod but its member component has no static \`spriteLook\` ` +
          `(ActorWarmupHooks): nothing would stand in for it past its renderDistance. Give the member a look or drop the spriteLod.`,
      );
      continue;
    }
    if ((looks.get(look.describer) ?? look) !== look) {
      reportContentError(`[sprite-lod] two different looks use the describer "${look.describer}": one look per describer.`);
      continue;
    }
    looks.set(look.describer, look);
    const attributes = Object.fromEntries(Object.entries(desc).filter(([key, value]) => key !== "component" && isPlainData(value)));
    kinds.set(desc.id, {
      look,
      footprint: desc.footprint,
      source: { id: desc.id, describer: look.describer, renderDistance: desc.spriteLod.renderDistance, attributes },
    });
  }
  return kinds;
};

/** Brings every look's buffer to the loaded set: a chunk that left (or was reloaded) leaves, a new one joins,
 *  its offsets moved from its corner onto the rebase origin in float64. */
const syncLoaded = (lookMeshes: Map<string, LookMesh>, drawn: Map<number, LoadedSpriteChunk>, originX: number, originZ: number): void => {
  const loaded = loadedSpriteChunks();
  drawn.forEach((chunk, key) => {
    if (loaded.get(key) === chunk) return;
    drawn.delete(key);
    for (const { describer, ids } of chunk.looks) lookMeshes.get(describer)?.remove(ids);
  });
  loaded.forEach((chunk, key) => {
    if (drawn.has(key)) return;
    drawn.set(key, chunk);
    for (const look of chunk.looks) lookMeshes.get(look.describer)?.add(look, chunk.minX - originX, chunk.minZ - originZ, chunk.born);
  });
};

interface SpriteLodsProps {
  kinds: Map<string, SpriteKind>;
  /** Every actor kind, as the pool sends them to its worker. */
  descriptors: SerializedActorDescriptor[];
  maxFootprint: number;
}

/** Mounted by ActorPool with the pool's own kinds and spacing. */
export const SpriteLods = ({ kinds, descriptors, maxFootprint }: SpriteLodsProps) => {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const lookMeshesRef = useRef(new Map<string, LookMesh>());
  // placed: the meshes sit at the origin and hold every chunk in `drawn`, as of the loaded set's `version`.
  const renderedRef = useRef({ placed: false, version: -1, originX: 0, originZ: 0 });
  const drawnRef = useRef(new Map<number, LoadedSpriteChunk>());

  useEffect(() => {
    const lookMeshes = new Map<string, LookMesh>();
    kinds.forEach(({ look }) => {
      if (!lookMeshes.has(look.describer)) lookMeshes.set(look.describer, new LookMesh(look));
    });
    lookMeshes.forEach(({ mesh }) => scene.add(mesh));
    lookMeshesRef.current = lookMeshes;
    renderedRef.current.placed = false;
    const cancelWarm = warmPrograms(scene, Array.from(lookMeshes.values(), ({ mesh }) => meshTemplate(mesh.material)));
    // Written in the frame the actor reports it, so the complementary pixels land in the same draw.
    const stopDetail = onSpriteDetail((id, visibility) => {
      for (const lookMesh of lookMeshes.values()) if (lookMesh.writeDetail(id, visibility)) return;
    });
    return () => {
      stopDetail();
      cancelWarm();
      lookMeshes.forEach((lookMesh) => {
        scene.remove(lookMesh.mesh);
        lookMesh.dispose();
      });
      lookMeshesRef.current = new Map();
    };
  }, [scene, kinds]);

  useEffect(() => {
    const sprites = Array.from(kinds.values());
    if (sprites.length === 0) return;
    const tiers = sprites.map(({ source, footprint }) => ({ renderDistance: source.renderDistance, footprint }));
    initSpriteWorkers({
      config: getActiveDomainConfig(),
      maxFootprint,
      descriptors,
      kinds: sprites.map(({ source }) => source),
      reach: Math.max(...tiers.map(spawnRadiusOf)),
      dropDistance: Math.max(...tiers.map(despawnRadiusOf)),
    });
    return resetSpriteWorkers;
  }, [kinds, descriptors, maxFootprint]);

  useEffect(() => {
    (window as any).__spriteLod = () => {
      const { originX, originZ } = renderedRef.current;
      return {
        ...spriteLoadingStats(),
        sprites: Array.from(lookMeshesRef.current.values(), ({ look, mesh, drawCap }) => ({
          look: look.describer,
          instances: mesh.geometry.instanceCount,
          drawCap,
          visible: mesh.visible,
          inScene: mesh.parent !== null,
        })),
        camera: [Math.round(camera.position.x), Math.round(camera.position.z)],
        origin: [originX, originZ],
      };
    };
    return () => {
      delete (window as any).__spriteLod;
    };
  }, [camera]);

  useFrame((state) => {
    const { x, y, z } = state.camera.position;
    updateSpriteLoading(x, z);

    const rendered = renderedRef.current;
    const lookMeshes = lookMeshesRef.current;
    const drawn = drawnRef.current;
    // Arrivals and evictions only touch their own sprites; moving the origin repacks everything around it.
    if (!rendered.placed || Math.hypot(x - rendered.originX, z - rendered.originZ) >= REBASE_DISTANCE) {
      rendered.placed = true;
      rendered.version = -1;
      rendered.originX = Math.floor(x / SPAWN_CHUNK_SIZE) * SPAWN_CHUNK_SIZE;
      rendered.originZ = Math.floor(z / SPAWN_CHUNK_SIZE) * SPAWN_CHUNK_SIZE;
      drawn.clear();
      lookMeshes.forEach((lookMesh) => {
        lookMesh.clear();
        lookMesh.placeAt(rendered.originX, rendered.originZ);
      });
    }
    const version = spriteChunksVersion();
    if (version !== rendered.version) {
      rendered.version = version;
      syncLoaded(lookMeshes, drawn, rendered.originX, rendered.originZ);
    }

    SPRITE_UNIFORMS.uSpriteCamera.value.set(x - rendered.originX, y, z - rendered.originZ);
    SPRITE_UNIFORMS.uSpriteTime.value = spriteClock();
    lookMeshes.forEach(({ look }) => look.update?.());
  });

  return null;
};
