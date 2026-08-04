import { useFrame, useThree } from "@react-three/fiber";
import React, { useCallback, useContext, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGameContext } from "../../context/GameContext";
import { _quantization } from "../../utils/quantization/quantization";
import { BiomeContext } from "../../world/components/context";
import { getActiveWorldConfig, whenWorldReady } from "../../world/registry";
import { generateGrassChunk, GrassChunkParams, initGrassWorker } from "./grassWorker";
import { GrassFieldProps } from "./types";

const GRASS_CHUNK_SIZE = 32; // world units per grass chunk (one instanced draw call each)
const MAX_PENDING_CHUNKS = 2; // worker requests in flight at once
const UPDATE_INTERVAL_FRAMES = 10;

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

  vec3 pos = offset + right * (position.x * width);
  pos.y += position.y * height;

  // wind: bend grows quadratically toward the tip, gusts travel across the field
  float bend = uv.y * uv.y * uSway * scale * fade;
  float t = uTime * uSwaySpeed;
  float gust = sin(t + (offset.x + offset.z) * 0.15 + phase);
  float flutter = sin(t * 2.3 + phase * 2.0) * 0.3;
  pos.x += (gust + flutter) * bend;
  pos.z += cos(t * 0.7 + (offset.x - offset.z) * 0.12 + phase) * bend * 0.7;

  pos = quantizeWorldPos(pos);

  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`;

const GRASS_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;

varying vec2 vUv;
varying float vTint;

void main() {
  vec4 tex = texture2D(uMap, vUv);
  if (tex.a < 0.5) discard;
  // per-blade tint variation + slight darkening toward the base
  vec3 col = uColor * tex.rgb * (0.85 + vTint * 0.3) * (0.75 + 0.25 * vUv.y);
  gl_FragColor = vec4(col, 1.0);
}
`;

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
 * Instanced, billboarded grass cover. Blade placement runs in grass.worker.ts
 * per 32-unit chunk (deterministic, filtered by biome/height/slope); each
 * chunk is one alpha-tested instanced draw call. Billboarding and wind sway
 * run entirely on the GPU.
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
  renderDistance = 120,
  seed = "grass",
  quantization,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const chunksRef = useRef(new Map<string, THREE.Mesh | null>()); // null = built but empty
  const pendingRef = useRef(new Set<string>());
  const generationRef = useRef(0); // bumped on param change so stale worker results are discarded
  const frameCountRef = useRef(0);
  const workerReadyRef = useRef(false);
  const mountedRef = useRef(true);

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
    chunksRef.current.forEach((mesh) => {
      if (mesh) {
        groupRef.current?.remove(mesh);
        mesh.geometry.dispose();
      }
    });
    chunksRef.current.clear();
    pendingRef.current.clear();
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

  const requestChunk = (key: string, cx: number, cz: number) => {
    pendingRef.current.add(key);
    const generation = generationRef.current;

    generateGrassChunk(cx, cz, params).then((result) => {
      if (!mountedRef.current || generation !== generationRef.current) return;
      pendingRef.current.delete(key);

      if (result.count === 0) {
        chunksRef.current.set(key, null);
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

      // manual bounding sphere so per-chunk frustum culling works
      const half = GRASS_CHUNK_SIZE / 2;
      const centerY = (result.minY + result.maxY + bladeHeight) / 2;
      const radiusY = (result.maxY - result.minY) / 2 + bladeHeight + Math.abs(sway) + 1;
      geo.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(cx * GRASS_CHUNK_SIZE + half, centerY, cz * GRASS_CHUNK_SIZE + half),
        Math.sqrt(half * half * 2 + radiusY * radiusY),
      );

      const mesh = new THREE.Mesh(geo, material);
      chunksRef.current.set(key, mesh);
      groupRef.current?.add(mesh);
    });
  };

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;

    frameCountRef.current++;
    if (frameCountRef.current % UPDATE_INTERVAL_FRAMES !== 0) return;
    if (!workerReadyRef.current) return;
    if (!terrain_loaded && progress < 0.5) return;

    const px = camera.position.x;
    const pz = camera.position.z;

    // Evict chunks well outside the render distance
    const keepDistSq = (renderDistance + GRASS_CHUNK_SIZE * 2) ** 2;
    chunksRef.current.forEach((mesh, key) => {
      const [cx, cz] = key.split("_").map(Number);
      const dx = (cx + 0.5) * GRASS_CHUNK_SIZE - px;
      const dz = (cz + 0.5) * GRASS_CHUNK_SIZE - pz;
      if (dx * dx + dz * dz > keepDistSq) {
        if (mesh) {
          groupRef.current?.remove(mesh);
          mesh.geometry.dispose();
        }
        chunksRef.current.delete(key);
      }
    });

    // Request missing chunks, nearest first
    if (pendingRef.current.size >= MAX_PENDING_CHUNKS) return;

    const centerCX = Math.floor(px / GRASS_CHUNK_SIZE);
    const centerCZ = Math.floor(pz / GRASS_CHUNK_SIZE);
    const radius = Math.ceil(renderDistance / GRASS_CHUNK_SIZE);
    const maxDistSq = (renderDistance + GRASS_CHUNK_SIZE) ** 2;
    const candidates: { key: string; cx: number; cz: number; distSq: number }[] = [];

    for (let dcx = -radius; dcx <= radius; dcx++) {
      for (let dcz = -radius; dcz <= radius; dcz++) {
        const cx = centerCX + dcx;
        const cz = centerCZ + dcz;
        const key = `${cx}_${cz}`;
        if (chunksRef.current.has(key) || pendingRef.current.has(key)) continue;

        const dx = (cx + 0.5) * GRASS_CHUNK_SIZE - px;
        const dz = (cz + 0.5) * GRASS_CHUNK_SIZE - pz;
        const distSq = dx * dx + dz * dz;
        if (distSq <= maxDistSq) candidates.push({ key, cx, cz, distSq });
      }
    }

    candidates.sort((a, b) => a.distSq - b.distSq);
    for (const c of candidates) {
      if (pendingRef.current.size >= MAX_PENDING_CHUNKS) break;
      requestChunk(c.key, c.cx, c.cz);
    }
  });

  return <group ref={groupRef} />;
};
