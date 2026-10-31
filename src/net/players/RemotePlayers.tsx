import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { prepareActorMaterial } from "../../objects/actors";
import { PLAYER_HEIGHT, PLAYER_RADIUS } from "../../player/spec";
import { stampSnowTrailAlong } from "../../objects/dressing/snow-drift/trail";
import { wrapAngle } from "../../utils/math";
import { getRemotePlayers, useRosterVersion, type RemotePlayer } from "./store";

/**
 * Remote players as capsules, ALL driven from ONE useFrame that mutates Object3Ds;
 * React only sees the roster. Positions are played back on the SERVER clock by the
 * entities' snapshot sampler (net/entities/interpolation.ts: a relocation snaps);
 * only the facing is eased on top, so a 7° turn step never pops.
 */

const CAPSULE_RADIUS = PLAYER_RADIUS;
const CAPSULE_LENGTH = PLAYER_HEIGHT - 2 * PLAYER_RADIUS;

const YAW_SMOOTH_RATE = 12; // 1/s — ~63% of the gap closed every 83ms

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

export const RemotePlayers = () => {
  const version = useRosterVersion();
  const list = useMemo(() => Array.from(getRemotePlayers().values()), [version]);

  useFrame((_, delta) => {
    const k = 1 - Math.exp(-YAW_SMOOTH_RATE * Math.min(delta, 0.1));

    for (const p of getRemotePlayers().values()) {
      const obj = p.object;
      if (!obj) continue;
      const first = !p.pose.valid;
      if (p.playback.sample(p, delta, p.pose) === "none") continue;
      const pose = p.pose;
      p.x = pose.x;
      p.y = pose.y;
      p.z = pose.z;
      p.displayYaw = first ? pose.ry : p.displayYaw + wrapAngle(pose.ry - p.displayYaw) * k;

      obj.position.set(p.x, p.y, p.z);
      obj.rotation.y = p.displayYaw;
      // Their tracks in the snow too (a stamp dents only where the sheet has snow under it).
      stampSnowTrailAlong(p.lastStamp, p.x, p.z);
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
