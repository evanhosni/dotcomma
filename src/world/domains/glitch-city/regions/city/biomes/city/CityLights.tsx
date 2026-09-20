import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { CitySitePoint, getCityLightSites } from "../../../../../../../objects/dressing/dressingWorker";
import { getNightBlend } from "../../../../../../../lighting/dayNight";
import { ditherGLSL } from "../../../../../../../vfx/dither";
import { TaskQueue } from "../../../../../../../utils/task-queue/TaskQueue";

// FIXED pool: a changing scene light count recompiles every lit material.
// Unused lights park below the world at zero intensity.
const POOL_SIZE = 6;
const PARK_Y = -1e6;
const RESCAN_DISTANCE = 200; // camera travel between site scans
const RESELECT_DISTANCE = 20; // camera travel between nearest-site re-picks
// Below this an additive sprite is invisible but still costs a near-fullscreen alpha pass.
const AURA_MIN_VISIBLE_OPACITY = 0.005;

const scanQueue = new TaskQueue();

export interface CityLightsProps {
  color?: string;
  intensity?: number;
  /** 0 = no cutoff. */
  distance?: number;
  decay?: number;
  /** Above the terrain at the voronoi site (clears rooftops). */
  heightOffset?: number;
  scanRadius?: number;
  aura?: boolean;
  /** Oversize well past the city cell so neighboring auras wash together. */
  auraSize?: number;
  auraOpacity?: number;
  /** Height / width; low and wide reads as skyline glow, not a floating ball. */
  auraAspect?: number;
}

/** One far-throw point light per city-biome voronoi cell (see CLAUDE.md). */
export const CityLights = ({
  color = "#ffdb8d",
  // Brightness = intensity / d^decay at hundreds of units, so decay is the
  // REACH knob (1 → 1.1 roughly halves the lit radius) and intensity dims uniformly.
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
  const nearestSitesRef = useRef<(CitySitePoint | null)[]>(Array.from({ length: POOL_SIZE }, () => null));
  const nearestSiteDistSq = useRef(new Float64Array(POOL_SIZE)).current;
  const sitesVersion = useRef(0);
  const lastSelect = useRef({ x: Infinity, z: Infinity, version: -1 });

  // Deliberately NO hot core: overlapping sprites must read as one hazy area, not glowing balls.
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
    // Dither the ALPHA (the banding lives in the alpha ramp): the slow radial
    // gradient quantizes into visible rings at 8 bits.
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "outgoingLight = diffuseColor.rgb;",
        `${ditherGLSL("diffuseColor.a")}
	outgoingLight = diffuseColor.rgb;`,
      );
    };
    // Without a key an unpatched SpriteMaterial elsewhere would share (and clobber) this program.
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

  // Transforms are only written on reselection — force one when their props change.
  useEffect(() => {
    lastSelect.current.version = -1;
  }, [intensity, heightOffset]);

  useFrame(({ camera }) => {
    const camX = camera.position.x;
    const camZ = camera.position.z;

    const movedSq = lastScan.current
      ? (camX - lastScan.current.x) ** 2 + (camZ - lastScan.current.z) ** 2
      : Infinity;
    if (!scanning.current && movedSq > RESCAN_DISTANCE * RESCAN_DISTANCE) {
      scanning.current = true;
      const sx = camX;
      const sz = camZ;
      scanQueue.addTask(async () => {
        try {
          const points = await getCityLightSites(sx - scanRadius, sz - scanRadius, sx + scanRadius, sz + scanRadius);
          points.forEach((p) => sites.set(p.key, p));
          sites.forEach((p, key) => {
            if (Math.hypot(p.x - sx, p.z - sz) > scanRadius * 1.5) sites.delete(key);
          });
          lastScan.current = { x: sx, z: sz };
          sitesVersion.current++;
        } finally {
          scanning.current = false;
        }
      });
    }

    // Nearest-POOL_SIZE pick, recomputed only on RESELECT_DISTANCE travel or a
    // site-set change (a per-frame [...sites].sort() allocated every frame).
    const sel = lastSelect.current;
    const assigned = nearestSitesRef.current;
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
        else if (d >= nearestSiteDistSq[POOL_SIZE - 1]) return;
        let i = count - 1;
        while (i > 0 && nearestSiteDistSq[i - 1] > d) {
          nearestSiteDistSq[i] = nearestSiteDistSq[i - 1];
          assigned[i] = assigned[i - 1];
          i--;
        }
        nearestSiteDistSq[i] = d;
        assigned[i] = p;
      });

      for (let i = 0; i < POOL_SIZE; i++) {
        const light = lightRefs.current[i];
        if (!light) continue;
        const site = assigned[i];
        const sprite = spriteRefs.current[i];
        if (site) {
          light.position.set(site.x, site.y + heightOffset, site.z);
          if (sprite) sprite.position.copy(light.position);
        } else {
          light.position.set(0, PARK_Y, 0);
        }
      }
    }

    // Zero intensity by day lets every lit material's light loop skip the beacons.
    const nightBlend = getNightBlend();
    const litIntensity = intensity * nightBlend;
    for (let i = 0; i < POOL_SIZE; i++) {
      const light = lightRefs.current[i];
      if (!light) continue;
      const target = assigned[i] ? litIntensity : 0;
      if (light.intensity !== target) light.intensity = target;
    }

    const effectiveAuraOpacity = aura ? auraOpacity * (0.2 + 0.8 * nightBlend) : 0;
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
