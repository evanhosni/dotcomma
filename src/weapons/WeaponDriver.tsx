import { useFrame, useThree } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { EQUIPPABLE_MODELS } from "../equippables/registry";
import { equippableOf } from "../equippables/spec";
import { getEquipped, isEquipWheelOpen, subscribeEquipment } from "../equippables/store";
import { onServerMessage, send } from "../net";
import type { ShotHit, ShotImpact, Vec3Tuple } from "../net/protocol/types";
import { getRemotePlayers } from "../net/players/store";
import { collectSkinnedMeshes } from "../objects/actors/model/geometry";
import { getLiveModelActor, liveModelActors } from "../objects/actors/model/registry";
import { woundTunnelMaterial } from "../objects/actors/wounds/material";
import { CORPSE_CARRY, CORPSE_PUSH } from "../objects/actors/wounds/constants";
import { getCorpse, liveCorpses } from "../player/corpses/registry";
import { getLocalPlayerBody, isPlayerHeld } from "../player/store";
import { aimFromCamera } from "../player/utils";
import { setHoverSuspended } from "../utils/cursor";
import { meshTemplate, warmPrograms } from "../utils/render";
import { sprayBlood } from "../vfx/blood";
import { stampDecal } from "../vfx/decals";
import { BULLET_HOLE_SIZE, RECOIL_BACK, RECOIL_PITCH, RECOIL_SETTLE, VIEW_OFFSET, VIEW_SCALE } from "./constants";
import { flashMuzzle, settleMuzzle } from ".";
import { weaponOf } from "./spec";
import type { ShotTarget } from "./types";
import { shotHitsOf } from "./utils";

const _aim = new THREE.Ray();
const _offset = new THREE.Vector3();
const _kick = new THREE.Quaternion();
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

/** One body a bullet went through, as every client draws it: blood out of the wound and out of the body's far
 *  side; a corpse (an NPC's or a player's: each client simulates its own fall) shoved along the bullet; a
 *  player's corpse taking the holes (an NPC's come back with its state). */
const landHit = (hit: ShotHit, dir: Vec3Tuple): void => {
  const at = hit.at;
  sprayBlood(at, dir);
  sprayBlood([at[0] + dir[0] * EXIT_SPRAY_DEPTH, at[1] + dir[1] * EXIT_SPRAY_DEPTH, at[2] + dir[2] * EXIT_SPRAY_DEPTH], dir);
  const shove = { bone: hit.wounds[0]?.entry.b[0] ?? "", x: dir[0] * CORPSE_PUSH, y: dir[1] * CORPSE_PUSH, z: dir[2] * CORPSE_PUSH, carry: CORPSE_CARRY };
  if (hit.kind === "npc") getLiveModelActor(hit.id)?.push(shove);
  if (hit.kind !== "corpse") return;
  const corpse = getCorpse(hit.id);
  corpse?.wound(hit.wounds);
  corpse?.push(shove);
};

/** Where a bullet stopped: its hole. */
const landEnd = (end: ShotImpact | null): void => {
  if (end) stampDecal("bulletHole", end.at, end.n, BULLET_HOLE_SIZE);
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
 * fired by the left button while the pointer is locked. A shot is the crosshair's ray (aimFromCamera): it goes
 * through every body on its way (utils.ts shotHitsOf) and stops at the world's first solid surface, leaving a
 * bullet hole there (vfx/decals/). The SERVER applies the hits (net/protocol ShootMessage): an NPC's or a
 * player's holes come back with its state; the blood, a corpse's shove and a player's corpse's new holes are
 * drawn here at once. Other players' shots (`shot`) flash their gun and draw the same. Mounted once, inside
 * the physics world.
 */
export const WeaponDriver = () => {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const clock = useThree((s) => s.clock);
  const { world, rapier } = useRapier();
  /** The first-person view of what is in hand: a model per equippable, made when first held. */
  const views = useMemo(() => new Map<string, THREE.Object3D>(), []);
  const shownView = useRef<THREE.Object3D | null>(null);
  const recoil = useRef(0);
  const lastShotAt = useRef(-Infinity);

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

  useEffect(() => {
    const cancelWarm = warmPrograms(scene, [...Object.values(EQUIPPABLE_MODELS).map((create) => create()), meshTemplate(woundTunnelMaterial())]);
    return () => {
      cancelWarm();
      for (const view of views.values()) view.removeFromParent();
      views.clear();
      shownView.current = null;
    };
  }, [scene, views]);

  useEffect(() => {
    const sync = () => setHoverSuspended(!!equippableOf(getEquipped())?.weapon);
    sync();
    const unsubscribe = subscribeEquipment(sync);
    return () => {
      unsubscribe();
      setHoverSuspended(false);
    };
  }, []);

  useEffect(() => {
    const fire = (): void => {
      const weapon = weaponOf(equippableOf(inHand())?.weapon ?? "");
      const body = getLocalPlayerBody();
      const now = clock.elapsedTime;
      if (!weapon || !body || now - lastShotAt.current < weapon.fireInterval) return;
      lastShotAt.current = now;
      const ray = aimFromCamera(camera, _aim);
      const solid = world.castRayAndGetNormal(
        new rapier.Ray(ray.origin, ray.direction),
        weapon.range,
        true,
        rapier.QueryFilterFlags.ONLY_FIXED | rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      );
      const hits = shotHitsOf(ray, solid ? solid.timeOfImpact : weapon.range, shotTargets(), weapon.woundRadius);
      const d = tupleOf(ray.direction);
      let end: ShotImpact | null = null;
      if (solid) {
        const n = new THREE.Vector3(solid.normal.x, solid.normal.y, solid.normal.z).normalize();
        // Facing the shooter, whichever way round the collider gives it.
        if (n.dot(ray.direction) > 0) n.negate();
        end = { at: tupleOf(ray.at(solid.timeOfImpact, new THREE.Vector3())), n: tupleOf(n) };
      }
      send({ t: "shoot", weapon: weapon.id, o: tupleOf(ray.origin), d, hits, end });
      for (const hit of hits) landHit(hit, d);
      landEnd(end);
      body.shots++;
      recoil.current = 1;
      if (shownView.current) flashMuzzle(shownView.current, now);
    };
    const onMouseDown = (e: MouseEvent): void => {
      if (e.button === 0 && document.pointerLockElement && !isEquipWheelOpen()) fire();
    };
    document.addEventListener("mousedown", onMouseDown);
    const unsubscribe = onServerMessage((msg) => {
      if (msg.t !== "shot") return;
      const shooter = getRemotePlayers().get(msg.id);
      if (shooter) shooter.body.shots++;
      for (const hit of msg.hits) landHit(hit, msg.d);
      landEnd(msg.end);
    });
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      unsubscribe();
    };
  }, [camera, clock, world, rapier]);

  // After the Player placed the camera (its frame is earlier), before the scene renders.
  useFrame((_, delta) => {
    const body = getLocalPlayerBody();
    const held = inHand();
    if (body) body.equipped = held;
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
    _offset.set(VIEW_OFFSET[0], VIEW_OFFSET[1], VIEW_OFFSET[2] + kick * RECOIL_BACK).applyQuaternion(camera.quaternion);
    view.position.copy(camera.position).add(_offset);
    view.quaternion.copy(camera.quaternion).multiply(FACE_AHEAD).multiply(_kick.setFromAxisAngle(X_AXIS, -kick * RECOIL_PITCH));
    view.scale.setScalar(VIEW_SCALE);
    settleMuzzle(view, clock.elapsedTime);
  }, 1);

  return null;
};
