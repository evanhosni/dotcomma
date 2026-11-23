import { useFrame } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import type { RapierRigidBody } from "@react-three/rapier";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { send } from "..";
import { BEEBLE_SPEC } from "../../objects/actors/beeble/spec";
import { rayHitDistance } from "../../objects/actors/model/geometry";
import { DEFAULT_INTERACT_REACH } from "../../objects/actors/spec";
import type { CapsuleColliderSpec } from "../../objects/actors/spec";
import { MOUSE_RAYCAST_INTERVAL_FRAMES, RAYCAST_RANGE_PAD } from "../../objects/actors/state/constants";
import { PlayerBody } from "../../player/PlayerBody";
import { PLAYER_HEIGHT } from "../../player/spec";
import { aimFromCamera } from "../../player/utils";
import { stampSnowTrailAlong } from "../../objects/dressing/snow-drift/store";
import { claimHover, releaseHover } from "../../utils/cursor";
import type { HoverTarget } from "../../utils/cursor/types";
import { getRemotePlayers, useRosterVersion } from "./store";
import type { RemotePlayer } from "./types";

/**
 * Remote players as beebles (player/PlayerBody.tsx, the local player's body), ALL driven from ONE useFrame
 * that writes each one's body state; React only sees the roster. Positions are played back on the SERVER
 * clock by the entities' snapshot sampler (net/entities/utils.ts: a relocation snaps), and each received
 * pose (clip, head) is shown when that same clock reaches its move, so a jump clip starts as the body
 * leaves the ground. The sender's drawn pose is the source of truth: its facing is sampled from the track and
 * its head interpolated between the poses received, both as sent (never eased again here), so another
 * player's beeble turns and looks exactly as it does on its own screen, INTERP_DELAY_MS later.
 *
 * Each has the NPC beeble's collider, an imperative kinematic capsule parked where it is drawn (as a
 * synced NPC's, objects/actors/model/hooks.ts), so the local player bumps into it; and is clickable as an
 * NPC is: the crosshair's ray (player/utils.ts aimFromCamera) hitting its drawn MESH within an NPC's reach
 * (useMouseEvents' triangle test, objects/actors/model/geometry.ts) claims the hover, the nearest one wins,
 * and a click tells that player (`player:click`).
 */

/** A head change after a quiet spell is played over at most this long (as the track's idle gaps:
 *  net/entities/utils.ts): from the pose held through the quiet, never smeared across it. */
const HEAD_BLEND_MS = 100;

const COLLIDER = BEEBLE_SPEC.collider as CapsuleColliderSpec;
const HALF_HEIGHT = COLLIDER.height / 2;

const _aim = new THREE.Ray();
const _center = new THREE.Vector3();
const _next = { x: 0, y: 0, z: 0 };

/** Shows the received pose the playback clock has reached (the oldest held until then; the passed ones are
 *  dropped): its clip, and its head interpolated toward the next one's. */
const showAvatarAt = (p: RemotePlayer, renderTime: number): void => {
  const queue = p.avatars;
  while (queue.length > 1 && !(queue[1].st > renderTime)) queue.shift();
  const a = queue[0];
  const b = queue[1];
  const body = p.body;
  body.clip = a.clip;
  body.clipSpeed = a.cs;
  body.loop = a.loop;
  let t = 0;
  if (b && renderTime > a.st) {
    const from = Math.max(a.st, b.st - HEAD_BLEND_MS);
    t = Math.min(Math.max((renderTime - from) / (b.st - from), 0), 1);
  }
  body.headYaw = b ? a.hy + (b.hy - a.hy) * t : a.hy;
  body.headPitch = b ? a.hp + (b.hp - a.hp) * t : a.hp;
};

export const RemotePlayers = () => {
  const version = useRosterVersion();
  const list = useMemo(() => Array.from(getRemotePlayers().values()), [version]);
  const { world, rapier } = useRapier();
  /** Each remote player's capsule. */
  const bodies = useRef(new Map<string, RapierRigidBody>()).current;
  const hovered = useRef<string | null>(null);
  const frame = useRef(0);
  const hoverTarget = useMemo<HoverTarget>(
    () => ({
      distance: Infinity,
      growsCursor: true,
      onMouse: (e) => {
        if (e.type === "click" && e.button === 0 && hovered.current) send({ t: "player:click", id: hovered.current });
      },
    }),
    [],
  );

  useEffect(() => {
    const live = getRemotePlayers();
    for (const [id, body] of bodies) {
      if (live.has(id)) continue;
      world.removeRigidBody(body);
      bodies.delete(id);
    }
    for (const p of live.values()) {
      if (bodies.has(p.id)) continue;
      const body = world.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, p.y, p.z));
      world.createCollider(rapier.ColliderDesc.capsule(HALF_HEIGHT - COLLIDER.radius, COLLIDER.radius), body);
      bodies.set(p.id, body);
    }
  }, [version, world, rapier, bodies]);

  useEffect(
    () => () => {
      for (const body of bodies.values()) world.removeRigidBody(body);
      bodies.clear();
      hovered.current = null;
      releaseHover(hoverTarget);
    },
    [world, bodies, hoverTarget],
  );

  /** The remote player under the crosshair: the nearest whose drawn mesh the aim ray hits within reach. */
  const pickHovered = (camera: THREE.Camera): void => {
    const ray = aimFromCamera(camera, _aim);
    const range = DEFAULT_INTERACT_REACH + RAYCAST_RANGE_PAD;
    let id: string | null = null;
    let nearest = Infinity;
    for (const p of getRemotePlayers().values()) {
      if (p.meshes.length === 0 || !p.body.visible) continue;
      if (ray.origin.distanceToSquared(_center.set(p.x, p.y, p.z)) > range * range) continue;
      const d = rayHitDistance(ray, p.meshes, DEFAULT_INTERACT_REACH);
      if (d <= DEFAULT_INTERACT_REACH && d < nearest) {
        nearest = d;
        id = p.id;
      }
    }
    if (id) hoverTarget.distance = nearest;
    hovered.current = id;
    if (id) claimHover(hoverTarget);
    else releaseHover(hoverTarget);
  };

  // Before PlayerBody's pose (-2), as the local Player (-3).
  useFrame((state, delta) => {

    for (const p of getRemotePlayers().values()) {
      if (p.playback.sample(p, delta, p.pose) === "none") continue;
      const pose = p.pose;
      p.x = pose.x;
      p.y = pose.y;
      p.z = pose.z;
      showAvatarAt(p, p.playback.renderTime);

      const body = p.body;
      body.feetX = p.x;
      body.feetY = p.y - PLAYER_HEIGHT / 2;
      body.feetZ = p.z;
      body.yaw = pose.ry;
      body.visible = true;
      // Published positions are the capsule CENTER, which is the collider's.
      _next.x = p.x;
      _next.y = p.y;
      _next.z = p.z;
      bodies.get(p.id)?.setNextKinematicTranslation(_next);
      // Their tracks in the snow too (a stamp dents only where the sheet has snow under it).
      stampSnowTrailAlong(p.lastStamp, p.x, p.z);
    }

    if (frame.current++ % MOUSE_RAYCAST_INTERVAL_FRAMES === 0) pickHovered(state.camera);
  }, -3);

  return (
    <Suspense fallback={null}>
      {list.map((p) => (
        <PlayerBody key={p.id} state={p.body} meshes={p.meshes} />
      ))}
    </Suspense>
  );
};
