import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useContext, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { getNightBlend, NIGHT_SKY_COLORS } from "../../lighting/dayNight";
import { ditherGLSL } from "../../vfx/dither";
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

/** Scope-aware registration: under <Domain> = default sky, <Region>/<Biome> =
 *  active while the player is there (biome wins). SkyboxSystem cross-fades. */
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
  // Dither: the slow gradient shows 8-bit Mach bands otherwise, worst at night.
  ${ditherGLSL("color")}
  gl_FragColor = vec4(color, 1.0);
}
`;

const BIOME_POLL_INTERVAL = 0.5; // seconds
const COLOR_LERP_RATE = 2; // higher = faster sky cross-fade

const _nightTop = new THREE.Color(NIGHT_SKY_COLORS.top);
const _nightHorizon = new THREE.Color(NIGHT_SKY_COLORS.horizon);
const _nightBottom = new THREE.Color(NIGHT_SKY_COLORS.bottom);

/** The sky mesh. Active sky = biome-scoped > region-scoped > domain > defaults;
 *  the biome is polled via the voronoi worker only when scoped skyboxes exist. */
export const SkyboxSystem = () => {
  const store = useContext(DomainStoreContext);
  const { registrationVersion } = useContext(DomainDataContext);
  const { camera } = useThree();

  const meshRef = useRef<THREE.Mesh>(null);
  const currentBiomeIdRef = useRef<number | null>(null);
  const pollTimerRef = useRef(0);
  const pollInFlightRef = useRef(false);

  const skyboxes = useMemo<SkyboxRecord[]>(
    () => (store ? Array.from(store.skyboxes.values()) : []),
    [store, registrationVersion]
  );
  const domainSky = useMemo(
    () => skyboxes.find((s) => s.scope === "domain") ?? SKYBOX_DEFAULTS,
    [skyboxes]
  );
  const hasScopedSkyboxes = useMemo(() => skyboxes.some((s) => s.scope !== "domain"), [skyboxes]);

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

  // Snap to the domain sky on first commit.
  useLayoutEffect(() => {
    if (currentBiomeIdRef.current === null) {
      material.uniforms.topColor.value.set(domainSky.topColor);
      material.uniforms.horizonColor.value.set(domainSky.horizonColor);
      material.uniforms.bottomColor.value.set(domainSky.bottomColor);
    }
  }, [material, domainSky]);

  // Parsed once per discrete change (poll result, registration) — never in the frame loop.
  const resolvedColors = useRef({
    top: new THREE.Color(SKYBOX_DEFAULTS.topColor),
    horizon: new THREE.Color(SKYBOX_DEFAULTS.horizonColor),
    bottom: new THREE.Color(SKYBOX_DEFAULTS.bottomColor),
  });

  const resolveTarget = useCallback((): void => {
    let target: SkyboxSettings = domainSky;
    const biomeId = currentBiomeIdRef.current;
    if (biomeId !== null && hasScopedSkyboxes) {
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
  }, [skyboxes, hasScopedSkyboxes, domainSky]);

  useLayoutEffect(() => resolveTarget(), [resolveTarget]);

  const targetColors = useRef({
    top: new THREE.Color(),
    horizon: new THREE.Color(),
    bottom: new THREE.Color(),
  });

  useFrame((_, delta) => {
    if (meshRef.current) meshRef.current.position.copy(camera.position);

    if (hasScopedSkyboxes && !pollInFlightRef.current) {
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
              currentVertex: { x: camera.position.x, z: camera.position.z },
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

    const resolved = resolvedColors.current;
    const t = targetColors.current;
    t.top.copy(resolved.top);
    t.horizon.copy(resolved.horizon);
    t.bottom.copy(resolved.bottom);

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
