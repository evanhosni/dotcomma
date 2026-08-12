import { useFrame, useThree } from "@react-three/fiber";
import React, { useCallback, useContext, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGameContext } from "../../context/GameContext";
import { NIGHT_BLEND_UNIFORM, NIGHT_GROUND_DIM } from "../../sky/dayNight";
import { _quantization } from "../../utils/quantization/quantization";
import { uploadOnFirstDraw } from "../../utils/uploadOnFirstDraw";
import { BiomeContext } from "../../world/components/context";
import { getActiveWorldConfig, whenWorldReady } from "../../world/registry";
import { useFoliageRenderDistance } from "../Foliage";
import { generateGrassChunk, GrassChunkParams, initGrassWorker } from "./grassWorker";
import { GrassFieldProps } from "./types";

const GRASS_CHUNK_SIZE = 32; // world units per grass chunk (one instanced draw call each)
const MAX_PENDING_CHUNKS = 4; // worker requests in flight at once
const UPDATE_INTERVAL_FRAMES = 3;
// Grass starts filling in ahead of the object spawn system (ObjectPool gates on
// progress 0.5) so ground cover lands before objects pop in.
const MIN_TERRAIN_PROGRESS = 0;

const GRASS_VERTEX_SHADER = /* glsl */ `
attribute vec3 offset;
attribute vec3 bladeData; // x: sway phase, y: size variation, z: tint variation

uniform float uTime;
uniform float uSway;
uniform float uSwaySpeed;
uniform float uBladeWidth;
uniform float uBladeHeight;
uniform float uRenderDistance;
uniform float uGridSize;

varying vec2 vUv;
varying float vTint;

vec3 quantizeWorldPos(vec3 worldPos) {
  if (uGridSize <= 0.0) return worldPos;
  return floor(worldPos / uGridSize + 0.5) * uGridSize;
}

void main() {
  vUv = uv;
  vTint = bladeData.z;

  // The offset attribute is an ABSOLUTE world position, and float32 resolves
  // only ~0.008u at 100k units from the origin — a third of the 0.025u
  // quantization grid. Quantizing (or projecting) in absolute space therefore
  // made every blade flicker between lattice cells as the camera moved, worse
  // the further out the player went. Blade POSITIONS are built relative to
  // the chunk origin instead: the mesh sits at its chunk origin, an exact
  // multiple of GRASS_CHUNK_SIZE (itself a whole multiple of every
  // quantization grid, so the relative lattice IS the world lattice), and the
  // subtraction below is exact because a blade is never more than one chunk
  // from that origin. Camera-relative and wind terms keep using the absolute
  // offset: they are differences or low-frequency phases, insensitive to that
  // resolution, and the wind has to stay continuous across chunk borders.
  vec3 chunkOrigin = modelMatrix[3].xyz;
  vec3 offsetRel = offset - chunkOrigin;

  float phase = bladeData.x;
  float scale = bladeData.y;

  // every blade gets its own fade-out distance scattered across the outer half
  // of the render distance, so density thins gradually instead of hitting a wall
  float bladeRand = fract(phase * 1.618 + bladeData.z * 12.9898);
  float fadeEnd = uRenderDistance * (0.55 + 0.45 * bladeRand);
  float dist = distance(cameraPosition.xz, offset.xz);
  float fade = 1.0 - smoothstep(fadeEnd * 0.7, fadeEnd, dist);

  float width = uBladeWidth * scale * fade;
  float height = uBladeHeight * scale * fade;

  // cylindrical billboard: rotate the quad around Y so it always faces the camera
  vec3 look = cameraPosition - offset;
  look.y = 0.0;
  look = normalize(look + vec3(0.0001, 0.0, 0.0));
  vec3 right = vec3(look.z, 0.0, -look.x);

  vec3 pos = offsetRel + right * (position.x * width);
  pos.y += position.y * height;

  // wind: bend grows quadratically toward the tip, gusts travel across the field
  float bend = uv.y * uv.y * uSway * scale * fade;
  float t = uTime * uSwaySpeed;
  float gust = sin(t + (offset.x + offset.z) * 0.15 + phase);
  float flutter = sin(t * 2.3 + phase * 2.0) * 0.3;
  pos.x += (gust + flutter) * bend;
  pos.z += cos(t * 0.7 + (offset.x - offset.z) * 0.12 + phase) * bend * 0.7;

  pos = quantizeWorldPos(pos);

  // modelViewMatrix[3] is the chunk origin in view space, resolved on the CPU
  // in float64 — the projection never touches a big absolute coordinate.
  gl_Position = projectionMatrix * vec4(modelViewMatrix[3].xyz + mat3(viewMatrix) * pos, 1.0);
}
`;

const GRASS_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uNightBlend;

varying vec2 vUv;
varying float vTint;

void main() {
  vec4 tex = texture2D(uMap, vUv);
  if (tex.a < 0.5) discard;
  // per-blade tint variation + slight darkening toward the base
  vec3 col = uColor * tex.rgb * (0.85 + vTint * 0.3) * (0.75 + 0.25 * vUv.y);
  // unlit shader — dim with the day/night cycle like the terrain does
  col *= mix(1.0, ${NIGHT_GROUND_DIM.toFixed(3)}, uNightBlend);
  gl_FragColor = vec4(col, 1.0);
}
`;

// Chunk coords pack into one exact float64 key (|cx|,|cz| < 2²⁵ ⇒ ±10⁹ world
// units at 32u cells, far past world scale) so the 3-frame scans never build
// a "${cx}_${cz}" string per cell in radius nor parse one back on eviction.
const packChunkKey = (cx: number, cz: number): number => cx * 0x4000000 + cz; // 2^26

interface GrassChunk {
  cx: number;
  cz: number;
  mesh: THREE.Mesh | null; // null = built but empty
  count: number; // full blade count — instanceCount is truncated by distance
}

// ── Distance-tiered blade counts ──
// The worker delivers each chunk's instances sorted longest-lived-first (by
// the shader's per-blade fade key), so truncating instanceCount by distance
// is exact: the dropped tail is precisely the blades the fade has already
// shrunk to nothing — they cost full vertex work otherwise (measured: grass
// was 14.6M of 14.8M rendered triangles). The TAPER below that additionally
// thins mid-distance density toward a floor — a real (mild) visual reduction,
// tune the constants to taste.
const GRASS_LOD_TAPER_START = 250; // full density inside this distance
const GRASS_LOD_TAPER_END = 600; // density floor reached here
const GRASS_LOD_TAPER_MIN = 0.6; // fraction of full density at the floor
const GRASS_CHUNK_HALF_DIAG = (GRASS_CHUNK_SIZE * Math.SQRT2) / 2;

/** Dispose a chunk's geometry WITHOUT killing the shared blade quad: the
 *  base position/uv/index buffers are shared by EVERY chunk of every
 *  GrassField, and geometry.dispose() deallocates each attached attribute's
 *  GL buffer — detach them first so only this chunk's instance attributes
 *  are freed. */
const disposeChunkGeometry = (geo: THREE.BufferGeometry): void => {
  geo.deleteAttribute("position");
  geo.deleteAttribute("uv");
  geo.setIndex(null);
  geo.dispose();
};

// ── Shared resources (module-level, never disposed) ──

let defaultBladeTexture: THREE.CanvasTexture | null = null;

/** Procedurally drawn tapered grass blade — near-white so uColor defines the color. */
const getDefaultBladeTexture = (): THREE.CanvasTexture => {
  if (defaultBladeTexture) return defaultBladeTexture;

  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;

  const grad = ctx.createLinearGradient(0, 128, 0, 0);
  grad.addColorStop(0, "#a8a8a8");
  grad.addColorStop(1, "#ffffff");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(6, 128);
  ctx.quadraticCurveTo(9, 50, 16, 4);
  ctx.quadraticCurveTo(23, 50, 26, 128);
  ctx.closePath();
  ctx.fill();

  defaultBladeTexture = new THREE.CanvasTexture(canvas);
  defaultBladeTexture.colorSpace = THREE.SRGBColorSpace;
  return defaultBladeTexture;
};

let baseBladeGeometry: THREE.PlaneGeometry | null = null;

/** 1x1 quad with the pivot at the bottom; 3 height segments so sway bends smoothly. */
const getBaseBladeGeometry = (): THREE.PlaneGeometry => {
  if (!baseBladeGeometry) {
    baseBladeGeometry = new THREE.PlaneGeometry(1, 1, 1, 3);
    baseBladeGeometry.translate(0, 0.5, 0);
  }
  return baseBladeGeometry;
};

/**
 * FOLIAGE: instanced, billboarded grass cover — the class's reference
 * implementation (see ../Foliage.tsx for why foliage is its own class).
 * Blade placement runs in grass.worker.ts per 32-unit chunk (deterministic,
 * filtered by biome/height/slope); each chunk is one alpha-tested instanced
 * draw call. Billboarding and wind sway run entirely on the GPU.
 */
export const GrassField: React.FC<GrassFieldProps> = ({
  density = 800_000,
  biomeIds,
  heightRange,
  slopeRange = [0, 35],
  slopeBlend = 10,
  color = "#6a9c45",
  png,
  bladeWidth = 0.12,
  bladeHeight = 1.2,
  sway = 0.15,
  swaySpeed = 1.2,
  renderDistance: renderDistanceProp,
  seed = "grass",
  quantization,
}) => {
  const renderDistance = useFoliageRenderDistance(renderDistanceProp, 120);
  const groupRef = useRef<THREE.Group>(null);
  const chunksRef = useRef(new Map<number, GrassChunk>());
  const pendingRef = useRef(new Set<number>());
  const generationRef = useRef(0); // bumped on param change so stale worker results are discarded
  const frameCountRef = useRef(0);
  const workerReadyRef = useRef(false);
  const mountedRef = useRef(true);
  // Scan gate: once a pass finds nothing to request and nothing is in
  // flight, the eviction+candidate sweep can't produce new work until the
  // camera enters another grass cell — skip it (the uTime write stays live).
  const settledRef = useRef(false);
  const lastCellRef = useRef({ cx: Number.NaN, cz: Number.NaN });

  const { camera } = useThree();
  const { terrain_loaded, progress } = useGameContext();

  // When mounted inside a <Biome> and no explicit biomeIds are given,
  // restrict placement to that biome.
  const biomeCtx = useContext(BiomeContext);
  const effectiveBiomeIds = biomeIds ?? (biomeCtx ? [biomeCtx.biomeId] : undefined);

  const texture = useMemo(() => {
    if (!png) return getDefaultBladeTexture();
    const tex = new THREE.TextureLoader().load(png);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [png]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new THREE.Color(color) },
          uMap: { value: texture },
          uSway: { value: sway },
          uSwaySpeed: { value: swaySpeed },
          uBladeWidth: { value: bladeWidth },
          uBladeHeight: { value: bladeHeight },
          uRenderDistance: { value: renderDistance },
          // without a per-field override, share the global grid-size uniform (never mutated here)
          uGridSize: quantization !== undefined ? { value: quantization } : _quantization.uniforms.uGridSize,
          // shared day/night uniform object — updated by the cycle each frame
          uNightBlend: NIGHT_BLEND_UNIFORM,
        },
        vertexShader: GRASS_VERTEX_SHADER,
        fragmentShader: GRASS_FRAGMENT_SHADER,
        side: THREE.DoubleSide,
      }),
    // scalar uniforms are kept in sync below without rebuilding the material;
    // quantization picks its uniform object at creation, so it rebuilds
    [texture, quantization],
  );

  useEffect(() => {
    material.uniforms.uColor.value.set(color);
    material.uniforms.uSway.value = sway;
    material.uniforms.uSwaySpeed.value = swaySpeed;
    material.uniforms.uBladeWidth.value = bladeWidth;
    material.uniforms.uBladeHeight.value = bladeHeight;
    material.uniforms.uRenderDistance.value = renderDistance;
  }, [material, color, sway, swaySpeed, bladeWidth, bladeHeight, renderDistance]);

  const params: GrassChunkParams = useMemo(
    () => ({
      seed,
      chunkSize: GRASS_CHUNK_SIZE,
      density,
      biomeIds: effectiveBiomeIds,
      heightRange,
      slopeRange,
      slopeBlend,
    }),
    // stringify array props so inline literals don't retrigger a rebuild every render
    [
      seed,
      density,
      slopeBlend,
      JSON.stringify(effectiveBiomeIds),
      JSON.stringify(heightRange),
      JSON.stringify(slopeRange),
    ],
  );

  useEffect(() => {
    // the shared grass worker initializes with the committed world config
    whenWorldReady()
      .then(() => initGrassWorker(getActiveWorldConfig()))
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
    settledRef.current = false;
    lastCellRef.current.cx = Number.NaN; // force the next pass through the gate
  }, []);

  // Rebuild all chunks when placement params or the material change; tear down on unmount
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
      if (png) texture.dispose(); // the default texture is shared — never dispose it
    };
  }, [texture, png]);

  const requestChunk = (key: number, cx: number, cz: number) => {
    pendingRef.current.add(key);
    const generation = generationRef.current;

    generateGrassChunk(cx, cz, params).then((result) => {
      if (!mountedRef.current || generation !== generationRef.current) return;
      pendingRef.current.delete(key);

      if (result.count === 0) {
        chunksRef.current.set(key, { cx, cz, mesh: null, count: 0 });
        return;
      }

      const base = getBaseBladeGeometry();
      const geo = new THREE.InstancedBufferGeometry();
      geo.setIndex(base.getIndex());
      geo.setAttribute("position", base.getAttribute("position"));
      geo.setAttribute("uv", base.getAttribute("uv"));
      geo.setAttribute("offset", new THREE.InstancedBufferAttribute(result.offsets, 3));
      geo.setAttribute("bladeData", new THREE.InstancedBufferAttribute(result.bladeData, 3));
      geo.instanceCount = result.count;

      // manual bounding sphere so per-chunk frustum culling works — in the
      // mesh's own (chunk-origin) frame, since the mesh is no longer at 0
      const half = GRASS_CHUNK_SIZE / 2;
      const centerY = (result.minY + result.maxY + bladeHeight) / 2;
      const radiusY = (result.maxY - result.minY) / 2 + bladeHeight + Math.abs(sway) + 1;
      geo.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(half, centerY, half),
        Math.sqrt(half * half * 2 + radiusY * radiusY),
      );

      const mesh = new THREE.Mesh(geo, material);
      // The shader reads the chunk origin off modelMatrix[3] to rebase blade
      // positions — see GRASS_VERTEX_SHADER.
      mesh.position.set(cx * GRASS_CHUNK_SIZE, 0, cz * GRASS_CHUNK_SIZE);
      // Pay the ~200KB instance-attribute upload NOW (chunk arrivals are
      // already budget-staggered) instead of when the player turns toward it.
      uploadOnFirstDraw(mesh);
      chunksRef.current.set(key, { cx, cz, mesh, count: result.count });
      groupRef.current?.add(mesh);
    });
  };

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;

    frameCountRef.current++;
    if (frameCountRef.current % UPDATE_INTERVAL_FRAMES !== 0) return;
    if (!workerReadyRef.current) return;
    if (!terrain_loaded && progress < MIN_TERRAIN_PROGRESS) return;

    const px = camera.position.x;
    const pz = camera.position.z;
    const centerCX = Math.floor(px / GRASS_CHUNK_SIZE);
    const centerCZ = Math.floor(pz / GRASS_CHUNK_SIZE);

    // Early-out: settled (last pass found nothing to request), nothing in
    // flight, and the camera is still in the same grass cell — the sweep
    // below can't produce new work. (Eviction is deferred at most one cell of
    // travel by this; the ×1.25 hysteresis dwarfs a 32u cell.)
    if (
      settledRef.current &&
      pendingRef.current.size === 0 &&
      centerCX === lastCellRef.current.cx &&
      centerCZ === lastCellRef.current.cz
    ) {
      return;
    }
    lastCellRef.current.cx = centerCX;
    lastCellRef.current.cz = centerCZ;

    // Evict chunks well outside the render distance (hysteresis wide enough
    // that boundary chunks don't thrash between evict and re-request)
    const keepDistSq = (renderDistance * 1.25) ** 2;
    chunksRef.current.forEach((chunk, key) => {
      const dx = (chunk.cx + 0.5) * GRASS_CHUNK_SIZE - px;
      const dz = (chunk.cz + 0.5) * GRASS_CHUNK_SIZE - pz;
      const distSq = dx * dx + dz * dz;
      if (distSq > keepDistSq) {
        if (chunk.mesh) {
          groupRef.current?.remove(chunk.mesh);
          disposeChunkGeometry(chunk.mesh.geometry);
        }
        chunksRef.current.delete(key);
      } else if (chunk.mesh) {
        // Truncate to the blades still visible at this distance (instances
        // arrive fade-sorted — see GRASS_LOD constants above). dNear uses the
        // chunk's nearest possible blade so nothing visible is ever cut;
        // +0.03 pads the uniform-hash count estimate.
        const dNear = Math.max(0, Math.sqrt(distSq) - GRASS_CHUNK_HALF_DIAG);
        const t = (dNear / renderDistance - 0.55) / 0.45;
        const fadeFrac = 1 - Math.min(Math.max(t, 0), 1) + 0.03;
        const taperT = Math.min(
          Math.max((dNear - GRASS_LOD_TAPER_START) / (GRASS_LOD_TAPER_END - GRASS_LOD_TAPER_START), 0),
          1
        );
        const taperFrac = 1 - taperT * (1 - GRASS_LOD_TAPER_MIN);
        const frac = Math.min(1, fadeFrac, taperFrac);
        (chunk.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = Math.ceil(
          chunk.count * frac
        );
      }
    });

    // Request missing chunks, nearest first
    if (pendingRef.current.size >= MAX_PENDING_CHUNKS) {
      settledRef.current = false;
      return;
    }

    const radius = Math.ceil(renderDistance / GRASS_CHUNK_SIZE);
    // The per-blade fade (see GRASS_VERTEX_SHADER) zeroes width AND height at
    // fadeEnd = renderDistance × (0.55 + 0.45 × bladeRand), bladeRand < 1 —
    // so NO blade survives past renderDistance. A chunk whose nearest AABB
    // point is at or beyond that can only hold fully-faded (zero-size)
    // blades: never request it. Keep in sync with the shader's fade
    // constants.
    const fadeZeroDistSq = renderDistance * renderDistance;
    const candidates: { key: number; cx: number; cz: number; distSq: number }[] = [];

    for (let dcx = -radius; dcx <= radius; dcx++) {
      for (let dcz = -radius; dcz <= radius; dcz++) {
        const cx = centerCX + dcx;
        const cz = centerCZ + dcz;
        const key = packChunkKey(cx, cz);
        if (chunksRef.current.has(key) || pendingRef.current.has(key)) continue;

        // Nearest point of the chunk's AABB to the camera (XZ), exact — a
        // center-distance test would over-request diagonal chunks.
        const nx = Math.max(cx * GRASS_CHUNK_SIZE - px, 0, px - (cx + 1) * GRASS_CHUNK_SIZE);
        const nz = Math.max(cz * GRASS_CHUNK_SIZE - pz, 0, pz - (cz + 1) * GRASS_CHUNK_SIZE);
        const distSq = nx * nx + nz * nz;
        if (distSq < fadeZeroDistSq) candidates.push({ key, cx, cz, distSq });
      }
    }

    candidates.sort((a, b) => a.distSq - b.distSq);
    for (const c of candidates) {
      if (pendingRef.current.size >= MAX_PENDING_CHUNKS) break;
      requestChunk(c.key, c.cx, c.cz);
    }
    // Settled only when the sweep found nothing at all and nothing is in
    // flight — a throttled batch (candidates beyond MAX_PENDING) keeps the
    // scan running until every candidate has been built.
    settledRef.current = candidates.length === 0 && pendingRef.current.size === 0;
  });

  return <group ref={groupRef} />;
};
