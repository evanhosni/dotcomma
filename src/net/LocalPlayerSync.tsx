import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useGameContext } from "../context/GameContext";
import { onServerMessage, send } from "./connection";

/**
 * Publishes the local player's movement as INTENT CHANGES (velocity / yaw /
 * stop / extrapolation drift / re-init), never per-frame positions. useFrame
 * priority -2: after the Player (-3) has written this frame's position.
 */

const VEL_THRESHOLD = 1.5; // u/s — walk is 15, sprint 45, so any real change clears this
const VEL_THRESHOLD_Y = 6; // coarse: gravity changes vy every frame
const STOP_SPEED = 0.35;
const YAW_THRESHOLD = 0.12; // rad ≈ 7°
const DRIFT_THRESHOLD = 0.75; // u
const DRIFT_CHECK_MS = 250;
const MIN_SEND_INTERVAL_MS = 50; // 20Hz ceiling during a turn/wiggle; stops bypass it
const VEL_SMOOTH = 0.35; // EMA factor on the instantaneous velocity

const _dir = new THREE.Vector3();

export const LocalPlayerSync = () => {
  const { camera } = useThree();
  const { playerPosition } = useGameContext();

  const prev = useRef(new THREE.Vector3());
  const havePrev = useRef(false);
  const vel = useRef(new THREE.Vector3());
  const sentPos = useRef(new THREE.Vector3());
  const sentVel = useRef(new THREE.Vector3());
  const sentYaw = useRef(0);
  const sentAt = useRef(0);
  const lastDriftCheck = useRef(0);
  const forceSend = useRef(false);

  useEffect(
    () =>
      onServerMessage((msg) => {
        if (msg.t === "init") forceSend.current = true;
      }),
    [],
  );

  useFrame((_, delta) => {
    const dt = Math.min(Math.max(delta, 1e-4), 0.1);
    const pos = playerPosition;
    const now = performance.now();

    if (!havePrev.current) {
      prev.current.copy(pos);
      havePrev.current = true;
      return;
    }

    // A large jump (respawn/teleport) is a relocation, not a velocity.
    const instantVx = (pos.x - prev.current.x) / dt;
    const instantVy = (pos.y - prev.current.y) / dt;
    const instantVz = (pos.z - prev.current.z) / dt;
    prev.current.copy(pos);
    const teleported = instantVx * instantVx + instantVy * instantVy + instantVz * instantVz > 200 * 200;
    if (teleported) {
      vel.current.set(0, 0, 0);
      forceSend.current = true;
    } else {
      vel.current.x += (instantVx - vel.current.x) * VEL_SMOOTH;
      vel.current.y += (instantVy - vel.current.y) * VEL_SMOOTH;
      vel.current.z += (instantVz - vel.current.z) * VEL_SMOOTH;
    }

    camera.getWorldDirection(_dir);
    const yaw = Math.atan2(_dir.x, _dir.z);

    const v = vel.current;
    const hSpeedSq = v.x * v.x + v.z * v.z;
    const moving = hSpeedSq > STOP_SPEED * STOP_SPEED || Math.abs(v.y) > STOP_SPEED;
    const sv = sentVel.current;
    const wasMoving = sv.x * sv.x + sv.z * sv.z > STOP_SPEED * STOP_SPEED || Math.abs(sv.y) > STOP_SPEED;

    let reason: "stop" | "change" | null = null;
    if (forceSend.current) reason = "change";
    else if (wasMoving && !moving) reason = "stop";
    else if (moving && !wasMoving) reason = "change";
    else if (moving) {
      const dvx = v.x - sv.x;
      const dvz = v.z - sv.z;
      if (dvx * dvx + dvz * dvz > VEL_THRESHOLD * VEL_THRESHOLD || Math.abs(v.y - sv.y) > VEL_THRESHOLD_Y) reason = "change";
    }
    if (!reason) {
      const dyaw = Math.atan2(Math.sin(yaw - sentYaw.current), Math.cos(yaw - sentYaw.current));
      if (Math.abs(dyaw) > YAW_THRESHOLD) reason = "change";
    }
    if (!reason && now - lastDriftCheck.current > DRIFT_CHECK_MS) {
      lastDriftCheck.current = now;
      const age = (now - sentAt.current) / 1000;
      const ex = sentPos.current.x + sv.x * age - pos.x;
      const ey = sentPos.current.y + sv.y * age - pos.y;
      const ez = sentPos.current.z + sv.z * age - pos.z;
      if (ex * ex + ey * ey + ez * ez > DRIFT_THRESHOLD * DRIFT_THRESHOLD) reason = "change";
    }
    if (!reason) return;
    if (reason === "change" && !forceSend.current && now - sentAt.current < MIN_SEND_INTERVAL_MS) return;

    const stopped = !moving;
    const ok = send({
      t: "move",
      x: pos.x,
      y: pos.y,
      z: pos.z,
      vx: stopped ? 0 : v.x,
      vy: stopped ? 0 : v.y,
      vz: stopped ? 0 : v.z,
      ry: yaw,
    });
    if (!ok) return; // the next init forces a full send anyway

    forceSend.current = false;
    sentAt.current = now;
    sentPos.current.copy(pos);
    if (stopped) sentVel.current.set(0, 0, 0);
    else sentVel.current.copy(v);
    sentYaw.current = yaw;
  }, -2);

  return null;
};
