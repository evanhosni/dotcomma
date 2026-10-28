import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { CitySitePoint, getCityLightSites } from "../../../../../../../objects/dressing/worker";
import { BUILDING_SPRITE_LOD } from "../../../../../../../objects/actors/building/spec";
import { getNightBlend } from "../../../../../../../lighting/dayNight";
import { smoothstep } from "../../../../../../../utils/math";
import { ditherGLSL } from "../../../../../../../vfx/dither";
import { BACKGROUND_RANK, TaskQueue } from "../../../../../../../utils/task-queue/TaskQueue";

// FIXED pools: a changing scene light count recompiles every lit material.
// Unused lights park below the world at zero intensity.
const LIGHT_POOL_SIZE = 6;
/** The auras reach as far as the buildings' far sprites, so a far city's glow reads at night though its
 *  light would light nothing: more slots than lights. */
const AURA_POOL_SIZE = 16;
const PARK_Y = -1e6;
const RESCAN_DISTANCE = 200; // camera travel between site scans
// Small: a light's fade is measured against the site just outside the pool, which a late re-pick misjudges.
const RESELECT_DISTANCE = 4; // camera travel between nearest-site re-picks
/** A pooled light fades out over this much distance before the next-nearest site outranks it, and a
 *  site entering the pool fades in over it: the pool's re-picks used to switch lights on and off. */
const RANK_FADE_BAND = 250;
/** Sites fade in from the scan's edge (fractions of scanRadius) instead of appearing when a scan finds them. */
const SCAN_FADE_START = 0.6;
const SCAN_FADE_END = 0.9;
/** An aura fades out over this last share of its distance. */
const AURA_FADE_SHARE = 0.25;
/** An aura fades out as its center nears the camera's view plane (view depth, units): a sprite is
 *  screen-aligned, so it vanished whole the moment the camera passed it — an abrupt change in light. */
const AURA_NEAR_HIDE = 120;
const AURA_NEAR_SHOW = 450;
// Below this an additive sprite is invisible but still costs a near-fullscreen alpha pass.
const AURA_MIN_VISIBLE_OPACITY = 0.005;

// Background work: the scan is always near the camera, but a light site list a moment late costs nothing.
const scanQueue = new TaskQueue({ bias: BACKGROUND_RANK + 1 });

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
  /** How far an aura reaches (default: the buildings' sprite distance), fading over its last quarter. */
  auraDistance?: number;
}

/** A soft radial glow. Deliberately NO hot core: overlapping sprites must read as one hazy area, not glowing balls. */
const createAuraTexture = (): THREE.CanvasTexture => {
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
};

/** One per sprite (each fades on its own), all on ONE program through the cache key. */
const createAuraMaterial = (map: THREE.Texture, color: string): THREE.SpriteMaterial => {
  const mat = new THREE.SpriteMaterial({
    map,
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
};

/** Fills `nearest` (and `nearestDistSq`, ascending) with the `nearest.length` sites closest to
 *  (camX, camZ); null past the site count. An insertion sort into a fixed array: no allocation. */
const selectNearestSites = (
  sites: ReadonlyMap<string, CitySitePoint>,
  camX: number,
  camZ: number,
  nearest: (CitySitePoint | null)[],
  nearestDistSq: Float64Array,
): void => {
  const capacity = nearest.length;
  for (let i = 0; i < capacity; i++) nearest[i] = null;
  let count = 0;
  sites.forEach((p) => {
    const d = (p.x - camX) * (p.x - camX) + (p.z - camZ) * (p.z - camZ);
    if (count < capacity) count++;
    else if (d >= nearestDistSq[capacity - 1]) return;
    let i = count - 1;
    while (i > 0 && nearestDistSq[i - 1] > d) {
      nearestDistSq[i] = nearestDistSq[i - 1];
      nearest[i] = nearest[i - 1];
      i--;
    }
    nearestDistSq[i] = d;
    nearest[i] = p;
  });
};

/** A pool's slots: the nearest `size` sites plus the first outside it (each slot's fade is measured against that one). */
class SitePool {
  readonly assigned: (CitySitePoint | null)[];
  readonly distSq: Float64Array;
  constructor(readonly size: number) {
    this.assigned = Array.from({ length: size + 1 }, () => null);
    this.distSq = new Float64Array(size + 1);
  }
  select(sites: ReadonlyMap<string, CitySitePoint>, camX: number, camZ: number): void {
    selectNearestSites(sites, camX, camZ, this.assigned, this.distSq);
  }
  /** How lit slot `i` is (0–1): fading out as the first site outside the pool closes in on it, and
   *  over the last share of `reach`. Continuous through every re-pick: a slot changes sites only at weight ~0. */
  weight(i: number, camX: number, camZ: number, fadeStart: number, reach: number): number {
    const site = this.assigned[i];
    if (!site) return 0;
    const d = Math.hypot(site.x - camX, site.z - camZ);
    const next = this.assigned[this.size];
    const rank = next ? Math.min(1, Math.max(0, (Math.hypot(next.x - camX, next.z - camZ) - d) / RANK_FADE_BAND)) : 1;
    return rank * (1 - smoothstep(fadeStart, reach, d));
  }
}

const _forward = new THREE.Vector3();

/** One far-throw point light per city-biome voronoi cell (see CLAUDE.md), and an aura sprite per cell
 *  out to the sprite distance. */
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
  auraDistance = BUILDING_SPRITE_LOD.renderDistance,
}: CityLightsProps) => {
  const lightRefs = useRef<(THREE.PointLight | null)[]>([]);
  const spriteRefs = useRef<(THREE.Sprite | null)[]>([]);
  const sites = useRef(new Map<string, CitySitePoint>()).current;
  const scanning = useRef(false);
  const lastScan = useRef<{ x: number; z: number } | null>(null);
  const lightPool = useRef(new SitePool(LIGHT_POOL_SIZE)).current;
  const auraPool = useRef(new SitePool(AURA_POOL_SIZE)).current;
  const sitesVersion = useRef(0);
  const lastSelect = useRef({ x: Infinity, z: Infinity, version: -1 });
  // Sites are scanned as far as the farther of the lights and the auras.
  const scanReach = Math.max(scanRadius, auraDistance);

  const auraTexture = useMemo(createAuraTexture, []);
  const auraMaterials = useMemo(
    () => Array.from({ length: AURA_POOL_SIZE }, () => createAuraMaterial(auraTexture, color)),
    [auraTexture, color],
  );

  useEffect(
    () => () => {
      auraMaterials.forEach((m) => m.dispose());
      auraTexture.dispose();
    },
    [auraMaterials, auraTexture],
  );

  // Transforms are only written on reselection — force one when their props change.
  useEffect(() => {
    lastSelect.current.version = -1;
  }, [intensity, heightOffset]);

  /** Every RESCAN_DISTANCE of travel, refreshes the city sites within the scan reach (background work). */
  const rescanSites = (camX: number, camZ: number): void => {
    const movedSq = lastScan.current
      ? (camX - lastScan.current.x) ** 2 + (camZ - lastScan.current.z) ** 2
      : Infinity;
    if (scanning.current || !(movedSq > RESCAN_DISTANCE * RESCAN_DISTANCE)) return;
    scanning.current = true;
    const sx = camX;
    const sz = camZ;
    scanQueue.addTask(async () => {
      try {
        const points = await getCityLightSites(sx - scanReach, sz - scanReach, sx + scanReach, sz + scanReach);
        points.forEach((p) => sites.set(p.key, p));
        sites.forEach((p, key) => {
          if (Math.hypot(p.x - sx, p.z - sz) > scanReach * 1.5) sites.delete(key);
        });
        lastScan.current = { x: sx, z: sz };
        sitesVersion.current++;
      } finally {
        scanning.current = false;
      }
    });
  };

  /** Moves each pool onto its nearest sites (parking the rest), only after RESELECT_DISTANCE of
   *  travel or a site-set change. Lights are interchangeable, so a site changing slots changes nothing. */
  const reassignPools = (camX: number, camZ: number): void => {
    const sel = lastSelect.current;
    const moved = (camX - sel.x) ** 2 + (camZ - sel.z) ** 2 > RESELECT_DISTANCE * RESELECT_DISTANCE;
    if (!moved && sel.version === sitesVersion.current) return;
    sel.x = camX;
    sel.z = camZ;
    sel.version = sitesVersion.current;

    lightPool.select(sites, camX, camZ);
    auraPool.select(sites, camX, camZ);
    for (let i = 0; i < LIGHT_POOL_SIZE; i++) {
      const light = lightRefs.current[i];
      if (!light) continue;
      const site = lightPool.assigned[i];
      if (site) light.position.set(site.x, site.y + heightOffset, site.z);
      else light.position.set(0, PARK_Y, 0);
    }
    for (let i = 0; i < AURA_POOL_SIZE; i++) {
      const sprite = spriteRefs.current[i];
      if (!sprite) continue;
      const site = auraPool.assigned[i];
      if (site) sprite.position.set(site.x, site.y + heightOffset, site.z);
      else sprite.position.set(0, PARK_Y, 0);
    }
  };

  /** Light intensities and the auras' opacities follow the night blend and each slot's weight; an aura
   *  also fades as the camera comes up to it. */
  const applyWeights = (camera: THREE.Camera): void => {
    const camX = camera.position.x;
    const camZ = camera.position.z;
    // Zero intensity by day lets every lit material's light loop skip the beacons.
    const nightBlend = getNightBlend();
    const auraBase = aura ? auraOpacity * (0.2 + 0.8 * nightBlend) : 0;
    camera.getWorldDirection(_forward);
    for (let i = 0; i < LIGHT_POOL_SIZE; i++) {
      const light = lightRefs.current[i];
      if (!light) continue;
      const target = intensity * nightBlend * lightPool.weight(i, camX, camZ, scanRadius * SCAN_FADE_START, scanRadius * SCAN_FADE_END);
      if (light.intensity !== target) light.intensity = target;
    }
    for (let i = 0; i < AURA_POOL_SIZE; i++) {
      const sprite = spriteRefs.current[i];
      if (!sprite) continue;
      let opacity = auraBase * auraPool.weight(i, camX, camZ, auraDistance * (1 - AURA_FADE_SHARE), auraDistance);
      if (opacity >= AURA_MIN_VISIBLE_OPACITY) {
        const p = sprite.position;
        const viewDepth =
          (p.x - camera.position.x) * _forward.x + (p.y - camera.position.y) * _forward.y + (p.z - camera.position.z) * _forward.z;
        opacity *= smoothstep(AURA_NEAR_HIDE, AURA_NEAR_SHOW, viewDepth);
      }
      auraMaterials[i].opacity = opacity;
      sprite.visible = opacity >= AURA_MIN_VISIBLE_OPACITY;
    }
  };

  useFrame(({ camera }) => {
    rescanSites(camera.position.x, camera.position.z);
    reassignPools(camera.position.x, camera.position.z);
    applyWeights(camera);
  });

  return (
    <>
      {Array.from({ length: LIGHT_POOL_SIZE }, (_, i) => (
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
        Array.from({ length: AURA_POOL_SIZE }, (_, i) => (
          <sprite
            key={i}
            ref={(s) => {
              spriteRefs.current[i] = s;
            }}
            position={[0, PARK_Y, 0]}
            scale={[auraSize, auraSize * auraAspect, 1]}
            visible={false}
            material={auraMaterials[i]}
          />
        ))}
    </>
  );
};
