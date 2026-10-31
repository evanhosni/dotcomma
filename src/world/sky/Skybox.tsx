import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { getNightBlend, NIGHT_SKY_COLORS } from "../../lighting/dayNight";
import { ditherGLSL } from "../../vfx/dither";
import { childrenOfKind, declare } from "../content";
import type { ContentNode } from "../content/types";
import { getActiveRegions, getActiveSkyboxes } from "../domains/utils";
import { onPlaceChange, type PlayerPlace } from "../place";

export interface SkyboxSettings {
  topColor: string;
  horizonColor: string;
  bottomColor: string;
  radius: number;
}

export const SKYBOX_DEFAULTS: SkyboxSettings = {
  topColor: "#4a90d9",
  horizonColor: "#87ceeb",
  bottomColor: "#666666",
  radius: 6000,
};

export interface SkyboxProps {
  /** One color for the whole sky: the default of the three below. */
  color?: string;
  topColor?: string;
  horizonColor?: string;
  bottomColor?: string;
  /** Sky sphere radius — only the domain-level skybox's radius is used. */
  radius?: number;
}

export interface SkyboxRecord extends SkyboxSettings {
  scope: "domain" | "region" | "biome";
  scopeId?: number;
}

/** The SKY of whatever it is mounted in: under <Domain> the default, under a <Region> that
 *  region's — MIXED by position across region edges, so the sky never snaps at one — and under a
 *  <Biome> one that wins while the player stands in it. SkyboxSystem cross-fades between them. */
export const Skybox = declare<SkyboxProps>({ kind: "skybox", within: ["domain", "region", "biome"] });

const settingsOf = (node: ContentNode<SkyboxProps>): SkyboxSettings => ({
  topColor: node.props.topColor ?? node.props.color ?? SKYBOX_DEFAULTS.topColor,
  horizonColor: node.props.horizonColor ?? node.props.color ?? SKYBOX_DEFAULTS.horizonColor,
  bottomColor: node.props.bottomColor ?? node.props.color ?? SKYBOX_DEFAULTS.bottomColor,
  radius: node.props.radius ?? SKYBOX_DEFAULTS.radius,
});

/** Every <Skybox> in a domain's tree, with the scope its place in the tree gives it. */
export const skyboxesOf = (domain: ContentNode<any>): SkyboxRecord[] => {
  const out: SkyboxRecord[] = [];
  for (const sky of childrenOfKind<SkyboxProps>(domain, "skybox")) out.push({ scope: "domain", ...settingsOf(sky) });
  for (const region of childrenOfKind<{ id: number }>(domain, "region")) {
    for (const sky of childrenOfKind<SkyboxProps>(region, "skybox")) out.push({ scope: "region", scopeId: region.props.id, ...settingsOf(sky) });
    for (const biome of childrenOfKind<{ id: number }>(region, "biome")) {
      for (const sky of childrenOfKind<SkyboxProps>(biome, "skybox")) out.push({ scope: "biome", scopeId: biome.props.id, ...settingsOf(sky) });
    }
  }
  return out;
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

const COLOR_LERP_RATE = 2; // higher = faster sky cross-fade

const _nightTop = new THREE.Color(NIGHT_SKY_COLORS.top);
const _nightHorizon = new THREE.Color(NIGHT_SKY_COLORS.horizon);
const _nightBottom = new THREE.Color(NIGHT_SKY_COLORS.bottom);
const _mix = new THREE.Color();

/** The sky mesh. Target = biome-scoped > the position-weighted mix of region skies
 *  (domain default for regions without one); the place is polled off-thread only when
 *  scoped skyboxes exist. */
export const SkyboxSystem = () => {
  const { camera } = useThree();

  const meshRef = useRef<THREE.Mesh>(null);
  const placeRef = useRef<PlayerPlace | null>(null);

  const skyboxes = getActiveSkyboxes();
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
    if (placeRef.current === null) {
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
    const c = resolvedColors.current;
    const place = placeRef.current;
    const setAll = (target: SkyboxSettings) => {
      c.top.set(target.topColor);
      c.horizon.set(target.horizonColor);
      c.bottom.set(target.bottomColor);
    };
    if (place === null || !hasScopedSkyboxes) {
      setAll(domainSky);
      return;
    }
    const biomeSky = skyboxes.find((s) => s.scope === "biome" && s.scopeId === place.biomeId);
    if (biomeSky) {
      setAll(biomeSky);
      return;
    }
    // Region skies mix by the place's cross-fade weights — no edge, ever.
    c.top.setRGB(0, 0, 0);
    c.horizon.setRGB(0, 0, 0);
    c.bottom.setRGB(0, 0, 0);
    const regions = getActiveRegions();
    for (const { id, weight } of place.regionWeights) {
      if (weight <= 0 || !regions.some((r) => r.id === id)) continue;
      const sky = skyboxes.find((s) => s.scope === "region" && s.scopeId === id) ?? domainSky;
      c.top.add(_mix.set(sky.topColor).multiplyScalar(weight));
      c.horizon.add(_mix.set(sky.horizonColor).multiplyScalar(weight));
      c.bottom.add(_mix.set(sky.bottomColor).multiplyScalar(weight));
    }
  }, [skyboxes, hasScopedSkyboxes, domainSky]);

  useLayoutEffect(() => resolveTarget(), [resolveTarget]);
  useEffect(
    () =>
      onPlaceChange((place) => {
        placeRef.current = place;
        resolveTarget();
      }),
    [resolveTarget],
  );

  const targetColors = useRef({
    top: new THREE.Color(),
    horizon: new THREE.Color(),
    bottom: new THREE.Color(),
  });

  useFrame((_, delta) => {
    if (meshRef.current) meshRef.current.position.copy(camera.position);

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
