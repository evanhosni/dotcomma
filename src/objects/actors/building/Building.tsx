import { CuboidCollider, RigidBody, TrimeshCollider, useRapier } from "@react-three/rapier";
import { Children, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { getNightIndex, getWindowLightsProgress } from "../../../lighting/dayNight";
import { hideCursor, showCursor } from "../../../utils/cursor/cursor";
import { TaskQueue } from "../../../utils/task-queue/TaskQueue";
import { traceEvent, traceSpan } from "../../../utils/spikeTrace";
import { uploadOnFirstDraw } from "../../../utils/uploadOnFirstDraw";
import { framePhaseFromCoords } from "../../../utils/utils";
import { prepareActorMaterial, useActorLifecycle } from "../Actor";
import {
  beginProceduralBuildingBuild,
  ensureBuildingInterior,
  peekBuildingInterior,
  peekProceduralBuildingAssets,
  ProceduralBuildingAssets,
  releaseProceduralBuildingAssets,
  retainProceduralBuildingAssets,
} from "./buildingAssets";
import { addFarDoor, FarDoor, followFarDoorOrigin, removeFarDoor, setFarDoorAngle, setFarDoorFade } from "./farDoors";
import { createProxyCollider, ProxyColliderHandle } from "./proxyCollider";
import { DOOR_INTERACT_REACH } from "./spec";
import { BuildingAttributes, BuildingProps } from "./types";

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
const DOOR_OPEN_ANGLE = -1.9; // rad — swings outward
const DOOR_SWING_RATE = 4;

// One material instance across every Building (one shader compile); colors
// are baked per building as vertex colors. The interior is unlit: scene light
// can't reach inside the shell anyway.
const DEFAULT_EXTERIOR = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  vertexColors: true,
  roughness: 0.85,
  metalness: 0.05,
});

// Night window lights (see CLAUDE.md → Procedural buildings): per-vertex
// aWindow = (stable per-window random, windowLightChance, windowLightIntensity),
// hashed against a per-night seed so a different subset lights each night.
const WINDOW_LIGHTS_UNIFORM = { value: 0 };
const NIGHT_SEED_UNIFORM = { value: 0 };
DEFAULT_EXTERIOR.onBeforeCompile = (shader) => {
  shader.uniforms.uWindowLights = WINDOW_LIGHTS_UNIFORM;
  shader.uniforms.uNightSeed = NIGHT_SEED_UNIFORM;
  // The hash runs in the VERTEX shader: hashing an interpolated varying per
  // fragment amplifies 1-ulp noise into per-pixel speckle.
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      `#include <common>
      attribute vec3 aWindow;
      uniform float uWindowLights;
      uniform float uNightSeed;
      varying float vWindowLit;
      varying float vWindowGlow;`,
    )
    .replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      float winRoll = fract(sin((fract(aWindow.x) * 91.17 + uNightSeed) * 47.53) * 43758.5453);
      float winOrder = winRoll / max(aWindow.y, 1e-3);
      // The last step gates progress == 0: a hash landing exactly on 0 would
      // otherwise satisfy step(winOrder, 0) and glow in daylight.
      vWindowLit = step(1e-4, aWindow.y) * step(winRoll, aWindow.y) * step(winOrder, uWindowLights) * step(1e-4, uWindowLights);
      vWindowGlow = vWindowLit * aWindow.z;`,
    )
    .replace(
      "#include <project_vertex>",
      `#include <project_vertex>
      // Windows sit 0.05-0.1u proud of the wall, below depth precision a few
      // hundred units out (z-fighting). Pull them toward the camera in view
      // space, scaled with distance. aWindow.x layer: 0 wall, (0,1] frame,
      // (1,2] glass (pulled twice as far — it overlaps the frame).
      if (aWindow.x > 0.0) {
        float winLayer = aWindow.x > 1.0 ? 2.0 : 1.0;
        mvPosition.xyz *= 1.0 - min(-mvPosition.z * 2e-6, 0.003) * winLayer;
        gl_Position = projectionMatrix * mvPosition;
      }`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\nvarying float vWindowLit;\nvarying float vWindowGlow;")
    .replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.78, 0.28), vWindowLit);`,
    )
    .replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
      totalEmissiveRadiance += vec3(1.0, 0.85, 0.1) * vWindowGlow;`,
    );
};
const DEFAULT_INTERIOR = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
const DOOR_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  vertexColors: true,
  roughness: 0.9,
  metalness: 0.05,
});

// Applied AFTER the window-lights patch: the patchers chain, and the window
// depth bias recomputes gl_Position from mvPosition, so it must see the
// curved position. Procedural geometry is off the quantization lattice.
prepareActorMaterial(DEFAULT_EXTERIOR, { skipQuantization: true });
prepareActorMaterial(DOOR_MATERIAL, { skipQuantization: true });
prepareActorMaterial(DEFAULT_INTERIOR, { skipQuantization: true, skipLampGlow: true });

const _raycaster = new THREE.Raycaster();
const _center = new THREE.Vector2(0, 0);
const _sphere = new THREE.Sphere();
const _hits: THREE.Intersection[] = [];

// The FIRST building each frame writes the shared window-light uniforms.
let sharedUniformsTime = -1;

const DISTANCE_GATE_HYSTERESIS = 12;

const buildQueue = new TaskQueue();

// The FIRST building each frame moves the far-door origin.
let farDoorOriginTime = -1;

export const Building = ({
  id,
  descriptorId,
  serverSynced,
  coordinates,
  seed,
  exteriorSize,
  numberOfSides,
  palette,
  accentColors,
  accentChance,
  windowShapes,
  windowCount,
  windowSize,
  maxLean,
  shellHeightRange,
  stories,
  roomCount,
  doorCount,
  doorSize,
  ceilingHeight,
  windowLightChance,
  windowLightIntensity,
  interiorColors,
  materials,
  renderDistance,
  colliderDistance = COLLIDER_DISTANCE,
  despawnDistance,
  onDestroy,
  children,
}: BuildingProps) => {
  const resolvedSeed =
    seed !== undefined ? String(seed) : `${Math.round(coordinates[0])}_${Math.round(coordinates[2])}`;
  const { world, rapier } = useRapier();

  // Stringified key so inline array props don't rebuild assets on parent
  // renders; memoized because every door click re-render paid the stringify.
  const { opts: buildOptions, key: optionsKey } = useMemo(() => {
    const opts: BuildingAttributes = {
      exteriorSize,
      numberOfSides,
      palette,
      accentColors,
      accentChance,
      windowShapes,
      windowCount,
      windowSize,
      maxLean,
      shellHeightRange,
      stories,
      roomCount,
      doorCount,
      doorSize,
      ceilingHeight,
      windowLightChance,
      windowLightIntensity,
      interiorColors,
    };
    return { opts, key: JSON.stringify(opts) };
  }, [
    exteriorSize,
    numberOfSides,
    palette,
    accentColors,
    accentChance,
    windowShapes,
    windowCount,
    windowSize,
    maxLean,
    shellHeightRange,
    stories,
    roomCount,
    doorCount,
    doorSize,
    ceilingHeight,
    windowLightChance,
    windowLightIntensity,
    interiorColors,
  ]);
  const [assets, setAssets] = useState<ProceduralBuildingAssets | null>(() =>
    peekProceduralBuildingAssets(resolvedSeed, optionsKey),
  );
  useEffect(() => {
    if (assets) return;
    let cancelled = false;
    let taskId: string | null = null;
    // One task per build PHASE so the queue can yield between them — as one
    // monolithic task a heavy skyscraper was a single long frame. Each phase queues
    // the next, ranked by distance, so the building nearest the player finishes first.
    const build = beginProceduralBuildingBuild(resolvedSeed, buildOptions, optionsKey);
    const steps = [
      ...build.steps.map((step, phase) => () => traceSpan(`building:phase${phase}`, step)),
      () => setAssets(traceSpan("building:finish", build.finish)),
    ];
    const at = { x: coordinates[0], z: coordinates[2] };
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
  }, [resolvedSeed, optionsKey]); // assets deliberately omitted: guard exits once built

  // Passing `assets` lets the cache re-register an entry a concurrent
  // unmount's release trimmed in the render→effect window.
  useEffect(() => {
    if (!assets) return;
    retainProceduralBuildingAssets(resolvedSeed, optionsKey, assets);
    return () => releaseProceduralBuildingAssets(resolvedSeed, optionsKey);
  }, [assets, resolvedSeed, optionsKey]);

  useEffect(() => {
    if (!assets) return;
    groupRef.current?.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) uploadOnFirstDraw(o);
    });
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
  const doorFrameRef = useRef(framePhaseFromCoords(coordinates[0], coordinates[2], 3));

  // Doors are SERVER-owned replicated state { doors: boolean[] }: a click
  // sends "door:<i>", the server toggles + broadcasts, every client applies.
  const { groupRef, collidersActive, sync } = useActorLifecycle({
    id,
    descriptorId,
    serverSynced,
    coordinates,
    renderDistance,
    despawnDistance: despawnDistance ?? renderDistance * BUILDING_DESPAWN_DISTANCE_FACTOR,
    onDestroy,
    checkInterval: DISTANCE_CHECK_INTERVAL,
    colliderDistance,
    gateHysteresis: DISTANCE_GATE_HYSTERESIS,
    // Activation mounts two Rapier trimeshes (several ms each).
    throttleColliderActivation: true,
    nearDistance: LIVE_DISTANCE,
    freezeMatrices: true,
    onFrame: (state, delta, ctx) => {
      const time = state.clock.elapsedTime;
      if (time !== sharedUniformsTime) {
        sharedUniformsTime = time;
        WINDOW_LIGHTS_UNIFORM.value = getWindowLightsProgress();
        NIGHT_SEED_UNIFORM.value = getNightIndex();
      }

      if (time !== farDoorOriginTime) {
        farDoorOriginTime = time;
        followFarDoorOrigin(state.camera.position.x, state.camera.position.z);
      }

      // Same test as the base's near gate (same distance, same frames), so "live" is exactly
      // "matrices unfrozen" and a real leaf never swings under a frozen matrix.
      if (ctx.gatesChecked) {
        const reach = LIVE_DISTANCE + (liveRef.current ? DISTANCE_GATE_HYSTERESIS : 0);
        const live = ctx.distanceSq < reach * reach;
        liveRef.current = live;
        // The interior is fully occluded by the shell from outside.
        if (interiorGroupRef.current) interiorGroupRef.current.visible = live;
        if (doorsGroupRef.current) doorsGroupRef.current.visible = live;
        if (live && farDoorsRef.current) {
          farDoorsRef.current.forEach(removeFarDoor);
          farDoorsRef.current = null;
        } else if (!live && !farDoorsRef.current && assets) {
          farDoorsRef.current = assets.doors.map((d, i) =>
            addFarDoor(
              state.scene,
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
              hingeRefs.current[i]?.rotation.y ?? (doorsOpenRef.current[i] ? DOOR_OPEN_ANGLE : 0),
              ctx.spawnFade,
            ),
          );
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

      if (doorFrameRef.current++ % 3 === 0) {
        let hover = -1;
        if (ctx.distanceSq < DOOR_RAYCAST_DISTANCE * DOOR_RAYCAST_DISTANCE) {
          _raycaster.setFromCamera(_center, state.camera);
          _raycaster.far = DOOR_INTERACT_REACH;
          for (let i = 0; i < doorMeshRefs.current.length; i++) {
            const mesh = doorMeshRefs.current[i];
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
        }
        if (hover !== hoverDoorRef.current) {
          if (hover >= 0 && hoverDoorRef.current < 0) showCursor();
          if (hover < 0 && hoverDoorRef.current >= 0) hideCursor();
          hoverDoorRef.current = hover;
        }
      }

      // Skipped once settled: the asymptotic lerp otherwise writes rotation.y
      // (Euler→quaternion trig) on every door of every building forever.
      if (doorsMovingRef.current) {
        let stillMoving = false;
        for (let i = 0; i < hingeRefs.current.length; i++) {
          const hinge = hingeRefs.current[i];
          if (!hinge) continue;
          const target = doorsOpenRef.current[i] ? DOOR_OPEN_ANGLE : 0;
          const diff = target - hinge.rotation.y;
          if (Math.abs(diff) < 1e-3) {
            if (diff !== 0) hinge.rotation.y = target;
          } else {
            hinge.rotation.y += diff * Math.min(1, delta * DOOR_SWING_RATE);
            stillMoving = true;
          }
          const far = farDoorsRef.current?.[i];
          if (far) setFarDoorAngle(far, hinge.rotation.y);
        }
        doorsMovingRef.current = stillMoving;
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
    let cancelled = false;
    const taskId = buildQueue.addTask(
      async () => {
        if (!cancelled) setInterior(traceSpan("building:interior", () => ensureBuildingInterior(resolvedSeed, optionsKey)));
      },
      { at: { x: coordinates[0], z: coordinates[2] } },
    );
    return () => {
      cancelled = true;
      buildQueue.removeTask(taskId);
    };
  }, [interiorWanted, assets, resolvedSeed, optionsKey]);

  useEffect(() => {
    if (!interior) return;
    interiorGroupRef.current?.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) uploadOnFirstDraw(o);
    });
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
      <mesh geometry={assets.exteriorGeometry} material={materials?.exterior ?? DEFAULT_EXTERIOR} />

      {/* Built on the first approach within INTERIOR_DISTANCE and kept until unmount; shown
          inside LIVE_DISTANCE (a ref write in onFrame). */}
      {interior && (
        <group ref={interiorGroupRef}>
          <mesh geometry={interior} material={materials?.interior ?? DEFAULT_INTERIOR} />
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
            <CuboidCollider key={`ramp-${i}`} args={r.halfExtents} position={r.position} rotation={r.rotation} />
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
