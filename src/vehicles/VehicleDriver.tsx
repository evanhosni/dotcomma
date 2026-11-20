import type Rapier from "@dimforge/rapier3d-compat";
import { useFrame, useThree } from "@react-three/fiber";
import { useBeforePhysicsStep, useRapier } from "@react-three/rapier";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { getVertexSample } from "../world/terrain/utils";
import { getActiveDomainConfig, isDomainCommitted } from "../world/domains/store";
import { PARKED_VEHICLE_INPUT, stepVehicle } from "../physics/vehicle";
import type { VehicleInput } from "../physics/vehicle/types";
import { getSeatedVehicle, leaveVehicle, liveVehicles, onSeatChange } from "./store";
import { useChaseCamera, useDriveInput } from "./hooks";
import type { ChaseCamera, DriveInput, LiveVehicle } from "./types";
import { bodyQuaternion, headingOf, seatPositionOf } from "./utils";
import {
  CHASE_CLEARANCE,
  CHASE_DISTANCE,
  CHASE_DISTANCE_PER_SPEED,
  CHASE_DISTANCE_RATE,
  CHASE_FOLLOW_RATE,
  CHASE_PITCH,
  CHASE_TARGET_HEIGHT,
  EXIT_HEIGHT,
  EXIT_ROOF_HEIGHT,
  EXIT_SIDE,
  GROUND_SAMPLE_INTERVAL,
  ORBIT_RETURN_DELAY,
  ORBIT_RETURN_RATE,
  SINK_LIFT,
  SINK_TOLERANCE,
} from "./constants";

const _q = new THREE.Quaternion();
const _seat = new THREE.Vector3();
const _target = new THREE.Vector3();
const _boom = new THREE.Vector3();

const _solid = (c: Rapier.Collider): boolean => !c.isSensor();

const readInput = (keys: DriveInput, out: VehicleInput): VehicleInput => {
  out.throttle = (keys.forward ? 1 : 0) - (keys.backward ? 1 : 0);
  out.steer = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  out.handbrake = keys.handbrake;
  return out;
};

/** Where the player gets out: the left side, else the right, else the roof. */
const exitPointOf = (world: Rapier.World, ray: Rapier.Ray, car: LiveVehicle): { x: number; y: number; z: number } => {
  const { body } = car.vehicle;
  const seat = seatPositionOf(car, _seat);
  bodyQuaternion(body, _q);
  for (const side of [1, -1]) {
    // Body +x is the car's left (+z forward, y up).
    const dir = _boom.set(side, 0, 0).applyQuaternion(_q);
    dir.y = 0;
    dir.normalize();
    ray.origin = { x: seat.x, y: seat.y, z: seat.z };
    ray.dir = { x: dir.x, y: 0, z: dir.z };
    if (world.castRay(ray, EXIT_SIDE + 0.6, true, undefined, undefined, undefined, body, _solid)) continue;
    return { x: seat.x + dir.x * EXIT_SIDE, y: body.translation().y + EXIT_HEIGHT, z: seat.z + dir.z * EXIT_SIDE };
  }
  return { x: seat.x, y: body.translation().y + EXIT_ROOF_HEIGHT, z: seat.z };
};

/** Eases an angle toward another the short way round. */
const easeAngle = (from: number, to: number, k: number): number => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * k;

/** GTA's chase camera: trails the car's heading, orbited by the mouse, pulled in by whatever it would clip. */
const placeChaseCamera = (camera: THREE.Camera, world: Rapier.World, ray: Rapier.Ray, car: LiveVehicle, chase: ChaseCamera, dt: number): void => {
  const { body } = car.vehicle;
  const t = body.translation();
  const lv = body.linvel();
  const heading = headingOf(body);
  const speed = Math.hypot(lv.x, lv.z);
  const wantDistance = CHASE_DISTANCE + speed * CHASE_DISTANCE_PER_SPEED;
  if (!chase.placed) {
    chase.placed = true;
    chase.yaw = heading;
    chase.orbitYaw = 0;
    chase.orbitPitch = 0;
    chase.distance = wantDistance;
  }
  chase.yaw = easeAngle(chase.yaw, heading, 1 - Math.exp(-CHASE_FOLLOW_RATE * dt));
  chase.distance += (wantDistance - chase.distance) * (1 - Math.exp(-CHASE_DISTANCE_RATE * dt));
  if (performance.now() - chase.lastMouse > ORBIT_RETURN_DELAY * 1000) {
    const k = Math.exp(-ORBIT_RETURN_RATE * dt);
    chase.orbitYaw = Math.atan2(Math.sin(chase.orbitYaw), Math.cos(chase.orbitYaw)) * k;
    chase.orbitPitch *= k;
  }

  const yaw = chase.yaw + chase.orbitYaw + Math.PI;
  const pitch = CHASE_PITCH + chase.orbitPitch;
  _target.set(t.x, t.y + CHASE_TARGET_HEIGHT, t.z);
  _boom.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  ray.origin = { x: _target.x, y: _target.y, z: _target.z };
  ray.dir = { x: _boom.x, y: _boom.y, z: _boom.z };
  const hit = world.castRay(ray, chase.distance, true, undefined, undefined, undefined, body, _solid);
  const distance = hit ? Math.max(0.5, hit.timeOfImpact - CHASE_CLEARANCE) : chase.distance;
  camera.position.copy(_target).addScaledVector(_boom, distance);
  camera.lookAt(_target);
};

/**
 * THE ONE VEHICLE DRIVER (mounted once, beside the Player): steps every awake car before the physics
 * step — the seated one on the keys, the rest on their parking brake — and, while the player is in a
 * car, runs its chase camera, its ground sampling and the exit key.
 */
export const VehicleDriver = () => {
  const { world, rapier } = useRapier();
  const camera = useThree((s) => s.camera);
  const keys = useDriveInput();
  const chase = useChaseCamera();
  const input = useRef<VehicleInput>({ throttle: 0, steer: 0, handbrake: false }).current;
  const ray = useRef(new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })).current;
  const frameDt = useRef(1 / 60);
  const ground = useRef({ frame: 0, inFlight: false }).current;

  useEffect(
    () =>
      onSeatChange(() => {
        chase.placed = false;
        keys.current.exitPressed = false;
      }),
    [chase, keys],
  );

  // Before the physics step (priority 0): the step's length is this frame's delta.
  useFrame((_, delta) => {
    frameDt.current = delta;
  }, -2);

  useBeforePhysicsStep((stepWorld) => {
    const seated = getSeatedVehicle();
    const driving = readInput(keys.current, input);
    for (const car of liveVehicles()) stepVehicle(stepWorld as unknown as Rapier.World, car.vehicle, car === seated ? driving : PARKED_VEHICLE_INPUT, frameDt.current);
  });

  /** The driven car's ground, sampled on the dressing worker: road or not, and a backstop under it. */
  const sampleGround = (car: LiveVehicle): void => {
    if (ground.inFlight || ground.frame++ % GROUND_SAMPLE_INTERVAL !== 0 || !isDomainCommitted()) return;
    ground.inFlight = true;
    const at = car.vehicle.body.translation();
    getVertexSample(at.x, at.z)
      .then((sample) => {
        if (!sample || getSeatedVehicle() !== car) return;
        car.vehicle.state.onRoad = sample.distanceToRoadCenter < getActiveDomainConfig().cityConfig.roadWidth;
        const now = car.vehicle.body.translation();
        if (now.y < sample.height - SINK_TOLERANCE) {
          car.vehicle.body.setTranslation({ x: now.x, y: sample.height + SINK_LIFT, z: now.z }, true);
          car.vehicle.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        }
      })
      .finally(() => {
        ground.inFlight = false;
      });
  };

  // After the physics step, before the render (priority 2).
  useFrame((_, delta) => {
    const car = getSeatedVehicle();
    if (!car) return;
    const physicsWorld = world as unknown as Rapier.World;
    if (keys.current.exitPressed) {
      keys.current.exitPressed = false;
      leaveVehicle(exitPointOf(physicsWorld, ray, car));
      return;
    }
    sampleGround(car);
    placeChaseCamera(camera, physicsWorld, ray, car, chase, Math.min(delta, 0.1));
  }, 1);

  return null;
};
