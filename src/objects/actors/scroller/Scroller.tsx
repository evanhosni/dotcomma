import type Rapier from "@dimforge/rapier3d-compat";
import { useThree } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { createVehicle } from "../../../physics/vehicle";
import { claimHover, releaseHover } from "../../../utils/cursor";
import type { HoverTarget } from "../../../utils/cursor/types";
import { meshTemplate, warmPrograms } from "../../../utils/render";
import { uploadOnFirstDraw } from "../../../utils/render/utils";
import { framePhaseFromCoords } from "../../../utils/utils";
import { enterVehicle, getSeatedVehicle, registerVehicle, unregisterVehicle } from "../../../vehicles/store";
import type { LiveVehicle } from "../../../vehicles/types";
import { getVertexSample } from "../../../world/terrain/utils";
import { useActorLifecycle } from "../hooks";
import { DEFAULT_INTERACT_REACH } from "../spec";
import type { ActorProps } from "../spawning/types";
import type { ActorAttributes } from "../../types";
import { BODY_DISTANCE, BODY_DISTANCE_HYSTERESIS, HEADING_PROBE, HOVER_INTERVAL_FRAMES, SCROLLER_COLORS } from "./constants";
import { SCROLLER_BOUNDS, SCROLLER_BOUNDS_RADIUS, SCROLLER_FRONT_WHEEL_GEOMETRY, SCROLLER_REAR_WHEEL_GEOMETRY, SCROLLER_SHELL_GEOMETRY } from "./geometry";
import { SCROLLER_PAINTS, SCROLLER_WHEEL_MATERIAL } from "./material";
import { SCROLLER_CENTER_OF_MASS, SCROLLER_HULL, SCROLLER_INERTIA, SCROLLER_MASS, SCROLLER_SEAT, SCROLLER_SHAPE } from "./spec";
import { rollScroller } from "./utils";

type ScrollerProps = ActorProps<ActorAttributes> & { interactReach?: number };

interface Pose {
  t: Rapier.Vector;
  r: Rapier.Rotation;
}

/** Wheels are animated only this close (camera distance). */
const WHEEL_ANIMATION_DISTANCE = 90;
/** A spawn point sits on the padded ground; the body starts this much above it, then settles. */
const SPAWN_CLEARANCE = 0.05;

const HULL_POINTS = new Float32Array(SCROLLER_HULL.flat());

const _ray = new THREE.Raycaster();
const _center = new THREE.Vector2(0, 0);
const _inverse = new THREE.Matrix4();
const _localRay = new THREE.Ray();
const _hit = new THREE.Vector3();

/** The street's heading at (x, z): the road field rises toward the curb, so the lane runs across its
 *  slope, with the curb on the car's right (right-hand traffic). Falls back to the seeded yaw. */
const resolveHeading = async (x: number, z: number, fallback: number): Promise<number> => {
  const [east, west, south, north] = await Promise.all([
    getVertexSample(x + HEADING_PROBE, z),
    getVertexSample(x - HEADING_PROBE, z),
    getVertexSample(x, z + HEADING_PROBE),
    getVertexSample(x, z - HEADING_PROBE),
  ]);
  if (!east || !west || !south || !north) return fallback;
  const gx = east.distanceToRoadCenter - west.distanceToRoadCenter;
  const gz = south.distanceToRoadCenter - north.distanceToRoadCenter;
  if (Math.hypot(gx, gz) < 1e-6) return fallback;
  // The heading (gz, −gx): its right-hand side, heading × up, is the gradient — toward the curb.
  return Math.atan2(gz, -gx);
};

const yawQuaternion = (yaw: number): Rapier.Rotation => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });

/** Builds the car's dynamic body, asleep at `pose` until something touches it. */
const createBody = (world: Rapier.World, rapier: typeof import("@dimforge/rapier3d-compat"), pose: Pose): Rapier.RigidBody => {
  const body = world.createRigidBody(
    rapier.RigidBodyDesc.dynamic()
      .setTranslation(pose.t.x, pose.t.y, pose.t.z)
      .setRotation(pose.r)
      .setCcdEnabled(true)
      .setAngularDamping(0.6)
      .setLinearDamping(0.02)
      .setCanSleep(true)
      .setSleeping(true),
  );
  const hull = rapier.ColliderDesc.convexHull(HULL_POINTS)!;
  hull
    .setMassProperties(SCROLLER_MASS, SCROLLER_CENTER_OF_MASS, SCROLLER_INERTIA, { x: 0, y: 0, z: 0, w: 1 })
    .setFriction(0.3)
    .setRestitution(0.1);
  world.createCollider(hull, body);
  return body;
};

/** The screen-center ray's distance to the car's box, or Infinity past `reach`. */
const hoverDistance = (camera: THREE.Camera, group: THREE.Group, reach: number): number => {
  _ray.setFromCamera(_center, camera);
  _inverse.copy(group.matrixWorld).invert();
  _localRay.copy(_ray.ray).applyMatrix4(_inverse);
  if (!_localRay.intersectBox(SCROLLER_BOUNDS, _hit)) return Infinity;
  const distance = _hit.applyMatrix4(group.matrixWorld).distanceTo(_ray.ray.origin);
  return distance <= reach ? distance : Infinity;
};

/** A SCROLLER (spec.ts): parked at the curb, asleep, until the player clicks it to drive or bumps it.
 *  Its body exists only near the camera; a car driven elsewhere and left there stays where it was left
 *  for as long as it lives. */
export const Scroller = (props: ScrollerProps) => {
  const { id, descriptorId, coordinates, renderDistance, despawnDistance, frustumPadding, onDestroy, interactReach = DEFAULT_INTERACT_REACH } = props;
  const { world, rapier } = useRapier();
  const { stats, colorIndex } = useMemo(() => rollScroller(id), [id]);
  const positionRef = useRef(new THREE.Vector3(...coordinates));
  const [parked, setParked] = useState<Pose | null>(null);
  /** The live pose survives the body (a car left elsewhere is rebuilt there). */
  const poseRef = useRef<Pose | null>(null);
  const carRef = useRef<LiveVehicle | null>(null);
  const wheelRefs = useRef<(THREE.Group | null)[]>([]);
  const hoverFrame = useRef(framePhaseFromCoords(coordinates[0], coordinates[2], HOVER_INTERVAL_FRAMES));
  const hovering = useRef(false);
  const hoverTarget = useMemo<HoverTarget>(
    () => ({
      distance: Infinity,
      growsCursor: true,
      onMouse: (e) => {
        if (e.type === "click" && e.button === 0 && carRef.current) enterVehicle(carRef.current);
      },
    }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const [x, y, z] = coordinates;
    resolveHeading(x, z, Math.abs(x * 7.13 + z * 3.71) % (Math.PI * 2)).then((yaw) => {
      if (cancelled) return;
      const pose = { t: { x, y: y + SPAWN_CLEARANCE, z }, r: yawQuaternion(yaw) };
      poseRef.current = pose;
      setParked(pose);
    });
    return () => {
      cancelled = true;
    };
  }, [coordinates[0], coordinates[1], coordinates[2]]);

  const setHover = (on: boolean): void => {
    if (on === hovering.current) return;
    hovering.current = on;
    if (on) claimHover(hoverTarget);
    else releaseHover(hoverTarget);
  };
  useEffect(() => () => releaseHover(hoverTarget), [hoverTarget]);

  const drawWheels = (car: LiveVehicle): void => {
    const { wheels } = car.vehicle.shape;
    const states = car.vehicle.state.wheels;
    for (let i = 0; i < wheels.length; i++) {
      const g = wheelRefs.current[i];
      if (!g) continue;
      const w = wheels[i];
      g.position.y = w.y - states[i].suspension;
      g.rotation.set(states[i].spin, w.steers ? -car.vehicle.state.steer : 0, 0, "YXZ");
    }
  };

  const { groupRef, collidersActive } = useActorLifecycle({
    id,
    descriptorId,
    serverSynced: false,
    coordinates,
    positionRef,
    renderDistance,
    despawnDistance,
    onDestroy,
    boundsRadius: SCROLLER_BOUNDS_RADIUS,
    frustumPadding,
    colliderDistance: BODY_DISTANCE,
    gateHysteresis: BODY_DISTANCE_HYSTERESIS,
    onFrame: (state, _delta, ctx) => {
      const group = groupRef.current;
      const car = carRef.current;
      if (!group) return;
      if (car && !car.vehicle.body.isSleeping()) {
        const t = car.vehicle.body.translation();
        const r = car.vehicle.body.rotation();
        group.position.set(t.x, t.y, t.z);
        group.quaternion.set(r.x, r.y, r.z, r.w);
        positionRef.current.set(t.x, t.y, t.z);
        if (ctx.visible && ctx.distanceSq < WHEEL_ANIMATION_DISTANCE * WHEEL_ANIMATION_DISTANCE) drawWheels(car);
      }

      if (hoverFrame.current++ % HOVER_INTERVAL_FRAMES !== 0) return;
      const near = !!car && !getSeatedVehicle() && ctx.distanceSq < (interactReach + SCROLLER_BOUNDS_RADIUS) ** 2;
      hoverTarget.distance = near ? hoverDistance(state.camera, group, interactReach) : Infinity;
      setHover(hoverTarget.distance < Infinity);
    },
  });

  // The body: built inside BODY_DISTANCE, asleep where the car was last; removed beyond it with its pose kept.
  useEffect(() => {
    if (!collidersActive || !parked) return;
    const physicsWorld = world as unknown as Rapier.World;
    const body = createBody(physicsWorld, rapier as unknown as typeof import("@dimforge/rapier3d-compat"), poseRef.current ?? parked);
    const car: LiveVehicle = {
      id,
      name: "Scroller",
      color: SCROLLER_COLORS[colorIndex],
      vehicle: createVehicle(rapier, body, SCROLLER_SHAPE, stats),
      seat: SCROLLER_SEAT,
    };
    carRef.current = car;
    registerVehicle(car);
    return () => {
      poseRef.current = { t: body.translation(), r: body.rotation() };
      unregisterVehicle(car);
      carRef.current = null;
      setHover(false);
      physicsWorld.removeRigidBody(body);
    };
  }, [collidersActive, parked, world, rapier, id, colorIndex, stats]);

  useEffect(() => {
    groupRef.current?.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) uploadOnFirstDraw(o);
    });
  }, [parked, groupRef]);

  if (!parked) return null;
  const { t, r } = parked;
  return (
    <group
      ref={groupRef}
      position={[t.x, t.y, t.z]}
      quaternion={[r.x, r.y, r.z, r.w]}
    >
      <mesh geometry={SCROLLER_SHELL_GEOMETRY} material={SCROLLER_PAINTS[colorIndex]} />
      {SCROLLER_SHAPE.wheels.map((w, i) => (
        <group
          key={i}
          ref={(g) => {
            wheelRefs.current[i] = g;
          }}
          position={[w.x, w.radius, w.z]}
        >
          <mesh geometry={w.rear ? SCROLLER_REAR_WHEEL_GEOMETRY : SCROLLER_FRONT_WHEEL_GEOMETRY} material={SCROLLER_WHEEL_MATERIAL} />
        </group>
      ))}
    </group>
  );
};

const ScrollerWarmup = () => {
  const scene = useThree((state) => state.scene);
  useEffect(() => warmPrograms(scene, [meshTemplate(SCROLLER_PAINTS[0]), meshTemplate(SCROLLER_WHEEL_MATERIAL)]), [scene]);
  return null;
};
Scroller.Warmup = ScrollerWarmup;
Scroller.warmupKey = () => "scroller";
