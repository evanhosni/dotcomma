import { useFrame, useThree } from "@react-three/fiber";
import React, { useCallback, useContext, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGameContext } from "../../context/GameContext";
import { uploadOnFirstDraw } from "../../utils/uploadOnFirstDraw";
import { freezeStaticSubtree } from "../../utils/utils";
import { meshTemplate, warmPrograms } from "../../utils/warmPrograms";
import { _spawnFade } from "../../vfx/spawnFade";
import { reportContentError } from "../../utils/contentError";
import { BiomeContext } from "../../world/components/context";
import { getActiveDomainConfig, whenDomainReady } from "../../world/domains/utils";
import { FoliageAttributes } from "../types";
import { createDefaultsGroup, definedOnly, warnUnsupportedSync } from "../utils";
import {
  CHUNK_HALF_DIAG,
  chunkBoxDistSq,
  chunkNearDistance,
  FOLIAGE_CHUNK_SIZE,
  foliageApproachDistance,
  foliageBandCovers,
  foliageBandToRequest,
  foliageDrawFraction,
  type Heading,
  packChunkKey,
  SWEEP_STEP,
  updateHeading,
  wantsLowBladeDetail,
} from "./foliageLod";
import { createFoliageMaterial, updateFoliageMaterial } from "./foliageMaterial";
import { FoliageChunkParams, FoliageChunkResult, generateFoliageChunk, initFoliageWorker } from "./foliageWorker";

/**
 * THE FOLIAGE BASE — the whole pipeline (CLAUDE.md → "The three game-object classes"): this chunk
 * lifecycle, its LOD and bands (foliageLod.ts) and its shader (foliageMaterial.ts). A plant type is
 * <FoliageField> with different defaults (createFoliage); anything two plants share belongs here.
 * Deliberately NOT on the Dressing chunk base: ~32k instances per chunk stream from the worker straight
 * into GPU attributes, and Dressing's Matrix4-per-instance assembly would regress at that count.
 */

const FoliageGroup = createDefaultsGroup<Pick<FoliageAttributes, "renderDistance">>("foliage");
export const Foliage = FoliageGroup.Group;

const MAX_PENDING_CHUNKS = 4; // worker requests in flight at once
const UPDATE_INTERVAL_FRAMES = 3;
// 0 so ground cover lands before actors pop in (ActorPool gates on progress 0.5).
const MIN_TERRAIN_PROGRESS = 0;
/** Held chunks are evicted past this multiple of the render distance. */
const KEEP_DISTANCE_FACTOR = 1.25;

interface FoliageChunk {
  cx: number;
  cz: number;
  mesh: THREE.Mesh | null; // null = built but empty
  total: number; // blades the chunk places in full — instanceCount is a distance fraction of it
  held: number; // blades uploaded: the first `held` of the fade-key order
  band: number;
  lowDetail: boolean;
}

/** A chunk to request: new, or (`widen`) a held chunk's wider band. */
interface SweepCandidate {
  key: number;
  cx: number;
  cz: number;
  distSq: number;
  band: number;
  widen: boolean;
}

const bladeQuads: { near: THREE.PlaneGeometry | null; low: THREE.PlaneGeometry | null } = { near: null, low: null };

/** The blade quad: 3 segments near (the wind bend curves), 1 far (foliageLod.ts BLADE_DETAIL_DISTANCE).
 *  Shared by every chunk of every field; never disposed. */
const bladeQuad = (low: boolean): THREE.PlaneGeometry => {
  const key = low ? "low" : "near";
  let quad = bladeQuads[key];
  if (!quad) {
    quad = new THREE.PlaneGeometry(1, 1, 1, low ? 1 : 3);
    quad.translate(0, 0.5, 0);
    bladeQuads[key] = quad;
  }
  return quad;
};

const applyBladeDetail = (geo: THREE.BufferGeometry, low: boolean): void => {
  const base = bladeQuad(low);
  geo.setIndex(base.getIndex());
  geo.setAttribute("position", base.getAttribute("position"));
  geo.setAttribute("uv", base.getAttribute("uv"));
};

/** geometry.dispose() frees every ATTACHED attribute's GL buffer — detach the shared quad first. */
const disposeChunkGeometry = (geo: THREE.BufferGeometry): void => {
  geo.deleteAttribute("position");
  geo.deleteAttribute("uv");
  geo.setIndex(null);
  geo.dispose();
};

const removeChunkMesh = (group: THREE.Group | null, fades: _spawnFade.SpawnFadeSet, mesh: THREE.Mesh): void => {
  group?.remove(mesh);
  fades.delete(mesh);
  disposeChunkGeometry(mesh.geometry);
};

/** A chunk's instanced blades from a worker result, drawing `drawFraction` of its total; the culling
 *  sphere is in the mesh's own chunk-origin frame. */
const buildChunkGeometry = (
  result: FoliageChunkResult,
  lowDetail: boolean,
  drawFraction: number,
  bladeHeight: number,
  sway: number,
): THREE.InstancedBufferGeometry => {
  const geo = new THREE.InstancedBufferGeometry();
  applyBladeDetail(geo, lowDetail);
  geo.setAttribute("offset", new THREE.InstancedBufferAttribute(result.offsets, 3));
  geo.setAttribute("instanceData", new THREE.InstancedBufferAttribute(result.instanceData, 3));
  geo.instanceCount = Math.min(result.count, Math.ceil(result.total * drawFraction));

  const half = FOLIAGE_CHUNK_SIZE / 2;
  const centerY = (result.minY + result.maxY + bladeHeight) / 2;
  const radiusY = (result.maxY - result.minY) / 2 + bladeHeight + Math.abs(sway) + 1;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(half, centerY, half), Math.sqrt(half * half * 2 + radiusY * radiusY));
  return geo;
};

/** Mounted fields per seed, by plant type: two plant types on one seed (at one density) land on
 *  identical points and grow through each other. */
const plantsBySeed = new Map<string, Map<object, number>>();

const usePlantSeed = (seed: string, plant: object | undefined): void => {
  useEffect(() => {
    if (!plant || process.env.NODE_ENV === "production") return;
    let plants = plantsBySeed.get(seed);
    if (!plants) plantsBySeed.set(seed, (plants = new Map()));
    if ([...plants.keys()].some((other) => other !== plant)) {
      reportContentError(`[foliage] two different plant types are mounted with seed "${seed}" — they would place on the same points. Give each createFoliage its own seed.`);
    }
    plants.set(plant, (plants.get(plant) ?? 0) + 1);
    return () => {
      const left = (plants!.get(plant) ?? 1) - 1;
      if (left > 0) plants!.set(plant, left);
      else plants!.delete(plant);
    };
  }, [seed, plant]);
};

interface FoliageFieldProps extends FoliageAttributes {
  /** The plant type (createFoliage's), for the one-seed-per-plant check. */
  plant?: object;
}

/** Without explicit `biomeIds`, restricts itself to the enclosing <Biome>. Mounted only through
 *  createFoliage, which has already resolved mount > <Foliage> group > plant defaults. */
const FoliageField: React.FC<FoliageFieldProps> = ({
  density = 800_000,
  biomeIds,
  heightRange,
  roadDistanceRange,
  slopeRange = [0, 35],
  slopeBlend = 10,
  color = "#6a9c45",
  png,
  texture: textureFactory,
  width = 0.12,
  height = 1.2,
  sway = 0.15,
  swaySpeed = 1.2,
  renderDistance = 500,
  seed = "foliage",
  underwater,
  quantization,
  serverSynced,
  plant,
}) => {
  warnUnsupportedSync("foliage", serverSynced);
  usePlantSeed(seed, plant);
  const groupRef = useRef<THREE.Group>(null);
  const chunksRef = useRef(new Map<number, FoliageChunk>());
  const pendingRef = useRef(new Set<number>());
  const generationRef = useRef(0); // bumped on param change so stale worker results are discarded
  const frameCountRef = useRef(0);
  const workerReadyRef = useRef(false);
  const mountedRef = useRef(true);
  const sweepSettledRef = useRef(false);
  const lastCellRef = useRef({ cx: Number.NaN, cz: Number.NaN });
  const lastSweepPosRef = useRef({ x: Number.NaN, z: Number.NaN });
  const headingRef = useRef<Heading>({ x: 0, z: 0, anchorX: Number.NaN, anchorZ: Number.NaN });
  // Per CHUNK, like dressing. Orthogonal to the per-blade distance shrink, which stays the fade OUT:
  // it is what the instanceCount truncation is built on.
  const fadesRef = useRef(new _spawnFade.SpawnFadeSet());

  const { camera, scene } = useThree();
  const { terrainLoaded, progress } = useGameContext();

  const biomeCtx = useContext(BiomeContext);
  const effectiveBiomeIds = biomeIds ?? (biomeCtx ? [biomeCtx.biomeId] : undefined);

  const texture = useMemo(() => {
    if (png) {
      const tex = new THREE.TextureLoader().load(png);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }
    if (textureFactory) return textureFactory();
    const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    tex.needsUpdate = true;
    return tex;
  }, [png, textureFactory]);

  const material = useMemo(
    () => createFoliageMaterial(texture, quantization, { color, sway, swaySpeed, width, height, renderDistance }),
    // Scalar uniforms are synced below without a rebuild; quantization picks its uniform object at creation.
    [texture, quantization],
  );

  useEffect(() => {
    updateFoliageMaterial(material, { color, sway, swaySpeed, width, height, renderDistance });
  }, [material, color, sway, swaySpeed, width, height, renderDistance]);

  const params: FoliageChunkParams = useMemo(
    () => ({
      seed,
      chunkSize: FOLIAGE_CHUNK_SIZE,
      density,
      biomeIds: effectiveBiomeIds,
      heightRange,
      slopeRange,
      slopeBlend,
      roadDistanceRange,
      underwater: underwater ? { height } : undefined,
    }),
    [seed, density, slopeBlend, JSON.stringify(effectiveBiomeIds), JSON.stringify(heightRange), JSON.stringify(slopeRange), JSON.stringify(roadDistanceRange), underwater, underwater ? height : 0],
  );

  useEffect(() => {
    whenDomainReady()
      .then(() => initFoliageWorker(getActiveDomainConfig()))
      .then(() => {
        workerReadyRef.current = true;
      });
  }, []);

  const clearChunks = useCallback(() => {
    generationRef.current++;
    chunksRef.current.forEach(({ mesh }) => {
      if (mesh) {
        groupRef.current?.remove(mesh);
        disposeChunkGeometry(mesh.geometry);
      }
    });
    chunksRef.current.clear();
    fadesRef.current.clear();
    pendingRef.current.clear();
    sweepSettledRef.current = false;
    lastCellRef.current.cx = Number.NaN;
  }, []);

  useEffect(() => clearChunks, [params, material, clearChunks]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Linked at load, not when the first blades stream in (utils/warmPrograms.ts).
  useEffect(() => warmPrograms(scene, [meshTemplate(material)]), [material, scene]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    return () => {
      // A factory texture is shared by the plant type; only a self-loaded one is ours to dispose.
      if (png) texture.dispose();
    };
  }, [texture, png]);

  /** Mounts a delivered chunk, or swaps a widened band's buffers into its held mesh. */
  const receiveChunk = (key: number, cx: number, cz: number, band: number, result: FoliageChunkResult): void => {
    const held = chunksRef.current.get(key);
    if (result.count === 0) {
      if (held?.mesh) removeChunkMesh(groupRef.current, fadesRef.current, held.mesh);
      chunksRef.current.set(key, { cx, cz, mesh: null, total: 0, held: 0, band: 1, lowDetail: false });
      return;
    }

    const dNear = chunkNearDistance(cx, cz, camera.position.x, camera.position.z);
    const lowDetail = held ? held.lowDetail : wantsLowBladeDetail(false, dNear);
    const geo = buildChunkGeometry(result, lowDetail, foliageDrawFraction(dNear, renderDistance), height, sway);

    const chunk: FoliageChunk = {
      cx,
      cz,
      mesh: null,
      total: result.total,
      held: result.count,
      band: result.count >= result.total ? 1 : band,
      lowDetail,
    };
    if (held?.mesh) {
      // Same mesh, same draw call; only the instance buffers are replaced (a GL buffer can't grow).
      const old = held.mesh.geometry;
      held.mesh.geometry = geo;
      disposeChunkGeometry(old);
      chunk.mesh = held.mesh;
    } else {
      chunk.mesh = new THREE.Mesh(geo, material);
      // The shader rebases instance positions on modelMatrix[3] — the mesh MUST sit at its chunk origin.
      chunk.mesh.position.set(cx * FOLIAGE_CHUNK_SIZE, 0, cz * FOLIAGE_CHUNK_SIZE);
      freezeStaticSubtree(chunk.mesh);
      groupRef.current?.add(chunk.mesh);
      fadesRef.current.add(chunk.mesh);
    }
    uploadOnFirstDraw(chunk.mesh);
    chunksRef.current.set(key, chunk);
  };

  /** A new chunk, or — `widen` — a held chunk's wider band, whose blades are a superset of the held ones. */
  const requestChunk = ({ key, cx, cz, band, widen }: SweepCandidate) => {
    pendingRef.current.add(key);
    const generation = generationRef.current;

    generateFoliageChunk(cx, cz, params, band).then((result) => {
      if (!mountedRef.current || generation !== generationRef.current) return;
      pendingRef.current.delete(key);
      if (widen && !chunksRef.current.get(key)?.mesh) return; // evicted while in flight
      receiveChunk(key, cx, cz, band, result);
    });
  };

  /** Settled + nothing in flight + same cell + under SWEEP_STEP of travel ⇒ the sweep can't produce
   *  work. Eviction is deferred at most one cell of travel; the keep hysteresis dwarfs that. The step
   *  bounds how far a chunk can approach between band checks (BAND_WIDEN_MARGIN). */
  const sweepWouldBeIdle = (px: number, pz: number, centerCX: number, centerCZ: number): boolean => {
    const sweptDx = px - lastSweepPosRef.current.x;
    const sweptDz = pz - lastSweepPosRef.current.z;
    return (
      sweepSettledRef.current &&
      pendingRef.current.size === 0 &&
      centerCX === lastCellRef.current.cx &&
      centerCZ === lastCellRef.current.cz &&
      sweptDx * sweptDx + sweptDz * sweptDz < SWEEP_STEP * SWEEP_STEP
    );
  };

  /** Evicts far chunks; for the rest truncates the draw to what the distance shows, swaps the blade
   *  detail and lists the ones whose band will soon be short. */
  const updateHeldChunks = (px: number, pz: number, heading: Heading, candidates: SweepCandidate[]): void => {
    const keepDistSq = (renderDistance * KEEP_DISTANCE_FACTOR) ** 2;
    chunksRef.current.forEach((chunk, key) => {
      const dx = (chunk.cx + 0.5) * FOLIAGE_CHUNK_SIZE - px;
      const dz = (chunk.cz + 0.5) * FOLIAGE_CHUNK_SIZE - pz;
      const distSq = dx * dx + dz * dz;
      if (distSq > keepDistSq) {
        if (chunk.mesh) removeChunkMesh(groupRef.current, fadesRef.current, chunk.mesh);
        chunksRef.current.delete(key);
        return;
      }
      if (!chunk.mesh) return;

      // dNear = the chunk's nearest possible instance, so nothing visible is ever cut.
      const dNear = Math.max(0, Math.sqrt(distSq) - CHUNK_HALF_DIAG);
      const drawn = Math.ceil(chunk.total * foliageDrawFraction(dNear, renderDistance));
      // Short only if a widening is late (outrun) — the missing blades are the ones fading in.
      (chunk.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = Math.min(drawn, chunk.held);
      if (!pendingRef.current.has(key) && !foliageBandCovers(chunk.band, dNear, renderDistance)) {
        const approach = foliageApproachDistance(dNear, dx, dz, heading.x, heading.z);
        const band = foliageBandToRequest(approach, renderDistance);
        candidates.push({ key, cx: chunk.cx, cz: chunk.cz, distSq: chunkBoxDistSq(chunk.cx, chunk.cz, px, pz), band, widen: true });
      }

      const low = wantsLowBladeDetail(chunk.lowDetail, dNear);
      if (low !== chunk.lowDetail) {
        chunk.lowDetail = low;
        applyBladeDetail(chunk.mesh.geometry, low);
      }
    });
  };

  /** Every chunk not held or pending whose nearest point is inside the render distance: no instance
   *  survives the shader's fade past it, so a chunk beyond would render nothing. */
  const listNewChunks = (px: number, pz: number, centerCX: number, centerCZ: number, heading: Heading, candidates: SweepCandidate[]): void => {
    const radius = Math.ceil(renderDistance / FOLIAGE_CHUNK_SIZE);
    const fadeZeroDistSq = renderDistance * renderDistance;
    for (let dcx = -radius; dcx <= radius; dcx++) {
      for (let dcz = -radius; dcz <= radius; dcz++) {
        const cx = centerCX + dcx;
        const cz = centerCZ + dcz;
        const key = packChunkKey(cx, cz);
        if (chunksRef.current.has(key) || pendingRef.current.has(key)) continue;

        const distSq = chunkBoxDistSq(cx, cz, px, pz);
        if (distSq >= fadeZeroDistSq) continue;
        const ccx = (cx + 0.5) * FOLIAGE_CHUNK_SIZE - px;
        const ccz = (cz + 0.5) * FOLIAGE_CHUNK_SIZE - pz;
        const dNear = chunkNearDistance(cx, cz, px, pz);
        const approach = foliageApproachDistance(dNear, ccx, ccz, heading.x, heading.z);
        candidates.push({ key, cx, cz, distSq, band: foliageBandToRequest(approach, renderDistance), widen: false });
      }
    }
  };

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
    fadesRef.current.update();

    frameCountRef.current++;
    if (frameCountRef.current % UPDATE_INTERVAL_FRAMES !== 0) return;
    if (!workerReadyRef.current) return;
    if (!terrainLoaded && progress < MIN_TERRAIN_PROGRESS) return;

    const px = camera.position.x;
    const pz = camera.position.z;
    const centerCX = Math.floor(px / FOLIAGE_CHUNK_SIZE);
    const centerCZ = Math.floor(pz / FOLIAGE_CHUNK_SIZE);
    if (sweepWouldBeIdle(px, pz, centerCX, centerCZ)) return;
    lastCellRef.current.cx = centerCX;
    lastCellRef.current.cz = centerCZ;
    lastSweepPosRef.current.x = px;
    lastSweepPosRef.current.z = pz;

    const heading = headingRef.current;
    updateHeading(heading, px, pz);

    const candidates: SweepCandidate[] = [];
    updateHeldChunks(px, pz, heading, candidates);
    if (pendingRef.current.size >= MAX_PENDING_CHUNKS) {
      sweepSettledRef.current = false;
      return;
    }
    listNewChunks(px, pz, centerCX, centerCZ, heading, candidates);

    // New chunks and widenings share the in-flight budget, nearest first.
    candidates.sort((a, b) => a.distSq - b.distSq);
    for (const c of candidates) {
      if (pendingRef.current.size >= MAX_PENDING_CHUNKS) break;
      requestChunk(c);
    }
    sweepSettledRef.current = candidates.length === 0 && pendingRef.current.size === 0;
  });

  return <group ref={groupRef} matrixAutoUpdate={false} />;
};

/** A plant type: its defaults baked in. Precedence, as for <Dressing>: the mount's own props,
 *  then the enclosing <Foliage> group's, then these defaults. */
export const createFoliage = (defaults: FoliageAttributes) => {
  const plant = {};
  const PlantField = (overrides: FoliageAttributes): JSX.Element => {
    const group = FoliageGroup.useDefaults();
    return <FoliageField {...defaults} {...definedOnly(group)} {...definedOnly(overrides)} plant={plant} />;
  };
  return PlantField;
};
