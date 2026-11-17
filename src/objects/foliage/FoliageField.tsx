import { traceSpan } from "../../utils/spike-trace";
import { useFrame, useThree } from "@react-three/fiber";
import React from "react";
import { useCallback, useContext, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGameContext } from "../../context/hooks";
import { uploadOnFirstDraw, freezeStaticSubtree } from "../../utils/render/utils";
import { meshTemplate, warmPrograms } from "../../utils/render";
import { _spawnFade } from "../../vfx/spawn-fade";
import { BiomeContext, WaterBodyContext } from "../../world/components/context";
import { WATER_ZONE_DEFAULTS } from "../../generation/water/parts/params";
import { getActiveDomainConfig, whenDomainReady } from "../../world/domains/store";
import { FoliageAttributes } from "../types";
import { definedOnly, warnUnsupportedSync, chunkBoxDistSq, chunkNearDistance, foliageApproachDistance, foliageBandCovers, foliageBandToRequest, foliageDrawFraction, packChunkKey, updateHeading, wantsLowBladeDetail } from "./utils";
import { CHUNK_HALF_DIAG, FOLIAGE_CHUNK_SIZE, SWEEP_STEP, KEEP_DISTANCE_FACTOR, UPDATE_INTERVAL_FRAMES, MIN_TERRAIN_PROGRESS, MAX_PENDING_CHUNKS } from "./constants";
import type { Heading, FoliageChunk, SweepCandidate } from "./types";
import { createFoliageMaterial, updateFoliageMaterial } from "./material";
import { FoliageChunkParams, FoliageChunkResult, generateFoliageChunk, initFoliageWorker } from "./worker";
import { usePlantSeed } from "./hooks";
import { disposeChunkGeometry, removeChunkMesh, buildChunkGeometry, applyBladeDetail } from "./geometry";

/**
 * THE FOLIAGE BASE — the whole pipeline (CLAUDE.md → "The three game-object classes"): this chunk
 * lifecycle, its LOD and bands (foliageLod.ts) and its shader (foliageMaterial.ts). A plant type is
 * <FoliageField> with different defaults (createFoliage); anything two plants share belongs here.
 * Deliberately NOT on the Dressing chunk base: ~32k instances per chunk stream from the worker straight
 * into GPU attributes, and Dressing's Matrix4-per-instance assembly would regress at that count.
 */

interface FoliageFieldProps extends FoliageAttributes {
  /** The plant type (createFoliage's), for the one-seed-per-plant check. */
  plant?: object;
}

/** Without explicit `biomeIds`, restricts itself to the enclosing <Biome> — or, mounted in a body of
 *  water, to the water that body owns. Mounted only through
 *  createFoliage, which has already resolved mount > plant defaults. */
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
  zone,
  submergedMinDepth = 1.5,
  tipClearance = 0.8,
  minCutScale = 0.25,
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
  // In a body of water its own water decides where it grows; elsewhere the enclosing biome does.
  const waterBody = useContext(WaterBodyContext);
  const effectiveBiomeIds = biomeIds ?? (biomeCtx && !waterBody ? [biomeCtx.biomeId] : undefined);

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
      waterBody: waterBody ?? undefined,
      zone: zone ?? (waterBody ? WATER_ZONE_DEFAULTS.foliage : undefined),
      bladeHeight: height,
      submergedMinDepth,
      tipClearance,
      minCutScale,
    }),
    [seed, density, slopeBlend, JSON.stringify(effectiveBiomeIds), waterBody, JSON.stringify(heightRange), JSON.stringify(slopeRange), JSON.stringify(roadDistanceRange), zone, height, submergedMinDepth, tipClearance, minCutScale],
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

  // Linked at load, not when the first blades stream in (utils/render/index.ts).
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
    const geo = traceSpan("foliage:chunk", () => buildChunkGeometry(result, lowDetail, foliageDrawFraction(dNear, renderDistance), height, sway));

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

/** A plant type: its defaults baked in; the mount's own props win. */
export const createFoliage = (defaults: FoliageAttributes) => {
  const plant = {};
  const PlantField = (overrides: FoliageAttributes): JSX.Element => {
    return <FoliageField {...defaults} {...definedOnly(overrides)} plant={plant} />;
  };
  return PlantField;
};
