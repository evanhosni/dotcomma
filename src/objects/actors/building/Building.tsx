import { RootState, useThree } from "@react-three/fiber";
import type Rapier from "@dimforge/rapier3d-compat";
import { CuboidCollider, RigidBody, TrimeshCollider, useRapier } from "@react-three/rapier";
import { Children, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { hideCursor, showCursor } from "../../../utils/cursor/cursor";
import { TaskQueue } from "../../../utils/task-queue/TaskQueue";
import { traceEvent, traceSpan } from "../../../utils/spikeTrace";
import { uploadOnFirstDraw } from "../../../utils/uploadOnFirstDraw";
import { meshTemplate, warmPrograms } from "../../../utils/warmPrograms";
import { framePhaseFromCoords } from "../../../utils/utils";
import { useFullSpeedSlope } from "../../../physics/useFullSpeedSlope";
import { useActorLifecycle, withinGate } from "../Actor";
import {
  beginBuildingInteriorBuild,
  beginProceduralBuildingBuild,
  peekBuildingInterior,
  peekProceduralBuildingAssets,
  ProceduralBuildingAssets,
  releaseProceduralBuildingAssets,
  retainProceduralBuildingAssets,
} from "./buildingAssets";
import { DEFAULT_EXTERIOR_MATERIAL, DEFAULT_INTERIOR_MATERIAL, DOOR_MATERIAL, updateWindowLightUniforms } from "./buildingMaterials";
import { addFarDoor, FarDoor, farDoorWarmTemplate, followFarDoorOrigin, removeFarDoor, setFarDoorAngle, setFarDoorFade } from "./farDoors";
import type { RampCollider } from "./interiorGeometry";
import { createProxyCollider, ProxyColliderHandle } from "./proxyCollider";
import { BUILDING_SPRITE_LOOK } from "./buildingSpriteLook";
import { BUILDING_HULL_KEYS, buildingSeedAt, DOOR_INTERACT_REACH } from "./spec";
import { BuildingAttributes, BuildingMaterials, BuildingProps } from "./types";

const COLLIDER_DISTANCE = 120;
const DISTANCE_CHECK_INTERVAL = 15; // frames
const BUILDING_DESPAWN_DISTANCE_FACTOR = 1.1;
/** Inside it the building's subtree is LIVE (matrices update, see the base's freezeMatrices): the real,
 *  clickable door leaves draw and the interior (once built) is shown. Beyond it the leaves are drawn by
 *  the one far-door InstancedMesh (farDoors.ts) and the interior is hidden — hidden, never discarded. */
const LIVE_DISTANCE = 150;
/** The first time the player comes this close, the interior mesh is built and mounted, and it (and
 *  its children) stay mounted until the building despawns. Well inside the collider range (120u), so
 *  only buildings the player actually walks up to pay for an interior. */
const INTERIOR_DISTANCE = 60;
const DOOR_RAYCAST_DISTANCE = 30; // building distance under which the door raycast runs
const DOOR_RAYCAST_INTERVAL_FRAMES = 3;
const DOOR_OPEN_ANGLE = -1.9; // rad — swings outward
const DOOR_SWING_RATE = 4;

const DISTANCE_GATE_HYSTERESIS = 12;

const buildQueue = new TaskQueue();

/** Queues build phases one task at a time, each queuing the next, so the queue can yield between them
 *  (as one monolithic task a heavy skyscraper was a single long frame) and the building nearest the
 *  player finishes first. Returns the cancel. */
const queueBuildPhases = (steps: Array<() => void>, at: { x: number; z: number }): (() => void) => {
  let cancelled = false;
  let taskId: string | null = null;
  const queueStep = (i: number) => {
    taskId = buildQueue.addTask(
      async () => {
        taskId = null;
        if (cancelled) return;
        steps[i]();
        if (i + 1 < steps.length) queueStep(i + 1);
      },
      { at },
    );
  };
  queueStep(0);
  return () => {
    cancelled = true;
    if (taskId !== null) buildQueue.removeTask(taskId);
  };
};

const uploadMeshesOnFirstDraw = (root: THREE.Object3D | null): void =>
  root?.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) uploadOnFirstDraw(o);
  });

// The FIRST building each frame writes the shared window-light uniforms and moves the far-door origin.
let sharedStateTime = -1;
const driveSharedBuildingState = (state: RootState): void => {
  const time = state.clock.elapsedTime;
  if (time === sharedStateTime) return;
  sharedStateTime = time;
  updateWindowLightUniforms();
  followFarDoorOrigin(state.camera.position.x, state.camera.position.z);
};

const _raycaster = new THREE.Raycaster();
const _center = new THREE.Vector2(0, 0);
const _sphere = new THREE.Sphere();
const _hits: THREE.Intersection[] = [];

/** The door leaf under the screen-center ray within DOOR_INTERACT_REACH, or −1. */
const raycastHoveredDoor = (camera: THREE.Camera, doorMeshes: (THREE.Mesh | null)[]): number => {
  let hover = -1;
  _raycaster.setFromCamera(_center, camera);
  _raycaster.far = DOOR_INTERACT_REACH;
  for (let i = 0; i < doorMeshes.length; i++) {
    const mesh = doorMeshes[i];
    if (!mesh) continue;
    const geo = mesh.geometry;
    if (geo.boundingSphere === null) geo.computeBoundingSphere();
    _sphere.copy(geo.boundingSphere!).applyMatrix4(mesh.matrixWorld);
    if (!_raycaster.ray.intersectsSphere(_sphere)) continue;
    _hits.length = 0;
    if (_raycaster.intersectObject(mesh, false, _hits).length > 0) {
      hover = i;
      break;
    }
  }
  _raycaster.far = Infinity;
  return hover;
};

/** Eases every hinge toward its open/closed angle, mirrored onto its far-door instance. Returns
 *  whether any is still moving. */
const swingDoors = (
  hinges: (THREE.Group | null)[],
  doorsOpen: boolean[],
  farDoors: FarDoor[] | null,
  delta: number,
): boolean => {
  let stillMoving = false;
  for (let i = 0; i < hinges.length; i++) {
    const hinge = hinges[i];
    if (!hinge) continue;
    const target = doorsOpen[i] ? DOOR_OPEN_ANGLE : 0;
    const diff = target - hinge.rotation.y;
    if (Math.abs(diff) < 1e-3) {
      if (diff !== 0) hinge.rotation.y = target;
    } else {
      hinge.rotation.y += diff * Math.min(1, delta * DOOR_SWING_RATE);
      stillMoving = true;
    }
    const far = farDoors?.[i];
    if (far) setFarDoorAngle(far, hinge.rotation.y);
  }
  return stillMoving;
};

/** This building's doors as far-door instances (farDoors.ts), at their current swing. */
const addFarDoorsOf = (
  scene: THREE.Scene,
  assets: ProceduralBuildingAssets,
  coordinates: THREE.Vector3Tuple,
  hinges: (THREE.Group | null)[],
  doorsOpen: boolean[],
  fade: number,
): FarDoor[] =>
  assets.doors.map((d, i) =>
    addFarDoor(
      scene,
      {
        x: coordinates[0] + d.position[0],
        y: coordinates[1] + d.position[1],
        z: coordinates[2] + d.position[2],
        yaw: d.yaw,
        width: d.width,
        leafCenter: assets.doorLeaf.center,
        leafSize: assets.doorLeaf.size,
        color: assets.doorLeaf.color,
      },
      hinges[i]?.rotation.y ?? (doorsOpen[i] ? DOOR_OPEN_ANGLE : 0),
      fade,
    ),
  );

export const Building = (props: BuildingProps) => {
  const {
    id,
    descriptorId,
    serverSynced,
    coordinates,
    seed,
    materials,
    renderDistance,
    colliderDistance = COLLIDER_DISTANCE,
    despawnDistance,
    spriteHandoffDistance,
    onDestroy,
    children,
  } = props;
  const resolvedSeed = seed !== undefined ? String(seed) : buildingSeedAt(coordinates[0], coordinates[2]);
  const { world, rapier } = useRapier();

  // Every generation attribute (BUILDING_HULL_KEYS — a new knob is picked up here automatically), keyed
  // by its JSON so inline array props don't rebuild assets on parent renders; memoized because every
  // door-click re-render would pay the stringify (the deps ARE the hull values, one per key).
  const hullValues = BUILDING_HULL_KEYS.map((key) => props[key]);
  const { opts: buildOptions, key: optionsKey } = useMemo(() => {
    const opts: Record<string, unknown> = {};
    BUILDING_HULL_KEYS.forEach((key, i) => (opts[key] = hullValues[i]));
    return { opts: opts as BuildingAttributes, key: JSON.stringify(opts) };
  }, hullValues);
  const [assets, setAssets] = useState<ProceduralBuildingAssets | null>(() =>
    peekProceduralBuildingAssets(resolvedSeed, optionsKey),
  );
  useEffect(() => {
    if (assets) return;
    const build = beginProceduralBuildingBuild(resolvedSeed, buildOptions, optionsKey);
    return queueBuildPhases(
      [
        ...build.steps.map((step, phase) => () => traceSpan(`building:phase${phase}`, step)),
        () => setAssets(traceSpan("building:finish", build.finish)),
      ],
      { x: coordinates[0], z: coordinates[2] },
    );
  }, [resolvedSeed, optionsKey]); // assets deliberately omitted: guard exits once built

  // Passing `assets` lets the cache re-register an entry a concurrent
  // unmount's release trimmed in the render→effect window.
  useEffect(() => {
    if (!assets) return;
    retainProceduralBuildingAssets(resolvedSeed, optionsKey, assets);
    return () => releaseProceduralBuildingAssets(resolvedSeed, optionsKey);
  }, [assets, resolvedSeed, optionsKey]);

  useEffect(() => {
    if (assets) uploadMeshesOnFirstDraw(groupRef.current);
  }, [assets]);

  // State drives the collider mount; the swing loop reads the REF: the next
  // useFrame can run before React re-renders, and a loop reading the stale
  // closure saw every door settled and slept through the click.
  const [doorsOpen, setDoorsOpen] = useState<boolean[]>([]);
  const proxyRef = useRef<ProxyColliderHandle | null>(null);
  const doorsOpenRef = useRef<boolean[]>([]);
  const doorMeshRefs = useRef<(THREE.Mesh | null)[]>([]);
  const hingeRefs = useRef<(THREE.Group | null)[]>([]);
  const hoverDoorRef = useRef(-1);
  const doorsMovingRef = useRef(false);

  const doorsGroupRef = useRef<THREE.Group>(null);
  const liveRef = useRef(false);
  const farDoorsRef = useRef<FarDoor[] | null>(null);

  // The interior is a one-way latch per life: built on the first close approach, then kept (and
  // with it any state its children hold) until the building unmounts, whatever the distance.
  const [interiorWanted, setInteriorWanted] = useState(false);
  const interiorWantedRef = useRef(false);
  const [interior, setInterior] = useState<THREE.BufferGeometry | null>(null);
  const interiorGroupRef = useRef<THREE.Group>(null);
  const doorRaycastFrameRef = useRef(framePhaseFromCoords(coordinates[0], coordinates[2], DOOR_RAYCAST_INTERVAL_FRAMES));

  // Doors are SERVER-owned replicated state { doors: boolean[] }: a click
  // sends "door:<i>", the server toggles + broadcasts, every client applies.
  const { groupRef, collidersActive, sync } = useActorLifecycle({
    id,
    descriptorId,
    serverSynced,
    coordinates,
    renderDistance,
    despawnDistance: despawnDistance ?? renderDistance * BUILDING_DESPAWN_DISTANCE_FACTOR,
    spriteHandoffDistance,
    onDestroy,
    checkInterval: DISTANCE_CHECK_INTERVAL,
    colliderDistance,
    gateHysteresis: DISTANCE_GATE_HYSTERESIS,
    // Activation mounts two Rapier trimeshes (several ms each).
    throttleColliderActivation: true,
    nearDistance: LIVE_DISTANCE,
    freezeMatrices: true,
    onFrame: (state, delta, ctx) => {
      driveSharedBuildingState(state);

      // Same test as the base's near gate (same distance, same frames), so "live" is exactly
      // "matrices unfrozen" and a real leaf never swings under a frozen matrix.
      if (ctx.gatesChecked) {
        const live = withinGate(ctx.distanceSq, LIVE_DISTANCE, liveRef.current, DISTANCE_GATE_HYSTERESIS);
        liveRef.current = live;
        // The interior is fully occluded by the shell from outside.
        if (interiorGroupRef.current) interiorGroupRef.current.visible = live;
        if (doorsGroupRef.current) doorsGroupRef.current.visible = live;
        if (live && farDoorsRef.current) {
          farDoorsRef.current.forEach(removeFarDoor);
          farDoorsRef.current = null;
        } else if (!live && !farDoorsRef.current && assets) {
          farDoorsRef.current = addFarDoorsOf(state.scene, assets, coordinates, hingeRefs.current, doorsOpenRef.current, ctx.spawnFade);
        }
        if (!interiorWantedRef.current && ctx.distanceSq < INTERIOR_DISTANCE * INTERIOR_DISTANCE) {
          interiorWantedRef.current = true;
          setInteriorWanted(true);
        }
      }

      // The far leaves live in one shared mesh, outside this group: they fade with it per instance.
      const farDoors = farDoorsRef.current;
      if (farDoors && farDoors.length > 0 && farDoors[0].fade !== ctx.spawnFade) {
        for (const far of farDoors) setFarDoorFade(far, ctx.spawnFade);
      }

      if (doorRaycastFrameRef.current++ % DOOR_RAYCAST_INTERVAL_FRAMES === 0) {
        const hover =
          ctx.distanceSq < DOOR_RAYCAST_DISTANCE * DOOR_RAYCAST_DISTANCE ? raycastHoveredDoor(state.camera, doorMeshRefs.current) : -1;
        if (hover !== hoverDoorRef.current) {
          if (hover >= 0 && hoverDoorRef.current < 0) showCursor();
          if (hover < 0 && hoverDoorRef.current >= 0) hideCursor();
          hoverDoorRef.current = hover;
        }
      }

      // Skipped once settled: the asymptotic lerp otherwise writes rotation.y
      // (Euler→quaternion trig) on every door of every building forever.
      if (doorsMovingRef.current) {
        doorsMovingRef.current = swingDoors(hingeRefs.current, doorsOpenRef.current, farDoorsRef.current, delta);
      }
    },
  });

  useEffect(() => {
    if (!interiorWanted || !assets) return;
    const cached = peekBuildingInterior(resolvedSeed, optionsKey);
    if (cached) {
      setInterior(cached);
      return;
    }
    const build = beginBuildingInteriorBuild(resolvedSeed, optionsKey, assets.plan);
    return queueBuildPhases(
      [
        ...build.steps.map((step, phase) => () => traceSpan(`building:interior${phase}`, step)),
        () => setInterior(traceSpan("building:interior-merge", build.finish)),
      ],
      { x: coordinates[0], z: coordinates[2] },
    );
  }, [interiorWanted, assets, resolvedSeed, optionsKey]);

  useEffect(() => {
    if (interior) uploadMeshesOnFirstDraw(interiorGroupRef.current);
  }, [interior]);

  useEffect(
    () => () => {
      farDoorsRef.current?.forEach(removeFarDoor);
      farDoorsRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (collidersActive) traceEvent("building:colliders-on");
  }, [collidersActive]);

  // The sealed hull exists exactly when the real colliders don't (collider LOD,
  // see proxyCollider.ts), so a building is never passable.
  useEffect(() => {
    if (!assets || collidersActive) return;
    const handle = createProxyCollider({ world, rapier }, coordinates, assets.proxyHullVertices);
    proxyRef.current = handle;
    return () => {
      proxyRef.current = null;
      handle.dispose();
    };
  }, [assets, collidersActive, world, rapier]);

  const setDoorOpen = useCallback((idx: number, open: boolean) => {
    if (doorsOpenRef.current[idx] === open) return;
    // Ref first: the swing loop may run before the state lands.
    doorsOpenRef.current[idx] = open;
    doorsMovingRef.current = true;
    setDoorsOpen((prev) => {
      const next = [...prev];
      next[idx] = open;
      return next;
    });
  }, []);

  useEffect(() => {
    if (!sync) return;
    const apply = () => {
      const doors = sync.state?.doors;
      if (Array.isArray(doors)) doors.forEach((o, i) => setDoorOpen(i, !!o));
    };
    apply();
    return sync.subscribe(apply);
  }, [sync, setDoorOpen]);

  // Local toggle is prediction; the server's broadcast confirms for everyone.
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const idx = hoverDoorRef.current;
      if (idx < 0) return;
      setDoorOpen(idx, !doorsOpenRef.current[idx]);
      sync?.interact(`door:${idx}`);
    };
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, [sync, setDoorOpen]);

  useEffect(() => {
    return () => {
      if (hoverDoorRef.current >= 0) hideCursor();
    };
  }, []);

  if (!assets) return null;

  const childArray = Children.toArray(children);
  const slots = assets.plan.interior.childSlots;

  return (
    <group ref={groupRef} position={coordinates}>
      <mesh geometry={assets.exteriorGeometry} material={materials?.exterior ?? DEFAULT_EXTERIOR_MATERIAL} />

      {/* Built on the first approach within INTERIOR_DISTANCE and kept until unmount; shown
          inside LIVE_DISTANCE (a ref write in onFrame). */}
      {interior && (
        <group ref={interiorGroupRef}>
          <mesh geometry={interior} material={materials?.interior ?? DEFAULT_INTERIOR_MATERIAL} />
          {/* Seeded room slots. */}
          {childArray.map((child, i) => {
            const slot = slots[i % slots.length];
            return (
              <group key={i} position={slot.position} rotation={[0, slot.rotationY, 0]}>
                {child}
              </group>
            );
          })}
        </group>
      )}

      {/* The real hinged leaves, inside LIVE_DISTANCE; farDoors.ts draws them beyond it. */}
      <group ref={doorsGroupRef}>
        {assets.doors.map((d, i) => (
          <group key={`door-${i}`} position={d.position} rotation={[0, d.yaw, 0]}>
            <group ref={(el) => (hingeRefs.current[i] = el)} position={[-d.width / 2, 0, 0]}>
              <mesh
                ref={(el) => (doorMeshRefs.current[i] = el)}
                geometry={assets.doorGeometry}
                material={DOOR_MATERIAL}
              />
            </group>
          </group>
        ))}
      </group>

      {/* Shell trimesh (door openings walkable), walls, slabs, ramps, closed leaves. */}
      {collidersActive && (
        <RigidBody type="fixed" colliders={false}>
          <TrimeshCollider args={[assets.exteriorVertices, assets.exteriorIndices]} />
          <TrimeshCollider args={[assets.interiorSlabVertices, assets.interiorSlabIndices]} />
          {assets.interiorColliders.map((b, i) => (
            <CuboidCollider
              key={i}
              args={[b.sx / 2, b.sy / 2, b.sz / 2]}
              position={[b.cx, b.cy, b.cz]}
              rotation={[0, b.rotY ?? 0, 0]}
            />
          ))}
          {assets.rampColliders.map((r, i) => (
            <RampCuboid key={`ramp-${i}`} ramp={r} />
          ))}
          {assets.doors.map(
            (d, i) =>
              !doorsOpen[i] && (
                <CuboidCollider
                  key={`doorcol-${i}`}
                  args={[d.width / 2, d.height / 2, 0.06]}
                  position={d.position}
                  rotation={[0, d.yaw, 0]}
                />
              ),
          )}
        </RigidBody>
      )}
    </group>
  );
};

/** Load-time program warm-up (utils/warmPrograms.ts): the shell, door and interior materials the
 *  descriptor resolves, and the shared far-door mesh. */
const BuildingWarmup = ({ descriptor }: { descriptor: { materials?: BuildingMaterials } }) => {
  const scene = useThree((state) => state.scene);
  const exterior = descriptor.materials?.exterior ?? DEFAULT_EXTERIOR_MATERIAL;
  const interior = descriptor.materials?.interior ?? DEFAULT_INTERIOR_MATERIAL;
  useEffect(
    () => warmPrograms(scene, [meshTemplate(exterior), meshTemplate(DOOR_MATERIAL), meshTemplate(interior), farDoorWarmTemplate()]),
    [scene, exterior, interior],
  );
  return null;
};
Building.Warmup = BuildingWarmup;
Building.spriteLook = BUILDING_SPRITE_LOOK;
Building.warmupKey = (descriptor: { materials?: BuildingMaterials }) =>
  `${descriptor.materials?.exterior?.uuid ?? "default"}|${descriptor.materials?.interior?.uuid ?? "default"}`;

/** A ramp's collider: walked at full speed (a ramp is ≈38°, which the terrain-tuned uphill fade would crawl up). */
const RampCuboid = ({ ramp }: { ramp: RampCollider }) => {
  const ref = useRef<Rapier.Collider>(null);
  useFullSpeedSlope(ref);
  return <CuboidCollider ref={ref} args={ramp.halfExtents} position={ramp.position} rotation={ramp.rotation} />;
};
