import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { prepareActorMaterial } from "../../objects/actors/Actor";
import { PLAYER_HEIGHT, PLAYER_RADIUS } from "../../player/spec";
import { getRemotePlayers, useRosterVersion, type RemotePlayer } from "./store";

/**
 * Remote players as capsules, ALL driven from ONE useFrame that mutates Object3Ds;
 * React only sees the roster. Per frame: target = last intent extrapolated (age
 * capped), display eases toward it frame-rate-independently. Snaps only on the
 * first frame and on a TELEPORT_DISTANCE jump (respawn).
 */

const CAPSULE_RADIUS = PLAYER_RADIUS;
const CAPSULE_LENGTH = PLAYER_HEIGHT - 2 * PLAYER_RADIUS;

/** Bounds the damage of a lost/late correction. */
const MAX_EXTRAPOLATION_S = 0.5;
const SMOOTH_RATE = 12; // 1/s — ~63% of the gap closed every 83ms
const TELEPORT_DISTANCE = 40;

const capsuleGeometry = new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_LENGTH, 4, 12);
const visorGeometry = new THREE.BoxGeometry(0.5, 0.16, 0.12);
const visorMaterial = new THREE.MeshStandardMaterial({ color: "#101010", roughness: 0.3 });
prepareActorMaterial(visorMaterial);

const RemoteCapsule = ({ player }: { player: RemotePlayer }) => {
  const groupRef = useRef<THREE.Group>(null);

  // Emissive keeps them legible in the home domain, which has no ambient light.
  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      color: player.color,
      emissive: player.color,
      emissiveIntensity: 0.35,
      roughness: 0.6,
    });
    prepareActorMaterial(m);
    return m;
  }, [player.color]);
  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    player.object = groupRef.current;
    return () => {
      player.object = null;
    };
  }, [player]);

  return (
    <group ref={groupRef} position={[player.x, player.y, player.z]} rotation={[0, player.displayYaw, 0]}>
      <mesh geometry={capsuleGeometry} material={material} />
      <mesh geometry={visorGeometry} material={visorMaterial} position={[0, 0.55, CAPSULE_RADIUS - 0.02]} />
    </group>
  );
};

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export const RemotePlayers = () => {
  const version = useRosterVersion();
  const list = useMemo(() => Array.from(getRemotePlayers().values()), [version]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const now = performance.now();
    const k = 1 - Math.exp(-SMOOTH_RATE * dt);

    for (const p of getRemotePlayers().values()) {
      const obj = p.object;
      if (!obj) continue;

      const age = Math.min((now - p.receivedAt) / 1000, MAX_EXTRAPOLATION_S);
      const tx = p.targetX + p.vx * age;
      const ty = p.targetY + p.vy * age;
      const tz = p.targetZ + p.vz * age;

      if (p.needsInitialPlacement) {
        p.x = tx;
        p.y = ty;
        p.z = tz;
        p.displayYaw = p.ry;
        p.needsInitialPlacement = false;
      } else {
        const dx = tx - p.x;
        const dy = ty - p.y;
        const dz = tz - p.z;
        if (dx * dx + dy * dy + dz * dz > TELEPORT_DISTANCE * TELEPORT_DISTANCE) {
          p.x = tx;
          p.y = ty;
          p.z = tz;
        } else {
          p.x += dx * k;
          p.y += dy * k;
          p.z += dz * k;
        }
        p.displayYaw += wrapAngle(p.ry - p.displayYaw) * k;
      }

      obj.position.set(p.x, p.y, p.z);
      obj.rotation.y = p.displayYaw;
    }
  });

  return (
    <>
      {list.map((p) => (
        <RemoteCapsule key={p.id} player={p} />
      ))}
    </>
  );
};
