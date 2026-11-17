import { useRapier } from "@react-three/rapier";
import type { RapierRigidBody } from "@react-three/rapier";
import { useEffect, useRef } from "react";
import { createCharacter, createStepResult, disposeCharacter, stepCharacter } from "../../../physics";
import type { Character, CharacterInput } from "../../../physics/types";
import { createSurfaceSampler } from "../../../physics/movement-modifiers";
import { fetchSurfaceModifiers } from "../../dressing/worker";
import type { ActorFrameContext } from "../types";
import { DEFAULT_COLLIDER } from "../spec";
import type { MotionOutput } from "../state/types";
import type { KinematicMoverOptions, KinematicMover } from "./types";
import { SURFACE_SAMPLE_INTERVAL } from "./constants";

/**
 * The body of a `body: "kinematic"` model actor. Synced (default): the SERVER
 * simulates it and this only PARKS the capsule at the published pose so the local
 * player collides with it. Local (`serverSynced={false}`): the machine's motion
 * output is resolved here through THE shared character resolver
 * (physics/index.ts — the player's and the server's code), or
 * integrated as a free 3-axis velocity for flyers.
 */

const _next = { x: 0, y: 0, z: 0 };
const _input: CharacterInput = { dirX: 0, dirZ: 0, speed: 0, jump: false, vyOverride: null, surface: null };

export const useKinematicMover = ({
  enabled,
  collider = DEFAULT_COLLIDER,
  movement,
  coordinates,
  positionRef,
  groupRef,
}: KinematicMoverOptions): KinematicMover => {
  const { world, rapier } = useRapier();
  const rigidBodyRef = useRef<RapierRigidBody | null>(null);
  const halfHeight = collider.height / 2;

  // Imperative, like the terrain heightfields and building proxies: r-t-r syncs every mounted
  // <RigidBody> back to an Object3D each frame, and nothing reads this one's (27 in the city).
  // The spawn point is the body's starting translation, as the <RigidBody position> was.
  const [spawnX, spawnY, spawnZ] = coordinates;
  useEffect(() => {
    if (!enabled) return;
    const body = world.createRigidBody(
      rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(spawnX, spawnY + halfHeight, spawnZ),
    );
    world.createCollider(rapier.ColliderDesc.capsule(halfHeight - collider.radius, collider.radius), body);
    rigidBodyRef.current = body;
    return () => {
      rigidBodyRef.current = null;
      world.removeRigidBody(body);
    };
  }, [world, rapier, enabled, halfHeight, collider.radius, spawnX, spawnY, spawnZ]);
  const characterRef = useRef<Character | null>(null);
  const result = useRef(createStepResult()).current;
  // Its ground's modifiers (snow), sampled off-thread like the Player's and every server NPC's.
  const surface = useRef(createSurfaceSampler(SURFACE_SAMPLE_INTERVAL, fetchSurfaceModifiers)).current;

  useEffect(() => {
    if (!enabled || movement !== "ground") return;
    const character = createCharacter(rapier, world, { height: collider.height, radius: collider.radius });
    characterRef.current = character;
    return () => {
      disposeCharacter(world, character);
      characterRef.current = null;
    };
  }, [world, rapier, enabled, movement, collider.height, collider.radius]);

  const step = (delta: number, ctx: ActorFrameContext, motion: MotionOutput, serverDriven: boolean): void => {
    const rb = rigidBodyRef.current;
    if (!enabled || !rb) return;

    if (serverDriven) {
      const t = ctx.sync?.target;
      if (!t || !t.valid) return;
      _next.x = t.x;
      _next.y = t.y + halfHeight;
      _next.z = t.z;
      rb.setNextKinematicTranslation(_next);
      positionRef.current.set(_next.x, _next.y, _next.z);
      return;
    }

    const dt = Math.min(delta, 0.1);
    const pos = rb.translation();
    if (movement === "free") {
      _next.x = pos.x + motion.vx * dt;
      _next.y = pos.y + (motion.vy ?? 0) * dt;
      _next.z = pos.z + motion.vz * dt;
      rb.setNextKinematicTranslation(_next);
    } else {
      const character = characterRef.current;
      const shape = rb.collider(0);
      if (!character || !shape) return;
      _input.dirX = motion.vx;
      _input.dirZ = motion.vz;
      _input.speed = Math.hypot(motion.vx, motion.vz);
      _input.vyOverride = motion.vy;
      surface.sample(pos.x, pos.z, pos.y - halfHeight);
      _input.surface = surface.modifiers;
      stepCharacter(world, character, rb, shape, pos.x, pos.y, pos.z, _input, dt, result);
    }
    // The body moves at the physics step, so `pos` is still current.
    positionRef.current.set(pos.x, pos.y, pos.z);
    groupRef.current?.position.set(pos.x, pos.y - halfHeight, pos.z);
  };

  return { step };
};
