import { useFrame, useThree } from "@react-three/fiber";
import { useContext, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { getNightBlend, NIGHT_SKY_COLORS } from "../../sky/dayNight";
import { voronoi } from "../../utils/voronoi/voronoi";
import { getActiveRegions, getWorldTerrainParams } from "../registry";
import { BiomeContext, RegionContext, SkyboxRecord, SkyboxSettings, useWorldStore, WorldDataContext, WorldStoreContext } from "./context";

export const SKYBOX_DEFAULTS: SkyboxSettings = {
  topColor: "#4a90d9",
  horizonColor: "#87ceeb",
  bottomColor: "#666666",
  radius: 6000,
};

export interface SkyboxProps {
  topColor?: string;
  horizonColor?: string;
  bottomColor?: string;
  /** Sky sphere radius — only the world-level skybox's radius is used. */
  radius?: number;
}

/**
 * Scope-aware skybox. Where it's mounted decides when it applies:
 *
 * - Inside <World>:  the default sky.
 * - Inside <Region>: active while the player is in that region.
 * - Inside <Biome>:  active while the player is in that biome (wins over region).
 *
 * The SkyboxSystem cross-fades colors between scopes as the player moves.
 * Renders nothing — pure registration.
 */
export const Skybox = ({
  topColor = SKYBOX_DEFAULTS.topColor,
  horizonColor = SKYBOX_DEFAULTS.horizonColor,
  bottomColor = SKYBOX_DEFAULTS.bottomColor,
  radius = SKYBOX_DEFAULTS.radius,
}: SkyboxProps) => {
  const store = useWorldStore("Skybox");
  const biome = useContext(BiomeContext);
  const region = useContext(RegionContext);

  useLayoutEffect(() => {
    const scope = biome ? "biome" : region ? "region" : "world";
    const scopeId = biome ? biome.biomeId : region ? region.regionId : undefined;
    const key = `${scope}/${scopeId ?? "world"}`;
    store.skyboxes.set(key, { scope, scopeId, topColor, horizonColor, bottomColor, radius });
    store.invalidate();
    return () => {
      store.skyboxes.delete(key);
      store.invalidate();
    };
  }, [store, biome, region, topColor, horizonColor, bottomColor, radius]);

  return null;
};

// ── SkyboxSystem — the single sky mesh, mounted by <World> ─────────────────

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vDir = worldPos.xyz - cameraPosition;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 topColor;
uniform vec3 horizonColor;
uniform vec3 bottomColor;
varying vec3 vDir;
void main() {
  float h = normalize(vDir).y;
  vec3 color = h > 0.0
    ? mix(horizonColor, topColor, h)
    : mix(horizonColor, bottomColor, -h);
  // ±0.5/255 screen-space hash dither — the sky gradient changes so slowly
  // that raw 8-bit output shows distinct Mach bands, worst at night.
  color += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  gl_FragColor = vec4(color, 1.0);
}
`;

const BIOME_POLL_INTERVAL = 0.5; // seconds between voronoi lookups (only when scoped skyboxes exist)
const COLOR_LERP_RATE = 2; // higher = faster sky cross-fade

// Night palette — the day/night cycle blends every resolved sky toward these
const _nightTop = new THREE.Color(NIGHT_SKY_COLORS.top);
const _nightHorizon = new THREE.Color(NIGHT_SKY_COLORS.horizon);
const _nightBottom = new THREE.Color(NIGHT_SKY_COLORS.bottom);

/**
 * Renders the sky and resolves which registered <Skybox> is active:
 * biome-scoped (current biome) > region-scoped (first region containing the
 * current biome) > world-scoped > built-in defaults. Colors cross-fade;
 * the current biome is polled off-thread via the voronoi worker only when
 * region/biome-scoped skyboxes are registered.
 */
export const SkyboxSystem = () => {
  const store = useContext(WorldStoreContext);
  const { version } = useContext(WorldDataContext);
  const { camera } = useThree();

  const meshRef = useRef<THREE.Mesh>(null);
  const currentBiomeIdRef = useRef<number | null>(null);
  const pollTimerRef = useRef(0);
  const pollInFlightRef = useRef(false);

  const skyboxes = useMemo<SkyboxRecord[]>(
    // version dep re-reads the store whenever registrations change
    () => (store ? Array.from(store.skyboxes.values()) : []),
    [store, version]
  );
  const worldSky = useMemo(
    () => skyboxes.find((s) => s.scope === "world") ?? SKYBOX_DEFAULTS,
    [skyboxes]
  );
  const hasScoped = useMemo(() => skyboxes.some((s) => s.scope !== "world"), [skyboxes]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: {
          topColor: { value: new THREE.Color(SKYBOX_DEFAULTS.topColor) },
          horizonColor: { value: new THREE.Color(SKYBOX_DEFAULTS.horizonColor) },
          bottomColor: { value: new THREE.Color(SKYBOX_DEFAULTS.bottomColor) },
        },
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      }),
    []
  );
  useLayoutEffect(() => () => material.dispose(), [material]);

  // Snap to the world sky on first commit (before any scoped resolution).
  useLayoutEffect(() => {
    if (currentBiomeIdRef.current === null) {
      material.uniforms.topColor.value.set(worldSky.topColor);
      material.uniforms.horizonColor.value.set(worldSky.horizonColor);
      material.uniforms.bottomColor.value.set(worldSky.bottomColor);
    }
  }, [material, worldSky]);

  const resolveTarget = (): SkyboxSettings => {
    const biomeId = currentBiomeIdRef.current;
    if (biomeId !== null && hasScoped) {
      const biomeSky = skyboxes.find((s) => s.scope === "biome" && s.scopeId === biomeId);
      if (biomeSky) return biomeSky;
      const region = getActiveRegions().find((r) => r.biomes.some((b) => b.id === biomeId));
      if (region) {
        const regionSky = skyboxes.find((s) => s.scope === "region" && s.scopeId === region.id);
        if (regionSky) return regionSky;
      }
    }
    return worldSky;
  };

  const targetColors = useRef({
    top: new THREE.Color(),
    horizon: new THREE.Color(),
    bottom: new THREE.Color(),
  });

  useFrame((_, delta) => {
    // Follow the camera so the sky never leaves render distance
    if (meshRef.current) meshRef.current.position.copy(camera.position);

    // Poll the current biome only when a scoped skybox could change the sky
    if (hasScoped && !pollInFlightRef.current) {
      pollTimerRef.current += delta;
      if (pollTimerRef.current >= BIOME_POLL_INTERVAL) {
        pollTimerRef.current = 0;
        const regions = getActiveRegions();
        if (regions.length > 0) {
          pollInFlightRef.current = true;
          const params = getWorldTerrainParams();
          voronoi
            .create({
              seed: params.seed,
              currentVertex: new THREE.Vector2(camera.position.x, camera.position.z),
              gridSize: params.gridSize,
              regionGridSize: params.regionGridSize,
              regions,
            })
            .then((result: any) => {
              currentBiomeIdRef.current = result.biome?.id ?? null;
            })
            .finally(() => {
              pollInFlightRef.current = false;
            });
        }
      }
    }

    const target = resolveTarget();
    const t = targetColors.current;
    t.top.set(target.topColor);
    t.horizon.set(target.horizonColor);
    t.bottom.set(target.bottomColor);

    // Day/night cycle: whatever sky is active (world/region/biome scoped),
    // mix it toward the night palette by the current blend.
    const nightBlend = getNightBlend();
    if (nightBlend > 0) {
      t.top.lerp(_nightTop, nightBlend);
      t.horizon.lerp(_nightHorizon, nightBlend);
      t.bottom.lerp(_nightBottom, nightBlend);
    }

    const alpha = 1 - Math.exp(-COLOR_LERP_RATE * delta);
    material.uniforms.topColor.value.lerp(t.top, alpha);
    material.uniforms.horizonColor.value.lerp(t.horizon, alpha);
    material.uniforms.bottomColor.value.lerp(t.bottom, alpha);
  });

  return (
    <mesh ref={meshRef} renderOrder={-1000}>
      <sphereGeometry args={[worldSky.radius, 32, 16]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
};
