import { useFrame, useThree } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { EQUIPPABLE_MODELS } from "../equippables/registry";
import { getEquipped, isEquipWheelOpen, subscribeEquipment } from "../equippables/store";
import { equippableOf } from "../equippables/spec";
import { onServerMessage, send } from "../net";
import type { ShotHit, ShotImpact, Vec3Tuple } from "../net/protocol/types";
import { getRemotePlayers } from "../net/players/store";
import { collectSkinnedMeshes } from "../objects/actors/model/geometry";
import { getLiveModelActor, liveModelActors } from "../objects/actors/model/registry";
import { woundTunnelMaterial } from "../objects/actors/wounds/material";
import { CORPSE_CARRY, CORPSE_PUSH, KILL_CARRY, KILL_PUSH } from "../objects/actors/wounds/constants";
import { getCorpse, liveCorpses } from "../player/corpses/registry";
import { getLocalPlayerBody, isPlayerHeld } from "../player/store";
import { aimFromCamera } from "../player/utils";
import { setHoverSuspended } from "../utils/cursor";
import { meshTemplate, warmPrograms } from "../utils/render";
import { sprayBlood } from "../vfx/blood";
import { stampDecal } from "../vfx/decals";
import { explode } from "../vfx/explosions";
import {
  AUTOMATIC_RECOIL,
  BODY_TEST_RADIUS,
  BULLET_HOLE_SIZE,
  RECOIL_BACK,
  RECOIL_PITCH,
  RECOIL_SETTLE,
  ROCKET_BODY_RADIUS,
  SWING_SECONDS,
  SWING_SWEEP,
  SWING_TILT,
  VIEW_OFFSET,
  VIEW_SCALE,
} from "./constants";
import { flashMuzzle, settleMuzzle } from ".";
import { Rockets } from "./rockets/Rockets";
import type { RocketWorld } from "./rockets/Rockets";
import { weaponOf } from "./spec";
import type { WeaponSpec } from "./spec";
import type { ShotTarget } from "./types";
import { blastHitsOf, shotHitsOf, sliceHitsOf } from "./utils";

const _aim = new THREE.Ray();
const _offset = new THREE.Vector3();
const _kick = new THREE.Quaternion();
const _swing = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _blow = new THREE.Vector3();
const _closest = new THREE.Vector3();
const _origin = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0);
/** A model's forward is its +z; the camera looks down its −z. */
const FACE_AHEAD = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

/** Each model's skinned meshes, largest first (what a shot is tested against). */
const meshesOf = new WeakMap<THREE.Object3D, THREE.SkinnedMesh[]>();
const skinnedMeshesOf = (model: THREE.Group | THREE.Object3D): THREE.SkinnedMesh[] => {
  let meshes = meshesOf.get(model);
  if (!meshes) {
    meshes = [];
    collectSkinnedMeshes(model as THREE.Group, meshes);
    meshesOf.set(model, meshes);
  }
  return meshes;
};

/** Every body a shot can hit now: the NPCs the server knows, drawn here, the other players' beebles and the
 *  dead players' corpses. */
function* shotTargets(): Generator<ShotTarget> {
  for (const actor of liveModelActors()) {
    const group = actor.group;
    if (!actor.synced || !group || !actor.model.visible) continue;
    yield { kind: "npc", id: actor.id, origin: actor.bodyCenter(new THREE.Vector3()), meshes: skinnedMeshesOf(actor.model) };
  }
  for (const p of getRemotePlayers().values()) {
    if (p.dead || p.body.form !== "host" || !p.body.visible || p.meshes.length === 0) continue;
    yield { kind: "player", id: p.id, origin: new THREE.Vector3(p.x, p.y, p.z), meshes: p.meshes };
  }
  for (const c of liveCorpses()) yield { kind: "corpse", id: c.id, origin: c.center(new THREE.Vector3()), meshes: c.meshes };
}

const tupleOf = (v: THREE.Vector3): Vec3Tuple => [v.x, v.y, v.z];
/** A second spray bursts out of the far side of the body, about this far along the bullet (u: a beeble's
 *  depth; the exit hole's own position is on a bone). */
const EXIT_SPRAY_DEPTH = 0.6;

/** A unit direction `dir` turned off at random by up to `spread` (a blood burst's own way). */
const scatter = (dir: Vec3Tuple, spread: number): Vec3Tuple => {
  _blow.set(dir[0] + (Math.random() - 0.5) * spread, dir[1] + (Math.random() - 0.5) * spread, dir[2] + (Math.random() - 0.5) * spread).normalize();
  return tupleOf(_blow);
};

/** The blood a body bursts with: a bullet's out of the wound and the body's far side; a blade's and a blast's
 *  every way along the blow; then the weapon's further bursts (`blood`) about the wound. */
const bleed = (hit: ShotHit, dir: Vec3Tuple, weapon: WeaponSpec | undefined): void => {
  const at = hit.at;
  const bursts = weapon?.blood ?? 2;
  if (!hit.cuts && !hit.gib) {
    sprayBlood(at, dir);
    sprayBlood([at[0] + dir[0] * EXIT_SPRAY_DEPTH, at[1] + dir[1] * EXIT_SPRAY_DEPTH, at[2] + dir[2] * EXIT_SPRAY_DEPTH], dir);
    for (let i = 2; i < bursts; i++) sprayBlood(at, scatter(dir, 1.2), 0.6);
    return;
  }
  for (let i = 0; i < bursts; i++) sprayBlood(at, scatter(dir, hit.gib ? 2.5 : 1.4));
};

/** One body a shot went through, as every client draws it: blood; a corpse (an NPC's or a player's: each
 *  client simulates its own fall) shoved along the blow; a blade's cuts and a blast's burst, an NPC's drawn
 *  here at once (its death predicted) until the server's state says the same; a player's corpse taking the
 *  holes (an NPC's come back with its state). `end`: where the shot stopped (a blast's centre). */
const landHit = (hit: ShotHit, dir: Vec3Tuple, weapon: WeaponSpec | undefined, end: ShotImpact | null): void => {
  bleed(hit, dir, weapon);
  const strikes = !!hit.cuts || !!hit.gib;
  const push = strikes ? KILL_PUSH : CORPSE_PUSH;
  const shove = { bone: hit.wounds[0]?.entry.b[0] ?? "", x: dir[0] * push, y: dir[1] * push, z: dir[2] * push, carry: strikes ? KILL_CARRY : CORPSE_CARRY };
  const blow = { cuts: hit.cuts, gib: hit.gib && end ? end.at : undefined };
  if (hit.kind === "npc") {
    const actor = getLiveModelActor(hit.id);
    if (strikes) {
      actor?.setRagdoll(true, shove);
      actor?.strike(blow);
    } else actor?.push(shove);
  }
  if (hit.kind !== "corpse") return;
  const corpse = getCorpse(hit.id);
  corpse?.wound(hit.wounds);
  corpse?.push(shove);
  if (strikes) corpse?.strike(blow);
};

/** Where a shot stopped: a bullet's hole, or a blast. */
const landEnd = (end: ShotImpact | null, weapon: WeaponSpec | undefined, inAir = false): void => {
  if (!end) return;
  if (weapon?.attack === "blast") explode(end.at, weapon.blastRadius ?? 1, inAir ? null : end.n);
  else if (weapon?.attack !== "blade") stampDecal("bulletHole", end.at, end.n, BULLET_HOLE_SIZE);
};

/** The local player's equippable in hand while it can use it ("" none). */
const inHand = (): string => {
  const body = getLocalPlayerBody();
  return body && body.form === "host" && !isPlayerHeld() ? getEquipped() : "";
};

/**
 * THE local player's weapon use (weapons/README.md). What is in its hand (equippables/store.ts, picked on the
 * wheel) is put in its body's state (PlayerBodyState.equipped: held in its hands in third person and to
 * everyone else, player/PlayerBody.tsx), drawn before the eye in first person, and, when it is a weapon,
 * used by the left button while the pointer is locked (held down, an automatic keeps firing). A BULLET is the
 * crosshair's ray (aimFromCamera): it goes through every body on its way (utils.ts shotHitsOf) and stops at
 * the world's first solid surface, leaving a bullet hole there (vfx/decals/). A BLADE's swing is a plane
 * through the look, tilted each swing, cutting what it crosses within reach (sliceHitsOf). A BLAST is a
 * rocket (rockets/Rockets.ts) that goes off where it meets the world or a body, bursting every body near
 * (blastHitsOf). The SERVER applies the hits (net/protocol ShootMessage): an NPC's or a player's holes, cuts
 * and bursts come back with its state; the blood, a corpse's shove and a player's corpse's new holes are drawn
 * here at once. Other players' shots (`shot`) flash their weapon and draw the same. Mounted once, inside the
 * physics world.
 */
export const WeaponDriver = () => {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const clock = useThree((s) => s.clock);
  const { world, rapier } = useRapier();
  /** The first-person view of what is in hand: a model per equippable, made when first held. */
  const views = useMemo(() => new Map<string, THREE.Object3D>(), []);
  const rockets = useMemo(() => new Rockets(scene), [scene]);
  const shownView = useRef<THREE.Object3D | null>(null);
  const recoil = useRef(0);
  const lastShotAt = useRef(-Infinity);
  const trigger = useRef(false);
  /** The last swing: when, which way across (±1), how tilted. */
  const swing = useRef({ at: -Infinity, side: 1, tilt: 0 });

  const viewOf = (id: string): THREE.Object3D | null => {
    let view = views.get(id);
    if (!view) {
      const create = EQUIPPABLE_MODELS[id];
      if (!create) return null;
      view = create();
      view.visible = false;
      scene.add(view);
      views.set(id, view);
    }
    return view;
  };

  /** The world's first FIXED collider along a ray (a building, the ground), its normal facing back along it. */
  const solidAlong = (from: THREE.Vector3, dir: THREE.Vector3, length: number): { distance: number; normal: THREE.Vector3 } | null => {
    const hit = world.castRayAndGetNormal(new rapier.Ray(from, dir), length, true, rapier.QueryFilterFlags.ONLY_FIXED | rapier.QueryFilterFlags.EXCLUDE_SENSORS);
    if (!hit) return null;
    const normal = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z).normalize();
    // Facing the shooter, whichever way round the collider gives it.
    if (normal.dot(dir) > 0) normal.negate();
    return { distance: hit.timeOfImpact, normal };
  };

  const rocketWorld: RocketWorld = {
    solidAlong,
    bodyNear: (point) => {
      for (const target of shotTargets()) {
        if (target.origin.distanceToSquared(point) > BODY_TEST_RADIUS * BODY_TEST_RADIUS) continue;
        // A body's origin is its feet or its centre: near either.
        _closest.copy(target.origin);
        if (_closest.distanceTo(point) <= ROCKET_BODY_RADIUS || _closest.setY(_closest.y + 0.9).distanceTo(point) <= ROCKET_BODY_RADIUS) return true;
      }
      return false;
    },
  };

  useEffect(() => {
    const cancelWarm = warmPrograms(scene, [...Object.values(EQUIPPABLE_MODELS).map((create) => create()), meshTemplate(woundTunnelMaterial())]);
    return () => {
      cancelWarm();
      for (const view of views.values()) view.removeFromParent();
      views.clear();
      shownView.current = null;
      rockets.dispose();
    };
  }, [scene, views, rockets]);

  useEffect(() => {
    const sync = () => setHoverSuspended(!!equippableOf(getEquipped())?.weapon);
    sync();
    const unsubscribe = subscribeEquipment(sync);
    return () => {
      unsubscribe();
      setHoverSuspended(false);
    };
  }, []);

  /** A bullet along the crosshair. */
  const shoot = (weapon: WeaponSpec): void => {
    const ray = aimFromCamera(camera, _aim);
    const solid = solidAlong(ray.origin, ray.direction, weapon.range);
    const hits = shotHitsOf(ray, solid ? solid.distance : weapon.range, shotTargets(), weapon.woundRadius);
    const d = tupleOf(ray.direction);
    const end: ShotImpact | null = solid ? { at: tupleOf(ray.at(solid.distance, new THREE.Vector3())), n: tupleOf(solid.normal) } : null;
    send({ t: "shoot", weapon: weapon.id, o: tupleOf(ray.origin), d, hits, end });
    for (const hit of hits) landHit(hit, d, weapon, end);
    landEnd(end, weapon);
  };

  /** A blade's swing: across the look, each swing the other way and tilted anew. */
  const slash = (weapon: WeaponSpec, now: number): void => {
    const ray = aimFromCamera(camera, _aim);
    const side = -swing.current.side;
    const tilt = side * (0.15 + Math.random() * 0.85) * SWING_TILT;
    swing.current = { at: now, side, tilt };
    _right.copy(X_AXIS).applyQuaternion(camera.quaternion);
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    _normal.copy(_up).multiplyScalar(Math.cos(tilt)).addScaledVector(_right, Math.sin(tilt));
    _normal.addScaledVector(ray.direction, -_normal.dot(ray.direction)).normalize();
    const hits = sliceHitsOf(ray.origin, ray.direction, _normal, weapon.range, shotTargets());
    // The blow: forward and across, the way the blade travels.
    _blow.crossVectors(_normal, ray.direction).multiplyScalar(side).add(ray.direction).normalize();
    const d = tupleOf(_blow);
    send({ t: "shoot", weapon: weapon.id, o: tupleOf(ray.origin), d, hits, end: null });
    for (const hit of hits) landHit(hit, d, weapon, null);
  };

  /** A rocket off the launcher's mouth (in first person, the view's), along the crosshair. */
  const launch = (weapon: WeaponSpec): void => {
    const ray = aimFromCamera(camera, _aim);
    _origin.copy(ray.origin).addScaledVector(ray.direction, 0.7);
    rockets.launch(weapon, _origin, ray.direction);
  };

  /** Fires what is in hand if its time has come. */
  const fire = (): void => {
    const weapon = weaponOf(equippableOf(inHand())?.weapon ?? "");
    const body = getLocalPlayerBody();
    const now = clock.elapsedTime;
    if (!weapon || !body || now - lastShotAt.current < weapon.fireInterval) return;
    lastShotAt.current = now;
    if (weapon.attack === "bullet") shoot(weapon);
    else if (weapon.attack === "blade") slash(weapon, now);
    else launch(weapon);
    body.shots++;
    recoil.current = weapon.attack === "blade" ? 0 : weapon.automatic ? AUTOMATIC_RECOIL : 1;
    if (shownView.current) flashMuzzle(shownView.current, now);
  };
  const fireRef = useRef(fire);
  fireRef.current = fire;

  useEffect(() => {
    const onMouseDown = (e: MouseEvent): void => {
      if (e.button !== 0 || !document.pointerLockElement || isEquipWheelOpen()) return;
      trigger.current = true;
      fireRef.current();
    };
    const onMouseUp = (e: MouseEvent): void => {
      if (e.button === 0) trigger.current = false;
    };
    const onLockChange = (): void => {
      if (!document.pointerLockElement) trigger.current = false;
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("pointerlockchange", onLockChange);
    const unsubscribe = onServerMessage((msg) => {
      if (msg.t !== "shot") return;
      const shooter = getRemotePlayers().get(msg.id);
      if (shooter) shooter.body.shots++;
      const weapon = weaponOf(msg.weapon);
      for (const hit of msg.hits) landHit(hit, hit.gib && msg.end ? awayFrom(msg.end.at, hit.at) : msg.d, weapon, msg.end);
      landEnd(msg.end, weapon);
    });
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("pointerlockchange", onLockChange);
      unsubscribe();
    };
  }, []);

  // After the Player placed the camera (its frame is earlier), before the scene renders.
  useFrame((_, delta) => {
    const body = getLocalPlayerBody();
    const held = inHand();
    if (body) body.equipped = held;
    const spec = equippableOf(held);
    const weapon = weaponOf(spec?.weapon ?? "");
    if (trigger.current && weapon?.automatic && !isEquipWheelOpen()) fire();

    for (const burst of rockets.step(Math.min(delta, 0.1), rocketWorld)) {
      const rocket = burst.weapon;
      const hits = blastHitsOf(burst.at, rocket.blastRadius ?? 1, shotTargets());
      const end: ShotImpact = { at: tupleOf(burst.at), n: tupleOf(burst.normal ?? _normal.copy(burst.dir).negate()) };
      send({ t: "shoot", weapon: rocket.id, o: tupleOf(camera.position), d: tupleOf(burst.dir), hits, end });
      for (const hit of hits) landHit(hit, awayFrom(end.at, hit.at), rocket, end);
      landEnd(end, rocket, !burst.normal);
    }

    // First person: the body is not drawn (Player.tsx), so what it holds is drawn before the eye instead.
    const view = held && body && !body.visible ? viewOf(held) : null;
    if (shownView.current !== view) {
      if (shownView.current) shownView.current.visible = false;
      shownView.current = view;
    }
    if (!view) return;
    view.visible = true;
    recoil.current *= Math.exp(-RECOIL_SETTLE * delta);
    const kick = recoil.current;
    const offset = spec?.view ?? VIEW_OFFSET;
    _offset.set(offset[0], offset[1], offset[2] + kick * RECOIL_BACK);
    view.quaternion.copy(camera.quaternion);
    const s = swing.current;
    const t = (clock.elapsedTime - s.at) / SWING_SECONDS;
    if (weapon?.attack === "blade" && t < 1) {
      // The sweep: about the swing plane's normal (camera space), from one side across to the other.
      _axis.set(Math.sin(s.tilt), Math.cos(s.tilt), 0);
      _swing.setFromAxisAngle(_axis, (0.5 - t) * SWING_SWEEP * s.side);
      _offset.applyQuaternion(_swing);
      view.quaternion.multiply(_swing);
    }
    _offset.applyQuaternion(camera.quaternion);
    view.position.copy(camera.position).add(_offset);
    view.quaternion.multiply(FACE_AHEAD).multiply(_kick.setFromAxisAngle(X_AXIS, -kick * RECOIL_PITCH));
    view.scale.setScalar(VIEW_SCALE);
    view.updateMatrixWorld(true);
    settleMuzzle(view, clock.elapsedTime);
  }, 1);

  return null;
};

/** The unit way from a blast's centre to a body (straight up when it went off inside it). */
const awayFrom = (center: Vec3Tuple, at: Vec3Tuple): Vec3Tuple => {
  _blow.set(at[0] - center[0], at[1] - center[1] + 0.3, at[2] - center[2]);
  if (_blow.lengthSq() < 1e-6) _blow.set(0, 1, 0);
  return tupleOf(_blow.normalize());
};
