import { useFrame, useThree } from "@react-three/fiber";
import { getServerTime } from "../../net/connection";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { isMainRenderFrame } from "../../vfx/frameCap";
import {
  DAY_DURATION_MS,
  DAY_NIGHT_CYCLE_TRANSITION_MS,
  MOON_DIRECTION,
  NIGHT_DURATION_MS,
  nightBlendAt,
  setNightBlend,
  SUN_DIRECTION,
  tickWindowLights,
} from "../../lighting/dayNight";
import {
  buildCrescent,
  buildDisc,
  buildStarField,
  jitterBody,
  JITTER_INTERVAL_S,
  MOON_DISTANCE,
  MOON_ROUNDNESS,
  MOON_SIZE,
  MOON_VERTICES_COUNT,
  STAR_COUNT,
  STAR_DISTANCE,
  SUN_DISTANCE,
  SUN_ROUNDNESS,
  SUN_SIZE,
  SUN_VERTICES_COUNT,
} from "./celestialBodies";

/** A body shrinks away with its presence (never to 0 scale: the warm-up draw needs a triangle) and faces the camera. */
const placeCelestialBody = (mesh: THREE.Mesh | null, presence: number, camera: THREE.Camera): void => {
  if (!mesh) return;
  mesh.visible = presence > 0.02;
  mesh.scale.setScalar(Math.max(presence, 0.001));
  mesh.quaternion.copy(camera.quaternion);
};

interface DayNightCycleProps {
  dayDurationMs?: number;
  nightDurationMs?: number;
  transitionMs?: number;
}

export const DayNightCycle = ({
  dayDurationMs = DAY_DURATION_MS,
  nightDurationMs = NIGHT_DURATION_MS,
  transitionMs = DAY_NIGHT_CYCLE_TRANSITION_MS,
}: DayNightCycleProps) => {
  const { camera, gl, scene } = useThree();

  const groupRef = useRef<THREE.Group>(null);
  const sunRef = useRef<THREE.Mesh>(null);
  const moonRef = useRef<THREE.Mesh>(null);
  const starsRef = useRef<THREE.Points>(null);

  const sun = useMemo(() => buildDisc(SUN_SIZE, SUN_VERTICES_COUNT, SUN_ROUNDNESS), []);
  const moon = useMemo(() => buildCrescent(MOON_SIZE, MOON_VERTICES_COUNT, MOON_ROUNDNESS), []);

  const sunMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ color: 0xffd93b, side: THREE.DoubleSide, toneMapped: false, fog: false }),
    [],
  );
  const moonMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ color: 0xf4f6ff, side: THREE.DoubleSide, toneMapped: false, fog: false }),
    [],
  );

  const stars = useMemo(() => buildStarField(STAR_COUNT, STAR_DISTANCE), []);
  const starMaterial = useMemo(
    () =>
      new THREE.PointsMaterial({
        color: 0xeef2ff,
        size: 2.2,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      }),
    [],
  );

  useEffect(() => {
    return () => {
      sun.geometry.dispose();
      moon.geometry.dispose();
      stars.dispose();
      sunMaterial.dispose();
      moonMaterial.dispose();
      starMaterial.dispose();
    };
  }, [sun, moon, stars, sunMaterial, moonMaterial, starMaterial]);

  // Precompile the night-only programs at mount (the nightfall hitch, see
  // CLAUDE.md). Must compile the SCENE (light counts are in the program cache
  // key), with the day-invisible moon/stars flipped visible (gl.compile uses
  // traverseVisible), one frame late so the lights are mounted first.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const celestial = [sunRef.current, moonRef.current, starsRef.current];
      const prev = celestial.map((o) => o?.visible ?? false);
      celestial.forEach((o) => o && (o.visible = true));
      gl.compile(scene, camera);
      celestial.forEach((o, i) => o && (o.visible = prev[i]));
    });
    return () => cancelAnimationFrame(raf);
  }, [gl, scene, camera]);

  const jitterTimer = useRef(0);
  // gl.compile links programs but only a REAL draw uploads buffers; the warm
  // draws are imperceptible (moon at scale 0.001, stars at opacity 0).
  const warmFramesRef = useRef(2);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    // Server clock, so every player sees the same time of day.
    const blend = nightBlendAt(getServerTime(), dayDurationMs, nightDurationMs, transitionMs);
    setNightBlend(blend);
    tickWindowLights(delta * 1000);

    const sunPresence = 1 - blend;
    const moonPresence = blend;

    group.position.copy(camera.position);

    const sunMesh = sunRef.current;
    const moonMesh = moonRef.current;
    placeCelestialBody(sunMesh, sunPresence, camera);
    placeCelestialBody(moonMesh, moonPresence, camera);
    if (starsRef.current) {
      starMaterial.opacity = blend * 0.9;
      starsRef.current.visible = blend > 0.01;
    }

    // Counted in PRESENTED frames: under an FPS cap a skipped tick draws nothing.
    if (warmFramesRef.current > 0) {
      if (isMainRenderFrame()) warmFramesRef.current--;
      if (sunMesh) sunMesh.visible = true;
      if (moonMesh) moonMesh.visible = true;
      if (starsRef.current) starsRef.current.visible = true;
    }

    jitterTimer.current += delta;
    if (jitterTimer.current >= JITTER_INTERVAL_S) {
      jitterTimer.current = 0;
      if (sunMesh?.visible) jitterBody(sun, 1 - sunPresence);
      if (moonMesh?.visible) jitterBody(moon, 1 - moonPresence);
    }
  });

  return (
    <group ref={groupRef}>
      <mesh
        ref={sunRef}
        geometry={sun.geometry}
        material={sunMaterial}
        position={SUN_DIRECTION.clone().multiplyScalar(SUN_DISTANCE)}
        frustumCulled={false}
      />
      <mesh
        ref={moonRef}
        geometry={moon.geometry}
        material={moonMaterial}
        position={MOON_DIRECTION.clone().multiplyScalar(MOON_DISTANCE)}
        frustumCulled={false}
      />
      <points ref={starsRef} geometry={stars} material={starMaterial} frustumCulled={false} />
    </group>
  );
};
