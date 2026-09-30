import { useFrame, useThree } from "@react-three/fiber";
import React, { useCallback, useContext, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGameContext } from "../../context/GameContext";
import { NIGHT_BLEND_UNIFORM, nightDimGLSL } from "../../lighting/dayNight";
import { _quantization } from "../../vfx/quantization";
import { uploadOnFirstDraw } from "../../utils/uploadOnFirstDraw";
import { _curvature } from "../../vfx/curvature";
import { _spawnFade } from "../../vfx/spawnFade";
import { BiomeContext } from "../../world/components/context";
import { getActiveDomainConfig, whenDomainReady } from "../../world/domains/utils";
import { FoliageAttributes } from "../types";
import { createDefaultsGroup, warnUnsupportedSync } from "../utils";
import { FoliageChunkParams, generateFoliageChunk, initFoliageWorker } from "./foliageWorker";

/**
 * THE FOLIAGE BASE — the whole pipeline (CLAUDE.md → "The three game-object classes").
 * A plant type is <FoliageField> with different defaults (createFoliage); anything two
 * plants share belongs here. Deliberately NOT on the Dressing chunk base: ~32k instances
 * per chunk stream from the worker straight into GPU attributes, and Dressing's
 * Matrix4-per-instance assembly would regress at that count.
 */

export type FoliageDefaults = Pick<FoliageAttributes, "renderDistance">;

const FoliageGroup = createDefaultsGroup<FoliageDefaults>("foliage");
export const Foliage = FoliageGroup.Group;

export const useFoliageRenderDistance = (own: number | undefined, featureDefault: number): number => {
  const ctx = FoliageGroup.useDefaults();
  return own ?? ctx.renderDistance ?? featureDefault;
};

/** Must stay a whole multiple of both quantization grids (0.025, 0.2) so the chunk-relative
 *  lattice the shader works in IS the world lattice. 64 → a 500u field is ~190 draws. */
const FOLIAGE_CHUNK_SIZE = 64;
const MAX_PENDING_CHUNKS = 4; // worker requests in flight at once
const UPDATE_INTERVAL_FRAMES = 3;
// 0 so ground cover lands before actors pop in (ActorPool gates on progress 0.5).
const MIN_TERRAIN_PROGRESS = 0;

const VERTEX_SHADER = /* glsl */ `
attribute vec3 offset;
attribute vec3 instanceData; // x: sway phase, y: size variation, z: tint variation

uniform float uTime;
uniform float uSway;
uniform float uSwaySpeed;
uniform float uWidth;
uniform float uHeight;
uniform float uRenderDistance;

varying vec2 vUv;
varying float vTint;

// Quantization + world curvature — the SAME chunks (uniform declarations +
// functions) every patched material and the terrain shader use, interpolated
// from their single sources so foliage bends with the ground it stands on.
${_quantization.QUANTIZE_GLSL}
${_curvature.CURVE_GLSL}

void main() {
  vUv = uv;
  vTint = instanceData.z;

  // Positions are chunk-relative: quantizing the ABSOLUTE offset flickered far from
  // the origin (float32 ~0.008u at 100k vs the 0.025u grid). The subtraction is exact
  // (an instance is never more than one chunk from its origin); wind/camera terms keep
  // the absolute offset so gusts stay continuous across chunk borders.
  vec3 chunkOrigin = modelMatrix[3].xyz;
  vec3 offsetRel = offset - chunkOrigin;

  float phase = instanceData.x;
  float scale = instanceData.y;

  // Per-instance fade-out scattered over the outer 70% of the render distance (full
  // density to 0.55R cost ~40% more triangles). 0.3 + 0.7 MUST sum to 1: the chunk-request
  // gate and the instanceCount truncation in FoliageField assume nothing survives past R.
  float instRand = fract(phase * 1.618 + instanceData.z * 12.9898);
  float fadeEnd = uRenderDistance * (0.3 + 0.7 * instRand);
  float dist = distance(cameraPosition.xz, offset.xz);
  float fade = 1.0 - smoothstep(fadeEnd * 0.7, fadeEnd, dist);

  float width = uWidth * scale * fade;
  float height = uHeight * scale * fade;

  vec3 look = cameraPosition - offset;
  look.y = 0.0;
  look = normalize(look + vec3(0.0001, 0.0, 0.0));
  vec3 right = vec3(look.z, 0.0, -look.x);

  vec3 pos = offsetRel + right * (position.x * width);
  pos.y += position.y * height;

  float bend = uv.y * uv.y * uSway * scale * fade;
  float t = uTime * uSwaySpeed;
  float gust = sin(t + (offset.x + offset.z) * 0.15 + phase);
  float flutter = sin(t * 2.3 + phase * 2.0) * 0.3;
  pos.x += (gust + flutter) * bend;
  pos.z += cos(t * 0.7 + (offset.x - offset.z) * 0.12 + phase) * bend * 0.7;

  pos = quantizeWorldPos(pos);

  // modelViewMatrix[3] = chunk origin in view space, resolved on the CPU in float64.
  vec3 viewPos = modelViewMatrix[3].xyz + mat3(viewMatrix) * pos;
  gl_Position = projectionMatrix * vec4(curveViewPos(viewPos), 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uNightBlend;

varying vec2 vUv;
varying float vTint;

void main() {
  vec4 tex = texture2D(uMap, vUv);
  if (tex.a < 0.5) discard;
  vec3 col = uColor * tex.rgb * (0.85 + vTint * 0.3) * (0.75 + 0.25 * vUv.y);
  ${nightDimGLSL("col")}
  gl_FragColor = vec4(col, 1.0);
}
`;

// Exact float64 key for |cx|,|cz| < 2²⁵ (±10⁹ world units) — no string keys in the 3-frame scan.
const packChunkKey = (cx: number, cz: number): number => cx * 0x4000000 + cz; // 2^26

interface FoliageChunk {
  cx: number;
  cz: number;
  mesh: THREE.Mesh | null; // null = built but empty
  total: number; // blades the chunk places in full — instanceCount is a distance fraction of it
  held: number; // blades uploaded: the first `held` of the fade-key order
  band: number;
  lowDetail: boolean;
}

// Instance-count LOD. The worker delivers instances sorted by descending fade key, so
// truncating instanceCount by distance drops exactly the instances the shader has already
// faded to nothing (measured: grass was 14.6M of 14.8M rendered triangles). The taper must
// fall FASTER than the fade (which runs 0.3R → R) or it does nothing — a 600u endpoint was dead.
const LOD_TAPER_START = 150; // full density inside this distance
const LOD_TAPER_END = 350; // density floor reached here
const LOD_TAPER_MIN = 0.25; // fraction of full density at the floor
const CHUNK_HALF_DIAG = (FOLIAGE_CHUNK_SIZE * Math.SQRT2) / 2;

/** The fraction of a chunk's `total` blades drawn when its nearest possible blade is `dNear`
 *  away: the shader's 0.3R→R fade (+0.03 pads the uniform-hash count estimate), capped by the taper. */
export const foliageDrawFraction = (dNear: number, renderDistance: number): number => {
  const t = (dNear / renderDistance - 0.3) / 0.7;
  const fadeFrac = 1 - Math.min(Math.max(t, 0), 1) + 0.03;
  const taperT = Math.min(Math.max((dNear - LOD_TAPER_START) / (LOD_TAPER_END - LOD_TAPER_START), 0), 1);
  const taperFrac = 1 - taperT * (1 - LOD_TAPER_MIN);
  return Math.min(1, fadeFrac, taperFrac);
};

// Instance BANDS: a chunk generates and uploads only a prefix of its fade-key order (the taper
// floor is all a chunk past LOD_TAPER_END can draw) and is WIDENED on approach. A prefix is a
// superset of any shorter one, so widening adds exactly the blades fading in. Every widening
// re-uploads the whole prefix (three can't grow a GL buffer), so chunks AHEAD of the camera's
// heading are requested for their closest approach and walked-through chunks upload once:
// without that, bands cost +5% (straight walk) to +10% (turning walk) upload vs no bands at all.
const FOLIAGE_BANDS = [LOD_TAPER_MIN, 0.5, 1];
// Travel covered by the check (the sweep re-runs every SWEEP_STEP) plus the in-flight request;
// 16 left 26 sweeps short at sprint speed (45u/s), 24 none.
const BAND_WIDEN_MARGIN = 24;
const BAND_HEADROOM = 48; // a requested band covers the chunk this much nearer than now
const SWEEP_STEP = 16;
const HEADING_STEP = 8; // travel that re-measures the heading
const HEADING_TELEPORT = 256; // a jump this long (fast travel, respawn) says nothing about direction

export const foliageBandFor = (dNear: number, renderDistance: number): number => {
  const frac = foliageDrawFraction(dNear, renderDistance);
  for (const band of FOLIAGE_BANDS) if (frac <= band) return band;
  return 1;
};

/** A held band still covers `dNear` minus the widen margin — else widen it before it's short. */
export const foliageBandCovers = (band: number, dNear: number, renderDistance: number): boolean =>
  band >= 1 || foliageDrawFraction(Math.max(0, dNear - BAND_WIDEN_MARGIN), renderDistance) <= band;

/** `approachDistance` never exceeds the chunk's dNear, so the band always covers where it is now. */
export const foliageBandToRequest = (approachDistance: number, renderDistance: number): number =>
  foliageBandFor(Math.max(0, approachDistance - BAND_HEADROOM), renderDistance);

/** A chunk (center `rel` from the camera) ahead of a unit `heading` is judged at its closest
 *  approach along it; a zero heading (standing, just teleported) leaves `dNear` as it is. */
export const foliageApproachDistance = (
  dNear: number,
  relX: number,
  relZ: number,
  headingX: number,
  headingZ: number,
): number => {
  if (relX * headingX + relZ * headingZ <= 0) return dNear;
  return Math.min(dNear, Math.max(0, Math.abs(relX * headingZ - relZ * headingX) - CHUNK_HALF_DIAG));
};

// Blade-geometry LOD: the 3-segment near quad only exists so the wind bend curves instead of
// shearing — sub-pixel past ~100u. Far chunks re-point at a 1-segment quad (~60% fewer foliage
// triangles at a 500u render distance; nothing re-uploads). Hysteresis must exceed the ~91u chunk
// diagonal: the settled early-out can defer a sweep by one cell of travel. Infinity disables.
const BLADE_DETAIL_DISTANCE = 100;
const BLADE_DETAIL_HYSTERESIS = 92;

let baseQuadGeometry: THREE.PlaneGeometry | null = null;
let lowQuadGeometry: THREE.PlaneGeometry | null = null;

/** Shared by every chunk of every field; never disposed. */
const getBaseQuadGeometry = (): THREE.PlaneGeometry => {
  if (!baseQuadGeometry) {
    baseQuadGeometry = new THREE.PlaneGeometry(1, 1, 1, 3);
    baseQuadGeometry.translate(0, 0.5, 0);
  }
  return baseQuadGeometry;
};

const getLowQuadGeometry = (): THREE.PlaneGeometry => {
  if (!lowQuadGeometry) {
    lowQuadGeometry = new THREE.PlaneGeometry(1, 1, 1, 1);
    lowQuadGeometry.translate(0, 0.5, 0);
  }
  return lowQuadGeometry;
};

const applyBladeDetail = (geo: THREE.BufferGeometry, low: boolean): void => {
  const base = low ? getLowQuadGeometry() : getBaseQuadGeometry();
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

/** Mounted fields per seed, by plant type: two plant types on one seed (at one density) land on
 *  identical points and grow through each other. */
const plantsBySeed = new Map<string, Map<object, number>>();

const usePlantSeed = (seed: string, plant: object | undefined): void => {
  useEffect(() => {
    if (!plant || process.env.NODE_ENV === "production") return;
    let plants = plantsBySeed.get(seed);
    if (!plants) plantsBySeed.set(seed, (plants = new Map()));
    if ([...plants.keys()].some((other) => other !== plant)) {
      console.error(`[foliage] two different plant types are mounted with seed "${seed}" — they would place on the same points. Give each createFoliage its own seed.`);
    }
    plants.set(plant, (plants.get(plant) ?? 0) + 1);
    return () => {
      const left = (plants!.get(plant) ?? 1) - 1;
      if (left > 0) plants!.set(plant, left);
      else plants!.delete(plant);
    };
  }, [seed, plant]);
};

export interface FoliageFieldProps extends FoliageAttributes {
  /** The plant type (createFoliage's), for the one-seed-per-plant check. */
  plant?: object;
}

/** Without explicit `biomeIds`, restricts itself to the enclosing <Biome>. */
export const FoliageField: React.FC<FoliageFieldProps> = ({
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
  renderDistance: renderDistanceProp,
  seed = "foliage",
  quantization,
  serverSynced,
  plant,
}) => {
  const renderDistance = useFoliageRenderDistance(renderDistanceProp, 500);
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
  const headingRef = useRef({ x: 0, z: 0, anchorX: Number.NaN, anchorZ: Number.NaN });
  // Per CHUNK, like dressing. Orthogonal to the per-blade distance shrink, which stays the fade OUT:
  // it is what the instanceCount truncation is built on.
  const fadesRef = useRef(new _spawnFade.SpawnFadeSet());

  const { camera } = useThree();
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

  const material = useMemo(() => {
    const created = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new THREE.Color(color) },
          uMap: { value: texture },
          uSway: { value: sway },
          uSwaySpeed: { value: swaySpeed },
          uWidth: { value: width },
          uHeight: { value: height },
          uRenderDistance: { value: renderDistance },
          // Shared uniform objects, never mutated here.
          uGridSize: quantization !== undefined ? { value: quantization } : _quantization.uniforms.uGridSize,
          uCurveStart: _curvature.uniforms.uCurveStart,
          uCurveK: _curvature.uniforms.uCurveK,
          uNightBlend: NIGHT_BLEND_UNIFORM,
        },
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        side: THREE.DoubleSide,
      });
    _spawnFade.patchMaterial(created);
    return created;
  },
    // Scalar uniforms are synced below without a rebuild; quantization picks its uniform object at creation.
    [texture, quantization],
  );

  useEffect(() => {
    material.uniforms.uColor.value.set(color);
    material.uniforms.uSway.value = sway;
    material.uniforms.uSwaySpeed.value = swaySpeed;
    material.uniforms.uWidth.value = width;
    material.uniforms.uHeight.value = height;
    material.uniforms.uRenderDistance.value = renderDistance;
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
    }),
    [seed, density, slopeBlend, JSON.stringify(effectiveBiomeIds), JSON.stringify(heightRange), JSON.stringify(slopeRange), JSON.stringify(roadDistanceRange)],
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

  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    return () => {
      // A factory texture is shared by the plant type; only a self-loaded one is ours to dispose.
      if (png) texture.dispose();
    };
  }, [texture, png]);

  /** A new chunk, or — `widen` — a held chunk's wider band, whose blades are a superset of the held ones. */
  const requestChunk = (key: number, cx: number, cz: number, band: number, widen: boolean) => {
    pendingRef.current.add(key);
    const generation = generationRef.current;

    generateFoliageChunk(cx, cz, params, band).then((result) => {
      if (!mountedRef.current || generation !== generationRef.current) return;
      pendingRef.current.delete(key);
      const held = chunksRef.current.get(key);
      if (widen && !held?.mesh) return; // evicted while in flight

      if (result.count === 0) {
        if (held?.mesh) {
          groupRef.current?.remove(held.mesh);
          fadesRef.current.delete(held.mesh);
          disposeChunkGeometry(held.mesh.geometry);
        }
        chunksRef.current.set(key, { cx, cz, mesh: null, total: 0, held: 0, band: 1, lowDetail: false });
        return;
      }

      const ccx = (cx + 0.5) * FOLIAGE_CHUNK_SIZE - camera.position.x;
      const ccz = (cz + 0.5) * FOLIAGE_CHUNK_SIZE - camera.position.z;
      const dNear = Math.max(0, Math.sqrt(ccx * ccx + ccz * ccz) - CHUNK_HALF_DIAG);
      const lowDetail = held ? held.lowDetail : dNear > BLADE_DETAIL_DISTANCE;

      const geo = new THREE.InstancedBufferGeometry();
      applyBladeDetail(geo, lowDetail);
      geo.setAttribute("offset", new THREE.InstancedBufferAttribute(result.offsets, 3));
      geo.setAttribute("instanceData", new THREE.InstancedBufferAttribute(result.instanceData, 3));
      geo.instanceCount = Math.min(
        result.count,
        Math.ceil(result.total * foliageDrawFraction(dNear, renderDistance)),
      );

      // In the mesh's own chunk-origin frame.
      const half = FOLIAGE_CHUNK_SIZE / 2;
      const centerY = (result.minY + result.maxY + height) / 2;
      const radiusY = (result.maxY - result.minY) / 2 + height + Math.abs(sway) + 1;
      geo.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(half, centerY, half),
        Math.sqrt(half * half * 2 + radiusY * radiusY),
      );

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
        groupRef.current?.add(chunk.mesh);
        fadesRef.current.add(chunk.mesh);
      }
      uploadOnFirstDraw(chunk.mesh);
      chunksRef.current.set(key, chunk);
    });
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

    // Settled + nothing in flight + same cell + under SWEEP_STEP of travel ⇒ the sweep can't
    // produce work. Eviction is deferred at most one cell of travel; the ×1.25 hysteresis dwarfs
    // that. The step bounds how far a chunk can approach between band checks (BAND_WIDEN_MARGIN).
    const sweptDx = px - lastSweepPosRef.current.x;
    const sweptDz = pz - lastSweepPosRef.current.z;
    if (
      sweepSettledRef.current &&
      pendingRef.current.size === 0 &&
      centerCX === lastCellRef.current.cx &&
      centerCZ === lastCellRef.current.cz &&
      sweptDx * sweptDx + sweptDz * sweptDz < SWEEP_STEP * SWEEP_STEP
    ) {
      return;
    }
    lastCellRef.current.cx = centerCX;
    lastCellRef.current.cz = centerCZ;
    lastSweepPosRef.current.x = px;
    lastSweepPosRef.current.z = pz;

    const heading = headingRef.current;
    const hdx = px - heading.anchorX;
    const hdz = pz - heading.anchorZ;
    const hdSq = hdx * hdx + hdz * hdz;
    if (!(hdSq < HEADING_TELEPORT * HEADING_TELEPORT)) {
      heading.x = 0; // first sweep (NaN anchor) or a jump
      heading.z = 0;
      heading.anchorX = px;
      heading.anchorZ = pz;
    } else if (hdSq >= HEADING_STEP * HEADING_STEP) {
      const len = Math.sqrt(hdSq);
      heading.x = hdx / len;
      heading.z = hdz / len;
      heading.anchorX = px;
      heading.anchorZ = pz;
    }

    const candidates: { key: number; cx: number; cz: number; distSq: number; band: number; widen: boolean }[] = [];
    const keepDistSq = (renderDistance * 1.25) ** 2;
    chunksRef.current.forEach((chunk, key) => {
      const dx = (chunk.cx + 0.5) * FOLIAGE_CHUNK_SIZE - px;
      const dz = (chunk.cz + 0.5) * FOLIAGE_CHUNK_SIZE - pz;
      const distSq = dx * dx + dz * dz;
      if (distSq > keepDistSq) {
        if (chunk.mesh) {
          groupRef.current?.remove(chunk.mesh);
          fadesRef.current.delete(chunk.mesh);
          disposeChunkGeometry(chunk.mesh.geometry);
        }
        chunksRef.current.delete(key);
      } else if (chunk.mesh) {
        // dNear = the chunk's nearest possible instance, so nothing visible is ever cut.
        const dNear = Math.max(0, Math.sqrt(distSq) - CHUNK_HALF_DIAG);
        const drawn = Math.ceil(chunk.total * foliageDrawFraction(dNear, renderDistance));
        // Short only if a widening is late (outrun) — the missing blades are the ones fading in.
        (chunk.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = Math.min(drawn, chunk.held);
        if (!pendingRef.current.has(key) && !foliageBandCovers(chunk.band, dNear, renderDistance)) {
          const nx = Math.max(chunk.cx * FOLIAGE_CHUNK_SIZE - px, 0, px - (chunk.cx + 1) * FOLIAGE_CHUNK_SIZE);
          const nz = Math.max(chunk.cz * FOLIAGE_CHUNK_SIZE - pz, 0, pz - (chunk.cz + 1) * FOLIAGE_CHUNK_SIZE);
          const approach = foliageApproachDistance(dNear, dx, dz, heading.x, heading.z);
          const band = foliageBandToRequest(approach, renderDistance);
          candidates.push({ key, cx: chunk.cx, cz: chunk.cz, distSq: nx * nx + nz * nz, band, widen: true });
        }

        const low = chunk.lowDetail
          ? dNear > BLADE_DETAIL_DISTANCE - BLADE_DETAIL_HYSTERESIS
          : dNear > BLADE_DETAIL_DISTANCE;
        if (low !== chunk.lowDetail) {
          chunk.lowDetail = low;
          applyBladeDetail(chunk.mesh.geometry, low);
        }
      }
    });

    if (pendingRef.current.size >= MAX_PENDING_CHUNKS) {
      sweepSettledRef.current = false;
      return;
    }

    const radius = Math.ceil(renderDistance / FOLIAGE_CHUNK_SIZE);
    // No instance survives the shader's fade past renderDistance, so a chunk whose nearest
    // point is beyond it would render nothing — never request it.
    const fadeZeroDistSq = renderDistance * renderDistance;

    for (let dcx = -radius; dcx <= radius; dcx++) {
      for (let dcz = -radius; dcz <= radius; dcz++) {
        const cx = centerCX + dcx;
        const cz = centerCZ + dcz;
        const key = packChunkKey(cx, cz);
        if (chunksRef.current.has(key) || pendingRef.current.has(key)) continue;

        // Nearest AABB point, not center distance — the latter over-requests diagonal chunks.
        const nx = Math.max(cx * FOLIAGE_CHUNK_SIZE - px, 0, px - (cx + 1) * FOLIAGE_CHUNK_SIZE);
        const nz = Math.max(cz * FOLIAGE_CHUNK_SIZE - pz, 0, pz - (cz + 1) * FOLIAGE_CHUNK_SIZE);
        const distSq = nx * nx + nz * nz;
        if (distSq >= fadeZeroDistSq) continue;
        // The band is judged by the same center-minus-half-diagonal dNear the draw truncation uses.
        const ccx = (cx + 0.5) * FOLIAGE_CHUNK_SIZE - px;
        const ccz = (cz + 0.5) * FOLIAGE_CHUNK_SIZE - pz;
        const dNear = Math.max(0, Math.sqrt(ccx * ccx + ccz * ccz) - CHUNK_HALF_DIAG);
        const approach = foliageApproachDistance(dNear, ccx, ccz, heading.x, heading.z);
        candidates.push({ key, cx, cz, distSq, band: foliageBandToRequest(approach, renderDistance), widen: false });
      }
    }

    // New chunks and widenings share the in-flight budget, nearest first.
    candidates.sort((a, b) => a.distSq - b.distSq);
    for (const c of candidates) {
      if (pendingRef.current.size >= MAX_PENDING_CHUNKS) break;
      requestChunk(c.key, c.cx, c.cz, c.band, c.widen);
    }
    sweepSettledRef.current = candidates.length === 0 && pendingRef.current.size === 0;
  });

  return <group ref={groupRef} />;
};

const definedOnly = <T extends object>(props: T): Partial<T> =>
  Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined)) as Partial<T>;

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
