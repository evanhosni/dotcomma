import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { isMainRenderFrame } from "../../vfx/frameCap";
import { DAY_DURATION_MS, DAY_NIGHT_CYCLE_TRANSITION_MS, MOON_DIRECTION, NIGHT_DURATION_MS, setNightBlend, SUN_DIRECTION, tickWindowLights } from "../../lighting/dayNight";

/**
 * Day/night cycle: a jittery low-poly sun parked in one spot of the sky, a
 * crescent moon on the opposite side, and stars that fade in at night.
 *
 * The sun sits still through the day, then over `transitionMs` it shrinks and
 * degrades (coarser vertex quantization → even lower poly) until it's gone,
 * while the moon does the reverse; at sunrise the roles swap. Sky colors ride
 * the same blend (SkyboxSystem mixes toward the night palette).
 *
 * Sun and moon are flat billboarded silhouettes (matching the reference orb):
 * an irregular ~11-gon disc and a crescent, whose vertices jitter
 * INDEPENDENTLY on a fixed tick with exaggerated quantization — they wobble
 * even while the player stands still. The whole celestial group follows the
 * camera every frame, so nothing ever leaves render distance.
 */

const SUN_DISTANCE = 5000;
const SUN_SIZE = 1000; // silhouette radius in world units
const SUN_ROUNDNESS = 0.75; // 1 = perfect circle, 0 = very irregular blob
const SUN_VERTICES_COUNT = 10; // rim vertices — fewer = chunkier
const MOON_DISTANCE = 5000;
const MOON_SIZE = 1000;
const MOON_ROUNDNESS = 1; // 1 = clean crescent arcs, 0 = very irregular
const MOON_VERTICES_COUNT = 19; // total boundary vertices across both arcs
const STAR_DISTANCE = 5600;
const STAR_COUNT = 550;

const SUN_DIR = SUN_DIRECTION;
const MOON_DIR = MOON_DIRECTION;

const JITTER_INTERVAL_S = 0.09; // vertex re-jitter tick
const JITTER_AMPLITUDE = 0.07; // × radius, per tick, per vertex
const QUANT_BASE = 0.13; // × radius — the "exaggerated quantization" grid
const QUANT_DEGRADE = 0.55; // extra grid coarseness at full shrink (even lower poly)

interface JitterBody {
  geometry: THREE.BufferGeometry;
  /** Base local position per vertex (the un-jittered silhouette). */
  base: Float32Array;
  radius: number;
}

/** Irregular low-poly disc (the sun): center vertex + `rim` vertices with
 *  uneven radii — vaguely round, clearly asymmetrical. `roundness` 1 = a
 *  regular polygon, 0 = heavily uneven radii and angles. */
const buildDisc = (radius: number, rim: number, roundness: number): JitterBody => {
  const irregularity = 1 - Math.min(Math.max(roundness, 0), 1);
  const positions: number[] = [0, 0, 0];
  for (let i = 0; i < rim; i++) {
    const a = (i / rim) * Math.PI * 2 + (Math.random() - 0.5) * 0.7 * irregularity;
    const r = radius * (1 - 0.45 * irregularity + Math.random() * 0.68 * irregularity);
    positions.push(Math.cos(a) * r, Math.sin(a) * r, 0);
  }
  const indices: number[] = [];
  for (let i = 1; i <= rim; i++) indices.push(0, i, (i % rim) + 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return { geometry, base: new Float32Array(positions), radius };
};

/** Low-poly crescent (the moon): outer arc + concave inner arc.
 *  `vertexCount` is the total boundary vertex budget across both arcs;
 *  `roundness` 1 = clean arcs, 0 = heavily uneven arc radii. */
const buildCrescent = (radius: number, vertexCount: number, roundness: number): JitterBody => {
  const irregularity = 1 - Math.min(Math.max(roundness, 0), 1);
  const wobble = (): number => 1 + (Math.random() - 0.5) * 0.5 * irregularity;
  const outerSegs = Math.max(5, Math.round(vertexCount * 0.58));
  const innerSegs = Math.max(4, vertexCount - outerSegs);
  const innerR = radius * 0.92;
  const innerCx = radius * 0.5;
  // Circle-circle intersection → crescent tips
  const ix = (radius * radius + innerCx * innerCx - innerR * innerR) / (2 * innerCx);
  const iy = Math.sqrt(Math.max(radius * radius - ix * ix, 0));
  const tip = Math.atan2(iy, ix); // upper tip angle on the outer circle
  const shape = new THREE.Shape();
  for (let i = 0; i <= outerSegs; i++) {
    const a = tip + ((Math.PI * 2 - 2 * tip) * i) / outerSegs;
    const r = radius * (i === 0 || i === outerSegs ? 1 : wobble()); // tips stay exact
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const phi = Math.atan2(iy, ix - innerCx); // tip angle on the inner circle
  // Inner (concave) edge: from the lower tip back to the upper tip, bulging
  // through the crescent's middle (angle runs -phi → phi - 2π).
  for (let i = 1; i < innerSegs; i++) {
    const a = -phi + ((2 * phi - Math.PI * 2) * i) / innerSegs;
    const r = innerR * wobble();
    shape.lineTo(innerCx + Math.cos(a) * r, Math.sin(a) * r);
  }
  const geometry = new THREE.ShapeGeometry(shape);
  const base = new Float32Array((geometry.getAttribute("position") as THREE.BufferAttribute).array);
  return { geometry, base, radius };
};

/** Re-jitter every vertex independently and snap to an exaggerated grid.
 *  `degrade` (0..1) coarsens the grid — the shrinking body collapses into
 *  fewer distinct positions, reading as "even more low poly". */
const jitterBody = (body: JitterBody, degrade: number): void => {
  const attr = body.geometry.getAttribute("position") as THREE.BufferAttribute;
  const amp = body.radius * JITTER_AMPLITUDE;
  const q = body.radius * (QUANT_BASE + degrade * QUANT_DEGRADE);
  const arr = attr.array as Float32Array;
  for (let i = 0; i < arr.length; i += 3) {
    arr[i] = Math.round((body.base[i] + (Math.random() * 2 - 1) * amp) / q) * q;
    arr[i + 1] = Math.round((body.base[i + 1] + (Math.random() * 2 - 1) * amp) / q) * q;
    // keep a little depth wobble so the silhouette edge catches the quantized look
    arr[i + 2] = Math.round(((Math.random() * 2 - 1) * amp * 0.5) / q) * q;
  }
  attr.needsUpdate = true;
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

  const stars = useMemo(() => {
    const positions = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      const azimuth = Math.random() * Math.PI * 2;
      const y = 0.06 + Math.random() * 0.94; // upper hemisphere only
      const horizontal = Math.sqrt(1 - y * y);
      positions[i * 3] = Math.cos(azimuth) * horizontal * STAR_DISTANCE;
      positions[i * 3 + 1] = y * STAR_DISTANCE;
      positions[i * 3 + 2] = Math.sin(azimuth) * horizontal * STAR_DISTANCE;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return geometry;
  }, []);
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

  // Precompile the night-only shader programs (moon, stars) at MOUNT.
  // Materials compile lazily on their first visible render, which otherwise
  // lands at the exact frame the first dusk begins — a synchronous program
  // compile+link (expensive under Windows/ANGLE) that read as a "large frame
  // drop right at nightfall". TWO traps, both hit historically:
  // (1) gl.compile collects the scene LIGHTS only from the object it is
  //     passed, and light COUNTS are part of three's program cache key —
  //     compiling just the celestial group found zero lights, so its programs
  //     never matched the real render. Precompile must see the SCENE.
  // (2) gl.compile uses traverseVisible (verified in three r157), and the
  //     moon/stars are `visible = false` all day — every scene-wide compile
  //     pass silently SKIPPED exactly the materials this exists for. They
  //     must be flipped visible for the duration of the compile call.
  // Deferred one frame so the light-owning components (mounted in the same
  // commit tree) are all in the scene first; the frame loop restores the
  // real visibility on its next tick regardless.
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

  const startRef = useRef(performance.now());
  const jitterTimer = useRef(0);
  // First frames force the night-only objects through a REAL draw: gl.compile
  // links their programs (effect above) but does NOT upload geometry buffers
  // or touch lazy driver state — only an actual draw does. It's imperceptible:
  // at day the moon renders at scale 0.001 and the stars at opacity 0.
  const warmFramesRef = useRef(2);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    // ---- Cycle phase → night blend (0 = day, 1 = night) ----
    const cycleMs = dayDurationMs + transitionMs + nightDurationMs + transitionMs;
    const t = (performance.now() - startRef.current) % cycleMs;
    let blend: number;
    if (t < dayDurationMs) blend = 0;
    else if (t < dayDurationMs + transitionMs) blend = (t - dayDurationMs) / transitionMs;
    else if (t < dayDurationMs + transitionMs + nightDurationMs) blend = 1;
    else blend = 1 - (t - dayDurationMs - transitionMs - nightDurationMs) / transitionMs;
    setNightBlend(blend);
    tickWindowLights(delta * 1000);

    const sunPresence = 1 - blend;
    const moonPresence = blend;

    // ---- Follow the camera so the sky never leaves render distance ----
    group.position.copy(camera.position);

    const sunMesh = sunRef.current;
    const moonMesh = moonRef.current;
    if (sunMesh) {
      sunMesh.visible = sunPresence > 0.02;
      sunMesh.scale.setScalar(Math.max(sunPresence, 0.001));
      sunMesh.quaternion.copy(camera.quaternion); // flat silhouette faces the player
    }
    if (moonMesh) {
      moonMesh.visible = moonPresence > 0.02;
      moonMesh.scale.setScalar(Math.max(moonPresence, 0.001));
      moonMesh.quaternion.copy(camera.quaternion);
    }
    if (starsRef.current) {
      starMaterial.opacity = blend * 0.9;
      starsRef.current.visible = blend > 0.01;
    }

    // Warm-up draw (see warmFramesRef): keep everything visible for the first
    // couple PRESENTED frames so buffers upload during load, not at first
    // dusk. Counted against isMainRenderFrame — with an FPS cap active, a
    // skipped tick draws nothing and must not consume a warm frame.
    if (warmFramesRef.current > 0) {
      if (isMainRenderFrame()) warmFramesRef.current--;
      if (sunMesh) sunMesh.visible = true;
      if (moonMesh) moonMesh.visible = true;
      if (starsRef.current) starsRef.current.visible = true;
    }

    // ---- Independent vertex jitter on a fixed tick ----
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
        position={SUN_DIR.clone().multiplyScalar(SUN_DISTANCE)}
        frustumCulled={false}
      />
      <mesh
        ref={moonRef}
        geometry={moon.geometry}
        material={moonMaterial}
        position={MOON_DIR.clone().multiplyScalar(MOON_DISTANCE)}
        frustumCulled={false}
      />
      <points ref={starsRef} geometry={stars} material={starMaterial} frustumCulled={false} />
    </group>
  );
};
