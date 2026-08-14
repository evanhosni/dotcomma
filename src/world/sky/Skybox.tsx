import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useContext, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { getNightBlend, NIGHT_SKY_COLORS } from "../../lighting/dayNight";
import { voronoi } from "../../utils/voronoi/voronoi";
import { getActiveRegions, getTerrainParams } from "../domains/utils";
import { BiomeContext, RegionContext, SkyboxRecord, SkyboxSettings, useDomainStore, DomainDataContext, DomainStoreContext } from "../components/context";

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
  /** Sky sphere radius — only the domain-level skybox's radius is used. */
  radius?: number;
}

/**
 * Scope-aware skybox. Where it's mounted decides when it applies:
 *
 * - Inside <Domain>:  the default sky.
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
  const store = useDomainStore("Skybox");
  const biome = useContext(BiomeContext);
  const region = useContext(RegionContext);

  useLayoutEffect(() => {
    const scope = biome ? "biome" : region ? "region" : "domain";
    const scopeId = biome ? biome.biomeId : region ? region.regionId : undefined;
    const key = `${scope}/${scopeId ?? "domain"}`;
    store.skyboxes.set(key, { scope, scopeId, topColor, horizonColor, bottomColor, radius });
    store.invalidate();
    return () => {
      store.skyboxes.delete(key);
      store.invalidate();
    };
  }, [store, biome, region, topColor, horizonColor, bottomColor, radius]);

  return null;
};

// ── SkyboxSystem — the single sky mesh, mounted by <Domain> ─────────────────

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
 * current biome) > domain-scoped > built-in defaults. Colors cross-fade;
 * the current biome is polled off-thread via the voronoi worker only when
 * region/biome-scoped skyboxes are registered.
 */
export const SkyboxSystem = () => {
  const store = useContext(DomainStoreContext);
  const { version } = useContext(DomainDataContext);
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
  const domainSky = useMemo(
    () => skyboxes.find((s) => s.scope === "domain") ?? SKYBOX_DEFAULTS,
    [skyboxes]
  );
  const hasScoped = useMemo(() => skyboxes.some((s) => s.scope !== "domain"), [skyboxes]);

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

  // Snap to the domain sky on first commit (before any scoped resolution).
  useLayoutEffect(() => {
    if (currentBiomeIdRef.current === null) {
      material.uniforms.topColor.value.set(domainSky.topColor);
      material.uniforms.horizonColor.value.set(domainSky.horizonColor);
      material.uniforms.bottomColor.value.set(domainSky.bottomColor);
    }
  }, [material, domainSky]);

  // Resolved target sky, cached as PARSED colors. Resolution (find/some
  // scans over the registrations + regions) and Color.set(cssString) parsing
  // only happen on the DISCRETE events that can change the answer — a biome
  // poll result or a registration change — never in the frame loop.
  const resolvedColors = useRef({
    top: new THREE.Color(SKYBOX_DEFAULTS.topColor),
    horizon: new THREE.Color(SKYBOX_DEFAULTS.horizonColor),
    bottom: new THREE.Color(SKYBOX_DEFAULTS.bottomColor),
  });

  const resolveTarget = useCallback((): void => {
    let target: SkyboxSettings = domainSky;
    const biomeId = currentBiomeIdRef.current;
    if (biomeId !== null && hasScoped) {
      const biomeSky = skyboxes.find((s) => s.scope === "biome" && s.scopeId === biomeId);
      if (biomeSky) {
        target = biomeSky;
      } else {
        const region = getActiveRegions().find((r) => r.biomes.some((b) => b.id === biomeId));
        const regionSky =
          region && skyboxes.find((s) => s.scope === "region" && s.scopeId === region.id);
        if (regionSky) target = regionSky;
      }
    }
    const c = resolvedColors.current;
    c.top.set(target.topColor);
    c.horizon.set(target.horizonColor);
    c.bottom.set(target.bottomColor);
  }, [skyboxes, hasScoped, domainSky]);

  // Registration-set changes (skyboxes/domainSky memos) re-resolve here; the
  // biome poll below re-resolves on a changed biome id.
  useLayoutEffect(() => resolveTarget(), [resolveTarget]);

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
          const params = getTerrainParams();
          voronoi
            .create({
              seed: params.seed,
              currentVertex: new THREE.Vector2(camera.position.x, camera.position.z),
              gridSize: params.gridSize,
              regionGridSize: params.regionGridSize,
              regions,
            })
            .then((result: any) => {
              const id = result.biome?.id ?? null;
              if (id !== currentBiomeIdRef.current) {
                currentBiomeIdRef.current = id;
                resolveTarget();
              }
            })
            .finally(() => {
              pollInFlightRef.current = false;
            });
        }
      }
    }

    // Frame loop is just the three lerps: cached resolved colors → night
    // blend → uniform smoothing.
    const resolved = resolvedColors.current;
    const t = targetColors.current;
    t.top.copy(resolved.top);
    t.horizon.copy(resolved.horizon);
    t.bottom.copy(resolved.bottom);

    // Day/night cycle: whatever sky is active (domain/region/biome scoped),
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
      <sphereGeometry args={[domainSky.radius, 32, 16]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
};
