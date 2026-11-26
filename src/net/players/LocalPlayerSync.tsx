import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useGameContext } from "../../context/hooks";
import { wrapAngle } from "../../utils/math";
import { onServerMessage, send } from "..";
import { PUBLISH_INTERVAL_MS } from "../entities/constants";
import { PLAYER_CLIPS } from "../../player/constants";
import { getLocalPlayerBody } from "../../player/store";
import type { PlayerBodyState } from "../../player/types";
import type { PlayerAvatar } from "../protocol/types";

/**
 * Publishes the local player's movement: every PUBLISH_INTERVAL_MS while moving (the entity cadence:
 * receivers sample the server-stamped track like an entity's, net/entities/utils.ts, and a
 * moving track that goes quiet for longer only extrapolates MAX_EXTRAPOLATION_MS, then holds), plus at
 * once on a start / stop / velocity or yaw change / relocation / re-init, and on every change of the drawn
 * pose (the clip, its speed, the head's turn). Nothing while standing still. `ry` is the BODY's facing.
 * useFrame priority -2: after the Player (-3) has written this frame's position.
 */

const VEL_THRESHOLD = 1.5; // u/s — walk is 15, sprint 45, so any real change clears this
const VEL_THRESHOLD_Y = 6; // coarse: gravity changes vy every frame
const STOP_SPEED = 0.35;
// The drawn pose is the source of truth: receivers play the body's facing and the head back as sent
// (interpolated, never re-eased), so a turn is sent once it moves this much (≤ 20Hz, MIN_SEND_INTERVAL_MS)
// and the last one sent is where it settled.
const YAW_THRESHOLD = 0.01; // rad ≈ 0.6°, the body's facing
const HEAD_THRESHOLD = 0.005; // rad ≈ 0.3°, the head's yaw or pitch
const MIN_SEND_INTERVAL_MS = 50; // 20Hz ceiling during a turn/wiggle; stops bypass it
/** A screwing-in MAV Unit's depth is sent each time it goes this much further (0–1). */
const MAV_DEPTH_THRESHOLD = 0.05;
const VEL_SMOOTH = 0.35; // EMA factor on the instantaneous velocity

/** A frame-to-frame speed above this is a relocation (respawn/teleport), not a velocity. */
const TELEPORT_SPEED = 800; // u/s: well above the intro's fastest dive (world/domains/overworld/intro/constants.ts); a relocation moves hundreds of units in one frame

const _dir = new THREE.Vector3();

type SendReason = "stop" | "change";
type Velocity = { x: number; y: number; z: number };

const avatarChanged = (body: PlayerBodyState, sent: PlayerAvatar): boolean =>
  body.form !== sent.fm ||
  body.equipped !== sent.wp ||
  body.mavHost !== sent.mh ||
  Math.abs(body.mavDepth - sent.md) > MAV_DEPTH_THRESHOLD ||
  body.clip !== sent.clip ||
  body.loop !== sent.loop ||
  body.clipSpeed !== sent.cs ||
  Math.abs((body.headYaw ?? 0) - sent.hy) > HEAD_THRESHOLD ||
  Math.abs((body.headPitch ?? 0) - sent.hp) > HEAD_THRESHOLD;

const isMoving = (v: Velocity): boolean => v.x * v.x + v.z * v.z > STOP_SPEED * STOP_SPEED || Math.abs(v.y) > STOP_SPEED;

/** A start, a stop, or a real velocity change against what was last sent; null otherwise. */
const velocityChangeOf = (v: Velocity, sent: Velocity): SendReason | null => {
  const moving = isMoving(v);
  const wasMoving = isMoving(sent);
  if (wasMoving && !moving) return "stop";
  if (moving && !wasMoving) return "change";
  if (!moving) return null;
  const dvx = v.x - sent.x;
  const dvz = v.z - sent.z;
  if (dvx * dvx + dvz * dvz > VEL_THRESHOLD * VEL_THRESHOLD || Math.abs(v.y - sent.y) > VEL_THRESHOLD_Y) return "change";
  return null;
};

export const LocalPlayerSync = () => {
  const { camera } = useThree();
  const { playerPosition } = useGameContext();

  const prev = useRef(new THREE.Vector3());
  const havePrev = useRef(false);
  const vel = useRef(new THREE.Vector3());
  const sentVel = useRef(new THREE.Vector3());
  const sentYaw = useRef(0);
  const sentAvatar = useRef<PlayerAvatar>({ fm: "host", mh: "", md: 0, wp: "", hy: 0, hp: 0, clip: "", cs: 1, loop: "repeat" }).current;
  const sentAt = useRef(0);
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
    const teleported = instantVx * instantVx + instantVy * instantVy + instantVz * instantVz > TELEPORT_SPEED * TELEPORT_SPEED;
    if (teleported) {
      vel.current.set(0, 0, 0);
      forceSend.current = true;
    } else {
      vel.current.x += (instantVx - vel.current.x) * VEL_SMOOTH;
      vel.current.y += (instantVy - vel.current.y) * VEL_SMOOTH;
      vel.current.z += (instantVz - vel.current.z) * VEL_SMOOTH;
    }

    const body = getLocalPlayerBody();
    camera.getWorldDirection(_dir);
    const yaw = body ? body.yaw : Math.atan2(_dir.x, _dir.z);

    const v = vel.current;
    const sv = sentVel.current;
    const moving = isMoving(v);

    let reason: SendReason | null = forceSend.current ? "change" : velocityChangeOf(v, sv);
    if (!reason) {
      const dyaw = wrapAngle(yaw - sentYaw.current);
      if (Math.abs(dyaw) > YAW_THRESHOLD) reason = "change";
    }
    if (!reason && body && avatarChanged(body, sentAvatar)) reason = "change";
    if (!reason && moving && now - sentAt.current >= PUBLISH_INTERVAL_MS) reason = "change";
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
      hy: body?.headYaw ?? 0,
      hp: body?.headPitch ?? 0,
      clip: body?.clip ?? PLAYER_CLIPS.idle,
      cs: body?.clipSpeed ?? 1,
      loop: body?.loop ?? "repeat",
      fm: body?.form ?? "host",
      mh: body?.mavHost ?? "",
      md: body?.mavDepth ?? 0,
      wp: body?.equipped ?? "",
    });
    if (!ok) return; // the next init forces a full send anyway

    forceSend.current = false;
    sentAt.current = now;
    if (stopped) sentVel.current.set(0, 0, 0);
    else sentVel.current.copy(v);
    sentYaw.current = yaw;
    if (body) {
      sentAvatar.hy = body.headYaw ?? 0;
      sentAvatar.hp = body.headPitch ?? 0;
      sentAvatar.clip = body.clip;
      sentAvatar.cs = body.clipSpeed;
      sentAvatar.loop = body.loop;
      sentAvatar.fm = body.form;
      sentAvatar.mh = body.mavHost;
      sentAvatar.md = body.mavDepth;
      sentAvatar.wp = body.equipped;
    }
  }, -2);

  return null;
};
