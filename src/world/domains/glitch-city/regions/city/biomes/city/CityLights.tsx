import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { CitySitePoint, getCityLightSites } from "../../../../../../../objects/dressing/dressingWorker";
import { getNightBlend } from "../../../../../../../lighting/dayNight";
import { TaskQueue } from "../../../../../../../utils/task-queue/TaskQueue";

// Fixed pool size — the scene's light count must stay constant from first
// frame onward (a varying light count forces a full shader recompile of
// every lit material). Unused lights park below the world at zero intensity
// instead of unmounting.
const POOL_SIZE = 6;
const PARK_Y = -1e6;
const RESCAN_DISTANCE = 200; // camera travel between site scans
const RESELECT_DISTANCE = 20; // camera travel between nearest-site re-picks
// Additive sprites below this opacity contribute nothing visible but still
// cost a near-fullscreen alpha pass each — turn them off entirely.
const AURA_MIN_VISIBLE_OPACITY = 0.005;

// Site scans run in the dressing WORKER (they used to run computeVertexData
// per site on the main thread — with flatten pads, each site could compute a
// pad tile synchronously: a periodic lag spike every RESCAN_DISTANCE of
// roaming). The queue just serializes scan requests.
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
  /** Domain-space WIDTH of the aura sprite — oversize it well past the city
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
  // Nearest-POOL_SIZE selection, recomputed only when the camera has moved
  // RESELECT_DISTANCE or the site set changed (bumped by the scan task) — a
  // per-frame [...sites].sort() allocated and sorted the whole map every frame.
  const assignedRef = useRef<(CitySitePoint | null)[]>(Array.from({ length: POOL_SIZE }, () => null));
  const assignedDistSq = useRef(new Float64Array(POOL_SIZE)).current;
  const sitesVersion = useRef(0);
  const lastSelect = useRef({ x: Infinity, z: Infinity, version: -1 });

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
    // onBeforeCompile alone leaves the default cache key — an unpatched
    // SpriteMaterial elsewhere would silently share (and clobber) this
    // program. The patch is constant, so a constant key suffices.
    mat.customProgramCacheKey = () => "city-lights-aura";
    return mat;
  }, [auraTexture, color]);

  useEffect(
    () => () => {
      auraMaterial.dispose();
      auraTexture.dispose();
    },
    [auraMaterial, auraTexture],
  );

  // Light transforms are only written on reselection now — force one when the
  // props baked into them change.
  useEffect(() => {
    lastSelect.current.version = -1;
  }, [intensity, heightOffset]);

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
          sitesVersion.current++; // set changed — force a nearest-site re-pick
        } finally {
          scanning.current = false;
        }
      });
    }

    // Assign the pool to the nearest sites; park the rest. Single-pass
    // top-POOL_SIZE insertion into reused arrays, recomputed only when the
    // camera has moved RESELECT_DISTANCE or the site set changed — sites are
    // static in between, so the light/sprite transforms can't change either.
    const sel = lastSelect.current;
    const assigned = assignedRef.current;
    if (
      (camX - sel.x) ** 2 + (camZ - sel.z) ** 2 > RESELECT_DISTANCE * RESELECT_DISTANCE ||
      sel.version !== sitesVersion.current
    ) {
      sel.x = camX;
      sel.z = camZ;
      sel.version = sitesVersion.current;

      for (let i = 0; i < POOL_SIZE; i++) assigned[i] = null;
      let count = 0;
      sites.forEach((p) => {
        const d = (p.x - camX) * (p.x - camX) + (p.z - camZ) * (p.z - camZ);
        if (count < POOL_SIZE) count++;
        else if (d >= assignedDistSq[POOL_SIZE - 1]) return;
        let i = count - 1;
        while (i > 0 && assignedDistSq[i - 1] > d) {
          assignedDistSq[i] = assignedDistSq[i - 1];
          assigned[i] = assigned[i - 1];
          i--;
        }
        assignedDistSq[i] = d;
        assigned[i] = p;
      });

      for (let i = 0; i < POOL_SIZE; i++) {
        const light = lightRefs.current[i];
        if (!light) continue;
        const site = assigned[i];
        const sprite = spriteRefs.current[i];
        if (site) {
          light.position.set(site.x, site.y + heightOffset, site.z);
          light.intensity = intensity;
          if (sprite) sprite.position.copy(light.position);
        } else {
          light.position.set(0, PARK_Y, 0);
          light.intensity = 0;
        }
      }
    }

    // Aura strength: always faintly present, blooming toward full at night so
    // it reads as city glow after dark (shared material — one write). Below
    // the visibility floor the additive passes buy nothing — hide the sprites
    // (visibility is per-frame: it follows the day/night blend, not the
    // reselection above).
    const effectiveAuraOpacity = aura ? auraOpacity * (0.2 + 0.8 * getNightBlend()) : 0;
    auraMaterial.opacity = effectiveAuraOpacity;
    const showAura = aura && effectiveAuraOpacity >= AURA_MIN_VISIBLE_OPACITY;
    for (let i = 0; i < POOL_SIZE; i++) {
      const sprite = spriteRefs.current[i];
      if (sprite) sprite.visible = showAura && assigned[i] !== null;
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
