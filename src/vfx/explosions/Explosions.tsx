import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { prepareActorMaterial } from "../../objects/actors/material";
import { instancedTemplate, meshTemplate, warmPrograms } from "../../utils/render";
import { stampDecal } from "../decals";
import { takeExplosions } from ".";
import type { ExplosionOrder } from ".";

/** Blasts drawn at once: a new one past it takes the oldest's place. */
const MAX_BLASTS = 8;
const SPARKS = 48;
const GRAVITY = 9.8;
/** Seconds: the fireball swells, then fades; the smoke outlives it, rising. */
const FIRE_SECONDS = 0.55;
const SMOKE_SECONDS = 2.2;
const SMOKE_RISE = 1.6;
const SPARK_SECONDS: [number, number] = [0.4, 1.1];
const SPARK_SPEED: [number, number] = [6, 18];
/** The fireball's widest, and each smoke puff's, as shares of the blast's radius; the puffs spread this far. */
const FIRE_SIZE = 0.75;
const SMOKE_SIZE = 0.32;
const SMOKE_SPREAD = 0.45;
/** Puffs of smoke per blast: a cluster, not one ball (one read as a glass dome over the street). */
const PUFFS = 7;
/** A scorch is this much of the blast's radius across. */
const SCORCH_SIZE = 1.1;

interface Blast {
  root: THREE.Group;
  core: THREE.Mesh;
  fire: THREE.Mesh;
  /** The puffs share one material (their opacity is the blast's age); each its own drift (userData.drift). */
  smoke: THREE.Mesh[];
  sparks: THREE.InstancedMesh;
  /** Per spark: position, velocity, life left. */
  spark: Float32Array;
  bornAt: number;
  radius: number;
}
const STRIDE = 7;

const _matrix = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const between = ([lo, hi]: [number, number]): number => lo + Math.random() * (hi - lo);

/** Unlit, glowing or sooty, on the actor base (curvature, spawn fade), off the quantization lattice. */
const blastMaterial = (color: string, additive: boolean): THREE.MeshBasicMaterial => {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  prepareActorMaterial(material, { skipQuantization: true, skipLampGlow: true });
  return material;
};

/**
 * THE explosions (explode, index.ts): each a white-hot core and a fireball swelling and fading, a ball of
 * smoke rising out of it, sparks flung out under gravity, and a scorch decal where it touched a surface. A
 * pool of blasts, each placed AT its centre (float32 offsets stay small, COORDINATE_PRECISION.md); every
 * blast's materials are its own (their opacity is its age). Mounted once with the canvas.
 */
export const Explosions = () => {
  const scene = useThree((s) => s.scene);
  const shared = useMemo(
    () => ({ ball: new THREE.IcosahedronGeometry(1, 2), spark: new THREE.BoxGeometry(1, 1, 1), sparkMaterial: blastMaterial("#ffc25a", true) }),
    [],
  );
  const blasts = useMemo<Blast[]>(
    () =>
      Array.from({ length: MAX_BLASTS }, () => {
        const root = new THREE.Group();
        root.visible = false;
        const core = new THREE.Mesh(shared.ball, blastMaterial("#fff2c8", true));
        const fire = new THREE.Mesh(shared.ball, blastMaterial("#ff7a1c", true));
        const smokeMaterial = blastMaterial("#2e2a27", false);
        const smoke = Array.from({ length: PUFFS }, () => {
          const puff = new THREE.Mesh(shared.ball, smokeMaterial);
          puff.userData.drift = new THREE.Vector3();
          puff.renderOrder = 1;
          return puff;
        });
        const sparks = new THREE.InstancedMesh(shared.spark, shared.sparkMaterial, SPARKS);
        for (const mesh of [core, fire, sparks, ...smoke]) mesh.frustumCulled = false;
        root.add(...smoke, fire, core, sparks);
        return { root, core, fire, smoke, sparks, spark: new Float32Array(SPARKS * STRIDE), bornAt: -Infinity, radius: 1 };
      }),
    [shared],
  );

  useEffect(() => {
    for (const b of blasts) scene.add(b.root);
    const b = blasts[0];
    const cancelWarm = warmPrograms(scene, [meshTemplate(b.core.material as THREE.Material), meshTemplate(b.smoke[0].material as THREE.Material), instancedTemplate(shared.sparkMaterial)]);
    return () => {
      cancelWarm();
      for (const blast of blasts) {
        blast.root.removeFromParent();
        for (const mesh of [blast.core, blast.fire, blast.smoke[0]]) (mesh.material as THREE.Material).dispose();
        blast.sparks.dispose();
      }
      shared.ball.dispose();
      shared.spark.dispose();
      shared.sparkMaterial.dispose();
    };
  }, [scene, blasts, shared]);

  const launch = (blast: Blast, { at, radius, normal }: ExplosionOrder, now: number): void => {
    blast.root.position.set(at[0], at[1], at[2]);
    blast.root.visible = true;
    blast.bornAt = now;
    blast.radius = radius;
    for (const puff of blast.smoke) {
      const drift = puff.userData.drift as THREE.Vector3;
      drift.randomDirection().multiplyScalar(SMOKE_SPREAD * (0.4 + Math.random() * 0.6));
      drift.y = Math.abs(drift.y) * 0.5 + 0.2 + Math.random() * 0.5;
      puff.userData.size = 0.7 + Math.random() * 0.6;
    }
    const s = blast.spark;
    for (let i = 0; i < SPARKS; i++) {
      const o = i * STRIDE;
      _p.randomDirection();
      if (normal && _p.x * normal[0] + _p.y * normal[1] + _p.z * normal[2] < 0) _p.reflect(_s.set(normal[0], normal[1], normal[2]));
      const speed = between(SPARK_SPEED);
      s[o] = s[o + 1] = s[o + 2] = 0;
      s[o + 3] = _p.x * speed;
      s[o + 4] = _p.y * speed + 2;
      s[o + 5] = _p.z * speed;
      s[o + 6] = between(SPARK_SECONDS);
    }
    if (normal) stampDecal("scorch", at, normal, radius * SCORCH_SIZE);
  };

  /** One frame of a blast; false once it is over. */
  const step = (blast: Blast, now: number, dt: number): boolean => {
    const age = now - blast.bornAt;
    const fire = Math.min(1, age / FIRE_SECONDS);
    const swell = 1 - (1 - Math.min(1, age / (FIRE_SECONDS * 0.35))) ** 3;
    const r = blast.radius;
    blast.core.scale.setScalar(r * FIRE_SIZE * 0.45 * swell);
    blast.fire.scale.setScalar(r * FIRE_SIZE * swell);
    (blast.core.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - fire * 1.6);
    (blast.fire.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.95 * (1 - fire));
    blast.core.visible = blast.fire.visible = fire < 1;
    const smoke = Math.min(1, age / SMOKE_SECONDS);
    const grow = 0.35 + 0.65 * Math.sqrt(smoke);
    for (const puff of blast.smoke) {
      const drift = puff.userData.drift as THREE.Vector3;
      puff.scale.setScalar(r * SMOKE_SIZE * (puff.userData.size as number) * grow);
      puff.position.copy(drift).multiplyScalar(r * grow);
      puff.position.y += SMOKE_RISE * smoke * r * 0.4;
    }
    (blast.smoke[0].material as THREE.MeshBasicMaterial).opacity = 0.8 * Math.min(1, age / 0.12) * (1 - smoke) ** 1.5;

    const s = blast.spark;
    let sparking = false;
    for (let i = 0; i < SPARKS; i++) {
      const o = i * STRIDE;
      if (s[o + 6] <= 0) {
        blast.sparks.setMatrixAt(i, HIDDEN);
        continue;
      }
      s[o + 6] -= dt;
      sparking = true;
      s[o + 4] -= GRAVITY * dt;
      s[o] += s[o + 3] * dt;
      s[o + 1] += s[o + 4] * dt;
      s[o + 2] += s[o + 5] * dt;
      blast.sparks.setMatrixAt(i, _matrix.compose(_p.set(s[o], s[o + 1], s[o + 2]), _q, _s.setScalar(0.05)));
    }
    blast.sparks.instanceMatrix.needsUpdate = true;
    for (const mesh of [blast.core, blast.fire, blast.sparks, ...blast.smoke]) mesh.updateMatrix();
    blast.root.updateMatrixWorld(true);
    return smoke < 1 || sparking;
  };

  useFrame((state, delta) => {
    const now = state.clock.elapsedTime;
    for (const order of takeExplosions()) {
      const free = blasts.find((b) => !b.root.visible) ?? blasts.reduce((oldest, b) => (b.bornAt < oldest.bornAt ? b : oldest));
      launch(free, order, now);
    }
    const dt = Math.min(delta, 0.05);
    for (const b of blasts) if (b.root.visible && !step(b, now, dt)) b.root.visible = false;
  });

  return null;
};
