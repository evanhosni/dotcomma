import { useFrame, useThree } from "@react-three/fiber";
import React, { useCallback, useContext, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGameContext } from "../../context/GameContext";
import { NIGHT_BLEND_UNIFORM, nightDimGLSL } from "../../lighting/dayNight";
import { _quantization } from "../../utils/quantization/quantization";
import { uploadOnFirstDraw } from "../../utils/uploadOnFirstDraw";
import { _curvature } from "../../vfx/curvature";
import { BiomeContext } from "../../world/components/context";
import { getActiveDomainConfig, whenDomainReady } from "../../world/domains/utils";
import { FoliageAttributes } from "../types";
import { createDefaultsGroup } from "../utils";
import { FoliageChunkParams, generateFoliageChunk, initFoliageWorker } from "./foliageWorker";

/**
 * THE FOLIAGE BASE — the whole pipeline (CLAUDE.md → "The three game-object classes").
 * A plant type is <FoliageField> with different defaults (createFoliage); anything two
 * plants share belongs here. Deliberately NOT on the Dressing chunk base: ~32k instances
 * per chunk stream from the worker straight into GPU attributes, and Dressing's
 * Matrix4-per-instance assembly would regress at that count.
 */

export type FoliageDefaults = Pick<FoliageAttributes, "renderDistance">;

const FoliageGroup = createDefaultsGroup<FoliageDefaults>();
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
  fullInstanceCount: number; // full instance count — instanceCount is truncated by distance
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

/** Without explicit `biomeIds`, restricts itself to the enclosing <Biome>. */
export const FoliageField: React.FC<FoliageAttributes> = ({
  density = 800_000,
  biomeIds,
  heightRange,
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
}) => {
  const renderDistance = useFoliageRenderDistance(renderDistanceProp, 500);
  const groupRef = useRef<THREE.Group>(null);
  const chunksRef = useRef(new Map<number, FoliageChunk>());
  const pendingRef = useRef(new Set<number>());
  const generationRef = useRef(0); // bumped on param change so stale worker results are discarded
  const frameCountRef = useRef(0);
  const workerReadyRef = useRef(false);
  const mountedRef = useRef(true);
  const sweepSettledRef = useRef(false);
  const lastCellRef = useRef({ cx: Number.NaN, cz: Number.NaN });

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

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
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
      }),
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
    }),
    [seed, density, slopeBlend, JSON.stringify(effectiveBiomeIds), JSON.stringify(heightRange), JSON.stringify(slopeRange)],
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

  const requestChunk = (key: number, cx: number, cz: number) => {
    pendingRef.current.add(key);
    const generation = generationRef.current;

    generateFoliageChunk(cx, cz, params).then((result) => {
      if (!mountedRef.current || generation !== generationRef.current) return;
      pendingRef.current.delete(key);

      if (result.count === 0) {
        chunksRef.current.set(key, { cx, cz, mesh: null, fullInstanceCount: 0, lowDetail: false });
        return;
      }

      const ccx = (cx + 0.5) * FOLIAGE_CHUNK_SIZE - camera.position.x;
      const ccz = (cz + 0.5) * FOLIAGE_CHUNK_SIZE - camera.position.z;
      const lowDetail = Math.sqrt(ccx * ccx + ccz * ccz) - CHUNK_HALF_DIAG > BLADE_DETAIL_DISTANCE;

      const geo = new THREE.InstancedBufferGeometry();
      applyBladeDetail(geo, lowDetail);
      geo.setAttribute("offset", new THREE.InstancedBufferAttribute(result.offsets, 3));
      geo.setAttribute("instanceData", new THREE.InstancedBufferAttribute(result.instanceData, 3));
      geo.instanceCount = result.count;

      // In the mesh's own chunk-origin frame.
      const half = FOLIAGE_CHUNK_SIZE / 2;
      const centerY = (result.minY + result.maxY + height) / 2;
      const radiusY = (result.maxY - result.minY) / 2 + height + Math.abs(sway) + 1;
      geo.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(half, centerY, half),
        Math.sqrt(half * half * 2 + radiusY * radiusY),
      );

      const mesh = new THREE.Mesh(geo, material);
      // The shader rebases instance positions on modelMatrix[3] — the mesh MUST sit at its chunk origin.
      mesh.position.set(cx * FOLIAGE_CHUNK_SIZE, 0, cz * FOLIAGE_CHUNK_SIZE);
      uploadOnFirstDraw(mesh);
      chunksRef.current.set(key, { cx, cz, mesh, fullInstanceCount: result.count, lowDetail });
      groupRef.current?.add(mesh);
    });
  };

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;

    frameCountRef.current++;
    if (frameCountRef.current % UPDATE_INTERVAL_FRAMES !== 0) return;
    if (!workerReadyRef.current) return;
    if (!terrainLoaded && progress < MIN_TERRAIN_PROGRESS) return;

    const px = camera.position.x;
    const pz = camera.position.z;
    const centerCX = Math.floor(px / FOLIAGE_CHUNK_SIZE);
    const centerCZ = Math.floor(pz / FOLIAGE_CHUNK_SIZE);

    // Settled + nothing in flight + same cell ⇒ the sweep can't produce work. Eviction is
    // deferred at most one cell of travel; the ×1.25 hysteresis dwarfs that.
    if (
      sweepSettledRef.current &&
      pendingRef.current.size === 0 &&
      centerCX === lastCellRef.current.cx &&
      centerCZ === lastCellRef.current.cz
    ) {
      return;
    }
    lastCellRef.current.cx = centerCX;
    lastCellRef.current.cz = centerCZ;

    const keepDistSq = (renderDistance * 1.25) ** 2;
    chunksRef.current.forEach((chunk, key) => {
      const dx = (chunk.cx + 0.5) * FOLIAGE_CHUNK_SIZE - px;
      const dz = (chunk.cz + 0.5) * FOLIAGE_CHUNK_SIZE - pz;
      const distSq = dx * dx + dz * dz;
      if (distSq > keepDistSq) {
        if (chunk.mesh) {
          groupRef.current?.remove(chunk.mesh);
          disposeChunkGeometry(chunk.mesh.geometry);
        }
        chunksRef.current.delete(key);
      } else if (chunk.mesh) {
        // dNear = the chunk's nearest possible instance, so nothing visible is ever cut;
        // +0.03 pads the uniform-hash count estimate. Mirrors the shader's 0.3R→R fade.
        const dNear = Math.max(0, Math.sqrt(distSq) - CHUNK_HALF_DIAG);
        const t = (dNear / renderDistance - 0.3) / 0.7;
        const fadeFrac = 1 - Math.min(Math.max(t, 0), 1) + 0.03;
        const taperT = Math.min(Math.max((dNear - LOD_TAPER_START) / (LOD_TAPER_END - LOD_TAPER_START), 0), 1);
        const taperFrac = 1 - taperT * (1 - LOD_TAPER_MIN);
        const frac = Math.min(1, fadeFrac, taperFrac);
        (chunk.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = Math.ceil(chunk.fullInstanceCount * frac);

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
    const candidates: { key: number; cx: number; cz: number; distSq: number }[] = [];

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
        if (distSq < fadeZeroDistSq) candidates.push({ key, cx, cz, distSq });
      }
    }

    candidates.sort((a, b) => a.distSq - b.distSq);
    for (const c of candidates) {
      if (pendingRef.current.size >= MAX_PENDING_CHUNKS) break;
      requestChunk(c.key, c.cx, c.cz);
    }
    sweepSettledRef.current = candidates.length === 0 && pendingRef.current.size === 0;
  });

  return <group ref={groupRef} />;
};

/** The foliage twin of createActor: defaults baked in, every prop an override at the mount. */
export const createFoliage =
  (defaults: FoliageAttributes) =>
  (overrides: FoliageAttributes): JSX.Element =>
    <FoliageField {...defaults} {...overrides} />;
