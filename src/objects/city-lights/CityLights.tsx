import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { getNightBlend } from "../../sky/dayNight";
import { TaskQueue } from "../../utils/task-queue/TaskQueue";
import { CitySitePoint } from "../../workers/vertexCompute";
import { getCityLightSites } from "../../world/vertexData";

// Fixed pool size — the scene's light count must stay constant from first
// frame onward (see IndoorLightRig: a varying light count forces a full
// shader recompile of every lit material). Unused lights park below the
// world at zero intensity instead of unmounting.
const POOL_SIZE = 6;
const PARK_Y = -1e6;
const RESCAN_DISTANCE = 200; // camera travel between site scans

// Site scans run computeVertexData per city site on the main thread —
// budgeted through a queue like the road markers.
const scanQueue = new TaskQueue();

export interface CityLightsProps {
  color?: string;
  /** Physical (candela-style) intensity — falloff is intensity / d^decay. */
  intensity?: number;
  /** Cutoff distance; 0 = no cutoff, the light reaches everywhere. */
  distance?: number;
  decay?: number;
  /** Light height above the terrain at the voronoi point (clears rooftops). */
  heightOffset?: number;
  /** Camera radius within which city sites are found and lit. */
  scanRadius?: number;
  /** Show the sky aura (additive glow sprite) over each beacon. */
  aura?: boolean;
  /** World-space WIDTH of the aura sprite — oversize it well past the city
   *  cell so neighboring auras overlap and wash together. */
  auraSize?: number;
  /** Peak aura opacity (scaled down toward daytime by the night blend). */
  auraOpacity?: number;
  /** Aura height as a fraction of its width — low and wide reads as an
   *  area glow over the skyline instead of a floating ball. */
  auraAspect?: number;
}

/**
 * One bright point light at the voronoi point of each city-biome cell — a
 * city-center beacon whose throw extends well past the city bounds. Site
 * positions come from the shared vertex pipeline (getCityLightSites), so the
 * light sits exactly at the cell's seeded voronoi center. Note the terrain
 * and grass shaders are unlit — the light lands on lit materials (GLTF
 * actors, building exteriors, etc.).
 */
export const CityLights = ({
  color = "#ffdb8d",
  // Falloff is intensity / d^decay, so decay is the SPREAD knob and intensity
  // must be read against it (d is hundreds of units — the exponent dominates).
  // 2500 @ decay 1.4 is half the ground brightness of the previous
  // 100000 @ decay 2 profile with double its visible reach (~4400u vs ~2200u);
  // the two curves cross around 500u out.
  // Brightness = intensity / d^decay: intensity dims uniformly, decay pulls
  // the REACH in (the exponent dominates at hundreds of units — going
  // 1 → 1.1 roughly halves the lit radius while barely dimming up close).
  intensity = 200,
  distance = 0,
  decay = 1.2,
  heightOffset = 150,
  scanRadius = 1800,
  aura = true,
  auraSize = 1400,
  auraOpacity = 0.1,
  auraAspect = 0.35,
}: CityLightsProps) => {
  const lightRefs = useRef<(THREE.PointLight | null)[]>([]);
  const spriteRefs = useRef<(THREE.Sprite | null)[]>([]);
  const sites = useRef(new Map<string, CitySitePoint>()).current;
  const scanning = useRef(false);
  const lastScan = useRef<{ x: number; z: number } | null>(null);

  // Soft radial-gradient glow, generated once — additive, so it brightens
  // whatever sky/skyline is behind it. Deliberately NO hot core: a broad dim
  // center with a long tail, so overlapping sprites read as one hazy area of
  // light pollution rather than distinct glowing balls.
  const auraTexture = useMemo(() => {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0.0, "rgba(255,255,255,0.5)");
    g.addColorStop(0.35, "rgba(255,255,255,0.3)");
    g.addColorStop(0.65, "rgba(255,255,255,0.11)");
    g.addColorStop(1.0, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
  }, []);

  const auraMaterial = useMemo(() => {
    const mat = new THREE.SpriteMaterial({
      map: auraTexture,
      color,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    // Dither the alpha with ±0.5/255 screen-space hash noise: the radial
    // gradient is slow enough that its additive contribution quantizes into
    // visible rings at 8 bits (alpha, not rgb — the banding lives in the
    // alpha ramp, and noise scaled by the color survives the blend).
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "outgoingLight = diffuseColor.rgb;",
        `diffuseColor.a += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
	outgoingLight = diffuseColor.rgb;`,
      );
    };
    return mat;
  }, [auraTexture, color]);

  useEffect(
    () => () => {
      auraMaterial.dispose();
      auraTexture.dispose();
    },
    [auraMaterial, auraTexture],
  );

  useFrame(({ camera }) => {
    const camX = camera.position.x;
    const camZ = camera.position.z;

    const moved = lastScan.current ? Math.hypot(camX - lastScan.current.x, camZ - lastScan.current.z) : Infinity;
    if (!scanning.current && moved > RESCAN_DISTANCE) {
      scanning.current = true;
      const sx = camX;
      const sz = camZ;
      scanQueue.addTask(async () => {
        try {
          const points = await getCityLightSites(sx - scanRadius, sz - scanRadius, sx + scanRadius, sz + scanRadius);
          points.forEach((p) => sites.set(p.key, p));
          // Evict sites left far behind so the map stays bounded (positions
          // are deterministic — a revisit re-derives the identical point).
          sites.forEach((p, key) => {
            if (Math.hypot(p.x - sx, p.z - sz) > scanRadius * 1.5) sites.delete(key);
          });
          lastScan.current = { x: sx, z: sz };
        } finally {
          scanning.current = false;
        }
      });
    }

    // Assign the pool to the nearest sites; park the rest. The site count in
    // range is small (cells are gridSize-sized), so the per-frame sort is cheap.
    const sorted = [...sites.values()].sort(
      (a, b) =>
        (a.x - camX) * (a.x - camX) +
        (a.z - camZ) * (a.z - camZ) -
        ((b.x - camX) * (b.x - camX) + (b.z - camZ) * (b.z - camZ)),
    );
    // Aura strength: always faintly present, blooming toward full at night so
    // it reads as city glow after dark (shared material — one write).
    auraMaterial.opacity = aura ? auraOpacity * (0.2 + 0.8 * getNightBlend()) : 0;

    for (let i = 0; i < POOL_SIZE; i++) {
      const light = lightRefs.current[i];
      if (!light) continue;
      const site = sorted[i];
      const sprite = spriteRefs.current[i];
      if (site) {
        light.position.set(site.x, site.y + heightOffset, site.z);
        light.intensity = intensity;
        if (sprite) {
          sprite.position.copy(light.position);
          sprite.visible = aura;
        }
      } else {
        light.position.set(0, PARK_Y, 0);
        light.intensity = 0;
        if (sprite) sprite.visible = false;
      }
    }
  });

  return (
    <>
      {Array.from({ length: POOL_SIZE }, (_, i) => (
        <pointLight
          key={i}
          ref={(l) => {
            lightRefs.current[i] = l;
          }}
          position={[0, PARK_Y, 0]}
          intensity={0}
          color={color}
          distance={distance}
          decay={decay}
        />
      ))}
      {aura &&
        Array.from({ length: POOL_SIZE }, (_, i) => (
          <sprite
            key={i}
            ref={(s) => {
              spriteRefs.current[i] = s;
            }}
            position={[0, PARK_Y, 0]}
            scale={[auraSize, auraSize * auraAspect, 1]}
            visible={false}
            material={auraMaterial}
          />
        ))}
    </>
  );
};
