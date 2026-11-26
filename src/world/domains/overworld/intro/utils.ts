import * as THREE from "three";
import { getConnectionState, onServerMessage, send } from "../../../../net";
import { BEEBLE_SPEC } from "../../../../objects/actors/beeble/spec";
import { mavSeatOf } from "../../../../objects/actors/mav-unit";
import { MAV_HOST_BONE } from "../../../../objects/actors/mav-unit/spec";
import type { LiveModelActor } from "../../../../objects/actors/model/registry";
import { skeletonLayoutOf } from "../../../../objects/actors/ragdoll/utils";
import { spawnPointId } from "../../../../objects/actors/spawning/utils";
import { loadSpawnPointsAround } from "../../../../objects/actors/spawning/worker";
import { isActorRetired } from "../../../../objects/actors/store";
import { PLAYER_EYE_HEIGHT } from "../../../../player/spec";
import type { PointXZ } from "../../../../utils/math/types";
import { getVertexData, getVertexSample } from "../../../terrain/utils";
import { addressOfPosition } from "../address";
import { BLINKS, CAMERA_GROUND_CLEARANCE, CLAIM_TIMEOUT_MS, DIVE_BOOST, DIVE_HEIGHT, FALL_ACCELERATION, FALL_MAX_SPEED, HOST_CANDIDATES, HOST_RING_STEP, HOST_SEARCH_RADIUS, HOST_SEARCH_RINGS, HOST_SURFACE_TOLERANCE } from "./constants";
import type { Host, HostView, IntroRun } from "./types";

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _look = new THREE.Matrix4();
const _ahead = new THREE.Vector3();
const _side = new THREE.Vector3();
const _headUp = new THREE.Vector3();
const _target = new THREE.Vector3();

export const createIntroRun = (): IntroRun => ({
  phase: "title",
  nextPhase: null,
  phaseAt: NaN,
  ready: false,
  start: { x: 0, z: 0 },
  address: null,
  expanding: false,
  lastFlickerAt: 0,
  promptAt: 0,
  mav: new THREE.Vector3(),
  landY: 0,
  spin: 0,
  spinAtImpact: 0,
  screwDepth: 0,
  host: null,
  searchDone: false,
  view: null,
  refused: new Set<string>(),
  skyClear: null,
  liveSince: NaN,
  rehosting: false,
  heldSince: NaN,
  track: { key: "", from: { x: 0, z: 0 }, at: -Infinity, seconds: 0 },
  lying: { taken: false, at: new THREE.Vector3(), look: new THREE.Quaternion() },
  recoverAt: NaN,
});

/** Where the scan looks, in order: the start, then rings of places around it (6 more per ring). */
export const searchPlaces = (start: PointXZ): PointXZ[] => {
  const places = [start];
  for (let ring = 1; ring <= HOST_SEARCH_RINGS; ring++) {
    const count = ring * 6;
    for (let i = 0; i < count; i++) {
      const a = ((i + (ring % 2) * 0.5) / count) * Math.PI * 2;
      places.push({ x: start.x + Math.cos(a) * ring * HOST_RING_STEP, z: start.z + Math.sin(a) * ring * HOST_RING_STEP });
    }
  }
  return places;
};

/** The ground under a point: the padded height on the worker when it is up. */
export const groundAt = async (x: number, z: number) => (await getVertexSample(x, z)) ?? (await getVertexData(x, z));

/** The beebles a MAV Unit could take around a place (only those standing in the address `inPath`, given one),
 *  nearest first: the same deterministic spawn points ActorPool mounts (so the id is the id of the beeble that
 *  will stand there), never one already taken, never one under the ground (a cave's or a sewer's: the height
 *  pipeline's vertical "ray", the only one that exists this far from the player) or in water, never one
 *  already `refused` (Intro.tsx's sky test). */
export const hostsAround = async (place: PointXZ, radius = HOST_SEARCH_RADIUS, inPath?: string, refused?: ReadonlySet<string>): Promise<Host[]> => {
  const points = await loadSpawnPointsAround(place.x, place.z, radius);
  const near = points
    .filter((p) => p.descriptorId === BEEBLE_SPEC.id)
    .filter((p) => !inPath || addressOfPosition(p.x, p.z).path === inPath)
    .map((p) => ({ id: spawnPointId(p.x, p.z, p.descriptorId), x: p.x, z: p.z, groundY: p.height }))
    .filter((h) => !isActorRetired(h.id) && !refused?.has(h.id))
    .sort((a, b) => Math.hypot(a.x - place.x, a.z - place.z) - Math.hypot(b.x - place.x, b.z - place.z))
    .slice(0, HOST_CANDIDATES);
  const hosts: Host[] = [];
  for (const h of near) {
    const ground = await groundAt(h.x, h.z);
    const dry = Number.isNaN(ground.waterHeight) || ground.waterHeight <= ground.height;
    if (dry && Math.abs(ground.height - h.groundY) <= HOST_SURFACE_TOLERANCE) hosts.push(h);
  }
  return hosts;
};

/** Asks the server for the host; true when it is this player's (also with no server to ask). */
export const claimHost = (id: string): Promise<boolean> =>
  new Promise((resolve) => {
    if (!send({ t: "host", id, step: "claim" })) {
      resolve(true);
      return;
    }
    const done = (ok: boolean) => {
      clearTimeout(timer);
      stop();
      resolve(ok);
    };
    // Unanswered: granted only if the connection is gone (nobody to share the world with); a slow server is a
    // refusal, so two players never both take the same beeble.
    const timer = setTimeout(() => done(getConnectionState().status !== "connected"), CLAIM_TIMEOUT_MS);
    const stop = onServerMessage((msg) => {
      if (msg.t === "host:claim" && msg.id === id) done(msg.ok);
    });
  });

/** The unit's fall speed (u/s, down) `elapsed` seconds into the fall, `height` above where it lands:
 *  accelerating out of the hover, then diving faster still over the last DIVE_HEIGHT, into the impact. */
export const fallSpeedAt = (elapsed: number, height: number): number =>
  Math.min(FALL_ACCELERATION * elapsed, FALL_MAX_SPEED) * (1 + DIVE_BOOST * Math.max(0, 1 - Math.max(height, 0) / DIVE_HEIGHT));

/** How open the waking eyes are (0–1), `t` seconds after the screen went black: BLINKS, eased between. */
export const eyesOpenAt = (t: number): number => {
  for (let i = 1; i < BLINKS.length; i++) {
    const [t1, open1] = BLINKS[i];
    if (t > t1) continue;
    const [t0, open0] = BLINKS[i - 1];
    const k = (t - t0) / (t1 - t0);
    return open0 + (open1 - open0) * k * k * (3 - 2 * k);
  }
  return 1;
};

/** A host's seat and eyes; null for a model without them. */
export const hostViewOf = (live: LiveModelActor): HostView | null => {
  const seat = mavSeatOf(live.model);
  const toHead = skeletonLayoutOf(live.model)?.modelToBone.get(MAV_HOST_BONE);
  return seat && toHead ? { seat, eye: new THREE.Vector3(0, PLAYER_EYE_HEIGHT, 0).applyMatrix4(toHead) } : null;
};

/** The view of the host lying where it fell: from its eyes (never under the ground at `groundY`), along the
 *  ground the way its face points, rolled onto the side its head lies on. The head's own turn would show the
 *  sky or the dirt as the fall happened to leave it; this is always the sideways look of waking on the ground. */
export const lyingViewOf = (view: HostView, live: LiveModelActor, groundY: number, outAt: THREE.Vector3, outLook: THREE.Quaternion): void => {
  const bone = view.seat.bone;
  bone.updateWorldMatrix(true, false);
  outAt.copy(view.eye).applyMatrix4(bone.matrixWorld);
  outAt.y = Math.max(outAt.y, groundY + CAMERA_GROUND_CLEARANCE);
  bone.getWorldQuaternion(_q).multiply(view.seat.rotation);
  _ahead.set(0, 0, 1).applyQuaternion(_q).setY(0);
  const facing = live.group?.rotation.y ?? 0;
  if (_ahead.lengthSq() < 0.01) _ahead.set(Math.sin(facing), 0, Math.cos(facing));
  _ahead.normalize();
  _side.crossVectors(_ahead, WORLD_UP);
  _headUp.set(0, 1, 0).applyQuaternion(_q);
  if (_headUp.dot(_side) < 0) _side.negate();
  outLook.setFromRotationMatrix(_look.lookAt(outAt, _target.copy(outAt).add(_ahead), _side));
};
