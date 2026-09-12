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
import { createDefaultsGroup, warnUnsupportedSync } from "../utils";
import { FoliageChunkParams, generateFoliageChunk, initFoliageWorker } from "./foliageWorker";

/**
 * FOLIAGE — the mass-GPU-vegetation class of the game-object hierarchy (see
 * objects/types.ts for the class overview and the shared base attributes).
 *
 * The three classes, by scale and statefulness:
 *   - ACTORS   (objects/actors/Actor.tsx): per-object spawns with identity,
 *     state, or interaction — beebles, buildings. Hundreds at once, tops.
 *   - DRESSING (objects/dressing/Dressing.tsx): mass stateless rigid scenery —
 *     InstancedMeshes assembled on the main thread from worker point lists,
 *     ~10²–10³ instances per 256u chunk (lamps, markers, signals, poles).
 *   - FOLIAGE  (this file): vegetation at yet another order of magnitude — up
 *     to ~32k instances per 64u chunk, so placement streams from the foliage
 *     worker as transferable Float32Arrays STRAIGHT into GPU instance
 *     attributes (never per-point JS objects), and all animation (billboarding,
 *     wind sway) runs in the vertex shader. Per-chunk bounding spheres keep
 *     frustum culling effective at this density.
 *
 * Foliage deliberately does NOT extend the Dressing chunk base: Dressing's
 * point-list → Matrix4-per-instance assembly would be a regression at these
 * instance counts.
 *
 * THIS FILE IS THE WHOLE PIPELINE — chunk lifecycle, worker streaming, the
 * instanced billboard mesh, the shader (billboarding, sway, per-instance fade,
 * quantization, world curvature, the night dim), the distance LOD, and
 * disposal. A plant type is NOT a new pipeline: it is <FoliageField> with
 * different props, and createFoliage() bakes a set of them into a named
 * component (grass/GrassField.tsx is the first). Anything shared by two plants
 * belongs here.
 */

/** Shared defaults for a biome's foliage features. */
export type FoliageDefaults = Pick<FoliageAttributes, "renderDistance">;

/**
 * Groups a biome's foliage, mirroring <Actors>/<Dressing>: props set here act
 * as shared defaults for the children — a child's own props always win
 * (shared group pattern: objects/utils.tsx).
 *
 *   <Foliage renderDistance={140}>
 *     <GrassField color="#6a9c45" />
 *   </Foliage>
 */
const FoliageGroup = createDefaultsGroup<FoliageDefaults>("foliage");
export const Foliage = FoliageGroup.Group;

/** Resolve a feature's renderDistance: own prop > <Foliage> group > default. */
export const useFoliageRenderDistance = (own: number | undefined, featureDefault: number): number => {
  const ctx = FoliageGroup.useDefaults();
  return own ?? ctx.renderDistance ?? featureDefault;
};

// ── Chunking ────────────────────────────────────────────────────────────────

/** World units per foliage chunk (one instanced draw call each). 64 (was 32:
 *  a 500u field is ~190 draws instead of ~770, all sharing one program) is a
 *  whole multiple of both quantization grids, so the chunk-relative lattice
 *  the shader works in IS the world lattice — see the rebase note in the
 *  vertex shader below. */
const FOLIAGE_CHUNK_SIZE = 64;
const MAX_PENDING_CHUNKS = 4; // worker requests in flight at once
const UPDATE_INTERVAL_FRAMES = 3;
// Foliage starts filling in ahead of the object spawn system (ActorPool gates
// on progress 0.5) so ground cover lands before objects pop in.
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

  // The offset attribute is an ABSOLUTE world position, and float32 resolves
  // only ~0.008u at 100k units from the origin — a third of the 0.025u
  // quantization grid. Quantizing (or projecting) in absolute space therefore
  // made every instance flicker between lattice cells as the camera moved,
  // worse the further out the player went. Positions are built relative to
  // the chunk origin instead: the mesh sits at its chunk origin, an exact
  // multiple of FOLIAGE_CHUNK_SIZE (itself a whole multiple of every
  // quantization grid, so the relative lattice IS the world lattice), and the
  // subtraction below is exact because an instance is never more than one
  // chunk from that origin. Camera-relative and wind terms keep using the
  // absolute offset: they are differences or low-frequency phases, insensitive
  // to that resolution, and the wind has to stay continuous across chunk
  // borders.
  vec3 chunkOrigin = modelMatrix[3].xyz;
  vec3 offsetRel = offset - chunkOrigin;

  float phase = instanceData.x;
  float scale = instanceData.y;

  // every instance gets its own fade-out distance scattered across the outer
  // 70% of the render distance, so density thins progressively from ~a third
  // of the way out instead of holding full density and hitting a wall — the
  // dominant cost lever at long render distances (full density to 0.55×R made
  // a 500u field ~40% more triangles). The two constants must sum to 1 so no
  // instance survives past uRenderDistance (the chunk-request gate and the
  // instanceCount truncation in FoliageField both assume it — keep all three
  // in sync).
  float instRand = fract(phase * 1.618 + instanceData.z * 12.9898);
  float fadeEnd = uRenderDistance * (0.3 + 0.7 * instRand);
  float dist = distance(cameraPosition.xz, offset.xz);
  float fade = 1.0 - smoothstep(fadeEnd * 0.7, fadeEnd, dist);

  float width = uWidth * scale * fade;
  float height = uHeight * scale * fade;

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
  // per-instance tint variation + slight darkening toward the base
  vec3 col = uColor * tex.rgb * (0.85 + vTint * 0.3) * (0.75 + 0.25 * vUv.y);
  // unlit shader — dim with the day/night cycle like the terrain does
  ${nightDimGLSL("col")}
  gl_FragColor = vec4(col, 1.0);
}
`;

// Chunk coords pack into one exact float64 key (|cx|,|cz| < 2²⁵ ⇒ ±10⁹ world
// units at 64u cells, far past world scale) so the 3-frame scans never build
// a "${cx}_${cz}" string per cell in radius nor parse one back on eviction.
const packChunkKey = (cx: number, cz: number): number => cx * 0x4000000 + cz; // 2^26

interface FoliageChunk {
  cx: number;
  cz: number;
  mesh: THREE.Mesh | null; // null = built but empty
  count: number; // full instance count — instanceCount is truncated by distance
  lowDetail: boolean; // which shared base quad the geometry currently points at
}

// ── Distance-tiered instance counts ──
// The worker delivers each chunk's instances sorted longest-lived-first (by
// the shader's per-instance fade key), so truncating instanceCount by distance
// is exact: the dropped tail is precisely the instances the fade has already
// shrunk to nothing — they cost full vertex work otherwise (measured: grass
// was 14.6M of 14.8M rendered triangles). The TAPER below that additionally
// thins mid-distance density toward a floor — a real visual reduction (the
// dropped tail is the shortest-lived, already-smallest instances, so it reads
// as extra thinning rather than popping). For the taper to do anything it must
// fall FASTER than the fade truncation (frac is the min of the two): the fade
// drops from 1 to 0 across 0.3R→R, so a taper reaching its floor by ~0.7R
// undercuts it in the mid band; the old 600u endpoint fell slower than the
// fade everywhere once the fade start moved to 0.3R, making the taper dead.
const LOD_TAPER_START = 150; // full density inside this distance
const LOD_TAPER_END = 350; // density floor reached here
const LOD_TAPER_MIN = 0.25; // fraction of full density at the floor
const CHUNK_HALF_DIAG = (FOLIAGE_CHUNK_SIZE * Math.SQRT2) / 2;

// ── Distance-tiered blade GEOMETRY ──
// The near quad carries 3 height segments (8 verts, 6 tris) purely so the wind
// bend curves instead of shearing — sub-pixel curvature past ~100u on a ~1u
// blade. Chunks beyond BLADE_DETAIL_DIST swap their shared base attributes for
// a 1-segment quad (4 verts, 2 tris): at a 500u render distance ~90% of the
// retained instances sit out there, so this cuts total foliage triangles ~60%
// for no visible change. The swap only re-points the geometry at the other
// shared index/position/uv buffers (a VAO re-setup on the next draw, nothing
// re-uploads); instance attributes, bounds and instanceCount are untouched,
// and it adds NO per-frame work — it rides the sweep that already runs.
// Hysteresis must exceed a chunk cell's diagonal (~91u at 64u chunks): the settled early-out
// below can defer a sweep by up to one cell of camera travel, and a smaller
// band would let that staleness thrash the swap.
// To A/B this LOD in isolation, set BLADE_DETAIL_DIST = Infinity (disables it).
const BLADE_DETAIL_DIST = 100; // beyond this (chunk-nearest), use the low quad
const BLADE_DETAIL_HYSTERESIS = 92; // swap back to full detail below DIST − this (> the ~91u chunk diagonal)

// ── Shared resources (module-level, never disposed) ──

let baseQuadGeometry: THREE.PlaneGeometry | null = null;
let lowQuadGeometry: THREE.PlaneGeometry | null = null;

/** 1x1 quad with the pivot at the bottom; 3 height segments so sway bends
 *  smoothly. Shared by EVERY chunk of every field. */
const getBaseQuadGeometry = (): THREE.PlaneGeometry => {
  if (!baseQuadGeometry) {
    baseQuadGeometry = new THREE.PlaneGeometry(1, 1, 1, 3);
    baseQuadGeometry.translate(0, 0.5, 0);
  }
  return baseQuadGeometry;
};

/** The far-chunk quad: 1 segment (4 verts, 2 tris vs 8/6) — the wind bend
 *  shears instead of curving, invisible past BLADE_DETAIL_DIST. Shared by
 *  EVERY far chunk of every field. */
const getLowQuadGeometry = (): THREE.PlaneGeometry => {
  if (!lowQuadGeometry) {
    lowQuadGeometry = new THREE.PlaneGeometry(1, 1, 1, 1);
    lowQuadGeometry.translate(0, 0.5, 0);
  }
  return lowQuadGeometry;
};

/** Point a chunk's geometry at one of the two shared base quads. */
const applyBladeDetail = (geo: THREE.BufferGeometry, low: boolean): void => {
  const base = low ? getLowQuadGeometry() : getBaseQuadGeometry();
  geo.setIndex(base.getIndex());
  geo.setAttribute("position", base.getAttribute("position"));
  geo.setAttribute("uv", base.getAttribute("uv"));
};

/** Dispose a chunk's geometry WITHOUT killing the shared quad: the base
 *  position/uv/index buffers are shared by EVERY chunk of every field, and
 *  geometry.dispose() deallocates each attached attribute's GL buffer —
 *  detach them first so only this chunk's instance attributes are freed. */
const disposeChunkGeometry = (geo: THREE.BufferGeometry): void => {
  geo.deleteAttribute("position");
  geo.deleteAttribute("uv");
  geo.setIndex(null);
  geo.dispose();
};

/**
 * A field of one plant type. Placement runs in the foliage worker per 64-unit
 * chunk (deterministic, filtered by biome/height/slope); each chunk is one
 * alpha-tested instanced draw call, billboarded and swayed entirely on the GPU.
 *
 * Mount it inside a biome's <Foliage> group — with no explicit `biomeIds` it
 * restricts itself to the enclosing biome.
 */
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
  serverSynced,
}) => {
  const renderDistance = useFoliageRenderDistance(renderDistanceProp, 500);
  warnUnsupportedSync("foliage", serverSynced);
  const groupRef = useRef<THREE.Group>(null);
  const chunksRef = useRef(new Map<number, FoliageChunk>());
  const pendingRef = useRef(new Set<number>());
  const generationRef = useRef(0); // bumped on param change so stale worker results are discarded
  const frameCountRef = useRef(0);
  const workerReadyRef = useRef(false);
  const mountedRef = useRef(true);
  // Scan gate: once a pass finds nothing to request and nothing is in flight,
  // the eviction+candidate sweep can't produce new work until the camera
  // enters another chunk cell — skip it (the uTime write stays live).
  const settledRef = useRef(false);
  const lastCellRef = useRef({ cx: Number.NaN, cz: Number.NaN });

  const { camera } = useThree();
  const { terrain_loaded, progress } = useGameContext();

  // When mounted inside a <Biome> and no explicit biomeIds are given, restrict
  // placement to that biome.
  const biomeCtx = useContext(BiomeContext);
  const effectiveBiomeIds = biomeIds ?? (biomeCtx ? [biomeCtx.biomeId] : undefined);

  const texture = useMemo(() => {
    if (png) {
      const tex = new THREE.TextureLoader().load(png);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }
    if (textureFactory) return textureFactory();
    // Plain white quad — a field with no art still renders as tinted blades.
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
          // without a per-field override, share the global grid-size uniform (never mutated here)
          uGridSize: quantization !== undefined ? { value: quantization } : _quantization.uniforms.uGridSize,
          // shared world-curvature uniforms (never mutated here)
          uCurveStart: _curvature.uniforms.uCurveStart,
          uCurveK: _curvature.uniforms.uCurveK,
          // shared day/night uniform object — updated by the cycle each frame
          uNightBlend: NIGHT_BLEND_UNIFORM,
        },
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
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
    // stringify array props so inline literals don't retrigger a rebuild every render
    [seed, density, slopeBlend, JSON.stringify(effectiveBiomeIds), JSON.stringify(heightRange), JSON.stringify(slopeRange)],
  );

  useEffect(() => {
    // the shared foliage worker initializes with the committed world config
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
      // a factory-provided texture is shared/cached by the plant type — only
      // a texture this field loaded itself is ours to dispose
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
        chunksRef.current.set(key, { cx, cz, mesh: null, count: 0, lowDetail: false });
        return;
      }

      // Born at the detail its distance calls for — the sweep only handles
      // crossings after that.
      const ccx = (cx + 0.5) * FOLIAGE_CHUNK_SIZE - camera.position.x;
      const ccz = (cz + 0.5) * FOLIAGE_CHUNK_SIZE - camera.position.z;
      const lowDetail = Math.sqrt(ccx * ccx + ccz * ccz) - CHUNK_HALF_DIAG > BLADE_DETAIL_DIST;

      const geo = new THREE.InstancedBufferGeometry();
      applyBladeDetail(geo, lowDetail);
      geo.setAttribute("offset", new THREE.InstancedBufferAttribute(result.offsets, 3));
      geo.setAttribute("instanceData", new THREE.InstancedBufferAttribute(result.instanceData, 3));
      geo.instanceCount = result.count;

      // manual bounding sphere so per-chunk frustum culling works — in the
      // mesh's own (chunk-origin) frame, since the mesh is no longer at 0
      const half = FOLIAGE_CHUNK_SIZE / 2;
      const centerY = (result.minY + result.maxY + height) / 2;
      const radiusY = (result.maxY - result.minY) / 2 + height + Math.abs(sway) + 1;
      geo.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(half, centerY, half),
        Math.sqrt(half * half * 2 + radiusY * radiusY),
      );

      const mesh = new THREE.Mesh(geo, material);
      // The shader reads the chunk origin off modelMatrix[3] to rebase
      // instance positions — see VERTEX_SHADER.
      mesh.position.set(cx * FOLIAGE_CHUNK_SIZE, 0, cz * FOLIAGE_CHUNK_SIZE);
      // Pay the ~200KB instance-attribute upload NOW (chunk arrivals are
      // already budget-staggered) instead of when the player turns toward it.
      uploadOnFirstDraw(mesh);
      chunksRef.current.set(key, { cx, cz, mesh, count: result.count, lowDetail });
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
    const centerCX = Math.floor(px / FOLIAGE_CHUNK_SIZE);
    const centerCZ = Math.floor(pz / FOLIAGE_CHUNK_SIZE);

    // Early-out: settled (last pass found nothing to request), nothing in
    // flight, and the camera is still in the same cell — the sweep below can't
    // produce new work. (Eviction is deferred at most one cell of travel by
    // this; the ×1.25 hysteresis dwarfs a 64u cell.)
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
        // Truncate to the instances still visible at this distance (they
        // arrive fade-sorted — see the LOD constants above). dNear uses the
        // chunk's nearest possible instance so nothing visible is ever cut;
        // +0.03 pads the uniform-hash count estimate.
        const dNear = Math.max(0, Math.sqrt(distSq) - CHUNK_HALF_DIAG);
        const t = (dNear / renderDistance - 0.3) / 0.7;
        const fadeFrac = 1 - Math.min(Math.max(t, 0), 1) + 0.03;
        const taperT = Math.min(Math.max((dNear - LOD_TAPER_START) / (LOD_TAPER_END - LOD_TAPER_START), 0), 1);
        const taperFrac = 1 - taperT * (1 - LOD_TAPER_MIN);
        const frac = Math.min(1, fadeFrac, taperFrac);
        (chunk.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = Math.ceil(chunk.count * frac);

        // Blade-geometry tier (see the BLADE_DETAIL constants above).
        const low = chunk.lowDetail
          ? dNear > BLADE_DETAIL_DIST - BLADE_DETAIL_HYSTERESIS
          : dNear > BLADE_DETAIL_DIST;
        if (low !== chunk.lowDetail) {
          chunk.lowDetail = low;
          applyBladeDetail(chunk.mesh.geometry, low);
        }
      }
    });

    // Request missing chunks, nearest first
    if (pendingRef.current.size >= MAX_PENDING_CHUNKS) {
      settledRef.current = false;
      return;
    }

    const radius = Math.ceil(renderDistance / FOLIAGE_CHUNK_SIZE);
    // The per-instance fade (see VERTEX_SHADER) zeroes width AND height at
    // fadeEnd = renderDistance × (0.3 + 0.7 × instRand), instRand < 1 — so
    // NO instance survives past renderDistance. A chunk whose nearest AABB
    // point is at or beyond that can only hold fully-faded (zero-size)
    // instances: never request it. Keep in sync with the shader's fade
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
    // Settled only when the sweep found nothing at all and nothing is in
    // flight — a throttled batch (candidates beyond MAX_PENDING) keeps the
    // scan running until every candidate has been built.
    settledRef.current = candidates.length === 0 && pendingRef.current.size === 0;
  });

  return <group ref={groupRef} />;
};

/**
 * One-liner for a plant type: bakes a set of FoliageAttributes into a named
 * component whose own props are overrides — the foliage twin of createActor.
 *
 *   export const GrassField = createFoliage({ seed: "grass", height: 1.2, … });
 *   …
 *   <GrassField density={8_000_000} color="#6fff00" />
 *
 * Two plant types must not share a `seed`: identical seeds place identical
 * points, so the fields would grow through each other.
 */
export const createFoliage =
  (defaults: FoliageAttributes) =>
  (overrides: FoliageAttributes): JSX.Element =>
    <FoliageField {...defaults} {...overrides} />;
