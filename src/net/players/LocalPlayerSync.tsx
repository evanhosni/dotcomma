import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useGameContext } from "../../context/GameContext";
import { onServerMessage, send } from "../connection";

/**
 * Publishes the LOCAL player's movement as INTENT CHANGES, never per-frame
 * positions. The Player is treated as a black box: this reads the shared
 * position ref it writes (GameContext.playerPosition, body center) and the
 * camera yaw, derives a smoothed velocity, and sends a `move` only when:
 *   - horizontal velocity changed by more than VEL_EPS          (direction/speed change)
 *   - vertical velocity changed by more than VEL_EPS_Y          (jump / landing; coarse —
 *                                                                gravity changes vy every frame)
 *   - moving ↔ stopped flipped                                  (a stop is sent with v = 0 exactly)
 *   - yaw changed by more than YAW_EPS                          (facing)
 *   - the position a receiver would have EXTRAPOLATED from our last message
 *     has drifted more than DRIFT_EPS from where we actually are (slopes,
 *     collisions, autostep — checked every DRIFT_CHECK_MS)
 *   - the server just (re)initialised us                        (full state, immediately)
 * subject to a MIN_SEND_INTERVAL between messages (stops bypass it).
 *
 * Runs at useFrame priority -2: after the Player (-3) has written this frame's
 * position, before the render.
 */

const VEL_EPS = 1.5; // u/s — walk is 15, sprint 45, so any real change clears this
const VEL_EPS_Y = 6;
const STOP_SPEED = 0.35;
const YAW_EPS = 0.12; // rad ≈ 7°
const DRIFT_EPS = 0.75; // u
const DRIFT_CHECK_MS = 250;
const MIN_SEND_INTERVAL_MS = 50; // 20Hz ceiling during a turn/wiggle
const VEL_SMOOTH = 0.35; // EMA factor on the instantaneous velocity

const _dir = new THREE.Vector3();

export const LocalPlayerSync = () => {
  const { camera } = useThree();
  const { playerPosition } = useGameContext();

  const prev = useRef(new THREE.Vector3());
  const havePrev = useRef(false);
  const vel = useRef(new THREE.Vector3());
  // Last SENT intent — what every receiver is extrapolating from.
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

    // Instantaneous → smoothed velocity. A large jump (respawn/teleport) is
    // not a velocity; treat it as a relocation and send the new position.
    const ix = (pos.x - prev.current.x) / dt;
    const iy = (pos.y - prev.current.y) / dt;
    const iz = (pos.z - prev.current.z) / dt;
    prev.current.copy(pos);
    const teleported = ix * ix + iy * iy + iz * iz > 200 * 200;
    if (teleported) {
      vel.current.set(0, 0, 0);
      forceSend.current = true;
    } else {
      vel.current.x += (ix - vel.current.x) * VEL_SMOOTH;
      vel.current.y += (iy - vel.current.y) * VEL_SMOOTH;
      vel.current.z += (iz - vel.current.z) * VEL_SMOOTH;
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
      if (dvx * dvx + dvz * dvz > VEL_EPS * VEL_EPS || Math.abs(v.y - sv.y) > VEL_EPS_Y) reason = "change";
    }
    if (!reason) {
      const dyaw = Math.atan2(Math.sin(yaw - sentYaw.current), Math.cos(yaw - sentYaw.current));
      if (Math.abs(dyaw) > YAW_EPS) reason = "change";
    }
    if (!reason && now - lastDriftCheck.current > DRIFT_CHECK_MS) {
      lastDriftCheck.current = now;
      const age = (now - sentAt.current) / 1000;
      const ex = sentPos.current.x + sv.x * age - pos.x;
      const ey = sentPos.current.y + sv.y * age - pos.y;
      const ez = sentPos.current.z + sv.z * age - pos.z;
      if (ex * ex + ey * ey + ez * ez > DRIFT_EPS * DRIFT_EPS) reason = "change";
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
    if (!ok) return; // not connected — the next init forces a full send anyway

    forceSend.current = false;
    sentAt.current = now;
    sentPos.current.copy(pos);
    if (stopped) sentVel.current.set(0, 0, 0);
    else sentVel.current.copy(v);
    sentYaw.current = yaw;
  }, -2);

  return null;
};
