import { useFrame, useThree } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { prepareActorMaterial } from "../../objects/actors/material";
import { instancedTemplate, warmPrograms } from "../../utils/render";
import { stampDecal } from "../decals";
import { liveBleeders, sprayBlood, takeBloodBursts } from ".";
import type { BloodBurst } from ".";

/** Bursts in the air at once: a new one past it takes the oldest's place. */
const MAX_BURSTS = 64;
const DROPS = 180;
const DROP_SIZE: [number, number] = [0.03, 0.1];
const GRAVITY = 9.8;
/** Of the drops, this share leaves the wound's far side, along the bullet; the rest spatter back toward the shooter. */
const FORWARD_SHARE = 0.7;
const FORWARD_SPEED: [number, number] = [2, 10];
const BACK_SPEED: [number, number] = [0.8, 3.5];
const SPREAD = 3.2;
/** In the air at most this long (s), unless it lands first. */
const FLIGHT_SECONDS: [number, number] = [0.9, 1.6];
/** A stump's spurt: every BLEED_INTERVAL (s), this share of a burst, out of the stump. */
const BLEED_INTERVAL = 0.14;
const BLEED_AMOUNT = 0.22;
/** A landed drop's decal is this much wider than the drop. */
const SPLAT_SPREAD: [number, number] = [2, 5];

interface Burst {
  mesh: THREE.InstancedMesh;
  /** Per drop (STRIDE floats): position (x, y, z) relative to the mesh, velocity, life left (≤ 0: gone), size. */
  drops: Float32Array;
  bornAt: number;
}
const STRIDE = 8;

const _matrix = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

const between = ([lo, hi]: [number, number]): number => lo + Math.random() * (hi - lo);

/** Launches a burst's drops from its wound (the mesh's origin: positions stay small, COORDINATE_PRECISION.md). */
const launch = (burst: Burst, { at, dir, amount }: BloodBurst, now: number): void => {
  burst.mesh.position.set(at[0], at[1], at[2]);
  burst.mesh.updateMatrix();
  burst.mesh.updateMatrixWorld();
  burst.mesh.visible = true;
  burst.bornAt = now;
  const d = burst.drops;
  const drops = Math.round(DROPS * Math.min(1, Math.max(0, amount)));
  for (let i = 0; i < DROPS; i++) {
    const o = i * STRIDE;
    if (i >= drops) {
      d[o + 6] = 0;
      burst.mesh.setMatrixAt(i, HIDDEN);
      continue;
    }
    const forward = Math.random() < FORWARD_SHARE;
    const speed = forward ? between(FORWARD_SPEED) : -between(BACK_SPEED);
    d[o] = d[o + 1] = d[o + 2] = 0;
    d[o + 3] = dir[0] * speed + (Math.random() - 0.5) * SPREAD;
    d[o + 4] = dir[1] * speed + (Math.random() - 0.3) * SPREAD;
    d[o + 5] = dir[2] * speed + (Math.random() - 0.5) * SPREAD;
    d[o + 6] = between(FLIGHT_SECONDS);
    d[o + 7] = between(DROP_SIZE);
  }
};

/**
 * THE blood (sprayBlood, index.ts): every wound's spray, dozens of drops flung from it, out the far side
 * along the bullet and back toward the shooter. Each drop flies until it meets the world's first solid
 * surface on its way (ground, wall, roof: a ray along each frame's step) and lies there as a blood decal
 * (vfx/decals/), across that surface. A pool of instanced bursts, each placed AT its wound, so the drops'
 * float32 positions are only ever metres. Mounted once, inside the physics world.
 */
export const BloodSprays = () => {
  const scene = useThree((s) => s.scene);
  const { world, rapier } = useRapier();
  const { material, geometry } = useMemo(() => {
    const material = new THREE.MeshBasicMaterial({ color: "#6a0008" });
    // An unlit, procedural shape: no lamp glow, off the quantization lattice.
    prepareActorMaterial(material, { skipQuantization: true, skipLampGlow: true });
    return { material, geometry: new THREE.BoxGeometry(1, 1, 1) };
  }, []);
  const bursts = useMemo<Burst[]>(
    () =>
      Array.from({ length: MAX_BURSTS }, () => {
        const mesh = new THREE.InstancedMesh(geometry, material, DROPS);
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = false;
        mesh.visible = false;
        return { mesh, drops: new Float32Array(DROPS * STRIDE), bornAt: -Infinity };
      }),
    [geometry, material],
  );
  const ray = useMemo(() => new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }), [rapier]);

  useEffect(() => {
    for (const b of bursts) scene.add(b.mesh);
    const cancelWarm = warmPrograms(scene, [instancedTemplate(material)]);
    return () => {
      cancelWarm();
      for (const b of bursts) b.mesh.removeFromParent();
      for (const b of bursts) b.mesh.dispose();
      geometry.dispose();
      material.dispose();
    };
  }, [scene, bursts, geometry, material]);

  /** One frame of a burst; false once every drop is gone. */
  const step = (burst: Burst, dt: number): boolean => {
    const d = burst.drops;
    const origin = burst.mesh.position;
    let alive = false;
    for (let i = 0; i < DROPS; i++) {
      const o = i * STRIDE;
      if (d[o + 6] <= 0) continue;
      d[o + 6] -= dt;
      if (d[o + 6] <= 0) {
        burst.mesh.setMatrixAt(i, HIDDEN);
        continue;
      }
      alive = true;
      d[o + 4] -= GRAVITY * dt;
      const sx = d[o + 3] * dt;
      const sy = d[o + 4] * dt;
      const sz = d[o + 5] * dt;
      const length = Math.hypot(sx, sy, sz);
      if (length > 0) {
        ray.origin.x = origin.x + d[o];
        ray.origin.y = origin.y + d[o + 1];
        ray.origin.z = origin.z + d[o + 2];
        ray.dir.x = sx / length;
        ray.dir.y = sy / length;
        ray.dir.z = sz / length;
        const hit = world.castRayAndGetNormal(ray, length, true, rapier.QueryFilterFlags.ONLY_FIXED | rapier.QueryFilterFlags.EXCLUDE_SENSORS);
        if (hit) {
          const t = hit.timeOfImpact;
          // Facing the drop, whichever way round the collider gives it.
          const flip = hit.normal.x * ray.dir.x + hit.normal.y * ray.dir.y + hit.normal.z * ray.dir.z > 0 ? -1 : 1;
          stampDecal(
            "blood",
            [ray.origin.x + ray.dir.x * t, ray.origin.y + ray.dir.y * t, ray.origin.z + ray.dir.z * t],
            [hit.normal.x * flip, hit.normal.y * flip, hit.normal.z * flip],
            d[o + 7] * between(SPLAT_SPREAD),
          );
          d[o + 6] = 0;
          burst.mesh.setMatrixAt(i, HIDDEN);
          continue;
        }
      }
      d[o] += sx;
      d[o + 1] += sy;
      d[o + 2] += sz;
      burst.mesh.setMatrixAt(i, _matrix.compose(_p.set(d[o], d[o + 1], d[o + 2]), _q, _s.setScalar(d[o + 7])));
    }
    burst.mesh.instanceMatrix.needsUpdate = true;
    return alive;
  };

  useFrame((state, delta) => {
    const now = state.clock.elapsedTime;
    const spurt = Math.floor(now / BLEED_INTERVAL) !== Math.floor((now - delta) / BLEED_INTERVAL);
    for (const bleeder of liveBleeders()) {
      bleeder.until ??= now + bleeder.seconds;
      if (now > bleeder.until) liveBleeders().delete(bleeder);
      else if (spurt && bleeder.frame(_p, _s)) sprayBlood([_p.x, _p.y, _p.z], [_s.x, _s.y, _s.z], BLEED_AMOUNT);
    }
    for (const asked of takeBloodBursts()) {
      const free = bursts.find((b) => !b.mesh.visible) ?? bursts.reduce((oldest, b) => (b.bornAt < oldest.bornAt ? b : oldest));
      launch(free, asked, now);
    }
    const dt = Math.min(delta, 0.05);
    for (const b of bursts) if (b.mesh.visible && !step(b, dt)) b.mesh.visible = false;
  });

  return null;
};
