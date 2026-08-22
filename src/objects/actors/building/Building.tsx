import { CuboidCollider, RigidBody, TrimeshCollider, useRapier } from "@react-three/rapier";
import { Children, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { getNightIndex, getWindowLightsProgress } from "../../../lighting/dayNight";
import { hideCursor, showCursor } from "../../../utils/cursor/cursor";
import { TaskQueue } from "../../../utils/task-queue/TaskQueue";
import { traceEvent, traceSpan } from "../../../utils/spikeTrace";
import { uploadOnFirstDraw } from "../../../utils/uploadOnFirstDraw";
import { prepareActorMaterial, useActorLifecycle } from "../Actor";
import {
  beginProceduralBuildingBuild,
  peekProceduralBuildingAssets,
  ProceduralBuildingAssets,
  releaseProceduralBuildingAssets,
  retainProceduralBuildingAssets,
} from "./buildingAssets";
import { createProxyCollider, ProxyColliderHandle } from "./proxyCollider";
import { BuildingOptions, BuildingProps } from "./types";

// Beyond this camera distance all of the building's colliders are unmounted
// (nothing physical happens to a building 100+ units away).
const COLLIDER_DISTANCE = 120;
const DISTANCE_CHECK_INTERVAL = 15; // frames
const DESPAWN_BUFFER = 1.1;
// Children (actors placed inside rooms) mount within this distance.
const CHILDREN_ACTIVE_DISTANCE = 150;
const DOOR_INTERACT_DISTANCE = 6; // click/hover reach
const DOOR_HOVER_GATE = 30; // building distance under which the door raycast runs
const DOOR_OPEN_ANGLE = -1.9; // rad — swings outward
const DOOR_SWING_RATE = 4;

// Shared default materials — one instance across every Building, so shaders
// compile once. Both use per-building baked vertex colors: the exterior's
// segment palette, and the interior's flat backrooms palette (unlit — scene
// light can't reach inside the shell, and it matches the game's flat look).
const DEFAULT_EXTERIOR = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  vertexColors: true,
  roughness: 0.85,
  metalness: 0.05,
});

// ---- Night window lights ----
// The exterior geometry carries a per-vertex vec3 `aWindow`: a stable
// per-window random, the building's windowLightChance, and its
// windowLightIntensity ((0,0,0) outside window glass). Each night the
// random is hashed with a per-night seed —
// tonight's roll below the chance means this window lights, and the roll
// doubles as its turn-on order within the lights transition, so a DIFFERENT
// subset pops on sporadically every night (and off the same way at dawn).
// Lit glass turns washed yellowish and glows via the emissive term — no
// per-window light objects, no extra draw calls, one shader compile shared
// by every building.
const WINDOW_LIGHTS_UNIFORM = { value: 0 };
const NIGHT_SEED_UNIFORM = { value: 0 };
DEFAULT_EXTERIOR.onBeforeCompile = (shader) => {
  shader.uniforms.uWindowLights = WINDOW_LIGHTS_UNIFORM;
  shader.uniforms.uNightSeed = NIGHT_SEED_UNIFORM;
  // The hash roll runs in the VERTEX shader on the exact attribute value —
  // hashing an interpolated varying per fragment amplifies 1-ulp
  // interpolation noise into per-pixel speckle. Every vertex of a window
  // shares the same aWindow, so the finished lit factor interpolates flat.
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
      // step, not a ramp — each window snaps on/off the frame the global
      // progress crosses its turn-on order (no per-window fade). The final
      // step gates progress == 0: a hash that lands exactly on 0 would
      // otherwise satisfy step(winOrder, 0) and glow in daylight.
      vWindowLit = step(1e-4, aWindow.y) * step(winRoll, aWindow.y) * step(winOrder, uWindowLights) * step(1e-4, uWindowLights);
      // per-building emissive strength (windowLightIntensity), baked in .z
      vWindowGlow = vWindowLit * aWindow.z;`,
    )
    .replace(
      "#include <project_vertex>",
      `#include <project_vertex>
      // Windows float only 0.05-0.1u proud of the wall — below the depth
      // buffer's precision a few hundred units out, which z-fights. Pull
      // window parts toward the camera in view space (screen position is
      // unchanged, only depth), scaled with distance so the bias always
      // outruns the shrinking precision. aWindow.x encodes the layer:
      // 0 = wall, (0,1] = frame, (1,2] = glass (pulled twice as far, since
      // the glass overlaps the frame).
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
// Door color is baked into the (per-building) leaf geometry's vertex colors.
const DOOR_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  vertexColors: true,
  roughness: 0.9,
  metalness: 0.05,
});

// Shared ACTOR material logic (actors/Actor.tsx): lamp glow — walls and doors
// near a lamp brighten in its color — plus world curvature, so a building
// sinks with the ground it stands on. Applied LAST, after the window-lights
// patch above, because those patchers CHAIN: curvature curves mvPosition in
// place, so the window depth bias (which recomputes gl_Position from
// mvPosition) inherits the curved position instead of undoing it.
// Buildings are procedural, not on the quantization lattice; the interior is
// unlit, so lamp glow has no irradiance to join.
prepareActorMaterial(DEFAULT_EXTERIOR, { skipQuantization: true });
prepareActorMaterial(DOOR_MATERIAL, { skipQuantization: true });
prepareActorMaterial(DEFAULT_INTERIOR, { skipQuantization: true, skipLampGlow: true });

const _raycaster = new THREE.Raycaster();
const _center = new THREE.Vector2(0, 0);
const _sphere = new THREE.Sphere();
// Reused door-hover hit target — intersectObject otherwise allocates a fresh
// result array per door per check, across every nearby building.
const _hits: THREE.Intersection[] = [];

// Shared-uniform time guard (same pattern as the lamp lighting driver): the
// FIRST building to run each frame writes the global window-light uniforms,
// the other few hundred skip.
let sharedUniformsTime = -1;

// Hysteresis band for the distance gates (collider / children / interior) so
// none of them flicker while the player hovers at a boundary.
const GATE_HYSTERESIS = 12;

// Building geometry builds run through this queue (time-budgeted slices) so
// a spawn batch with several unseen seeds never triangulates in one frame.
const buildQueue = new TaskQueue();

/**
 * Procedurally generated building — exterior and interior are ONE thing. The
 * shell is genuinely hollow with the walls, floor slabs, and ramp flights
 * physically in place, all rendered at all times (shell mesh + one merged
 * vertex-colored interior mesh), so the two can never disagree. The plan
 * generator guarantees the shell always wraps the occupied floors — lean and
 * taper only run free above them.
 *
 * Each door opening holds a real hinged door leaf: click it (screen-center
 * raycast, cursor grows on hover) to swing it open. Only dynamic content is
 * gated: children (actors inside rooms) mount within range, and all
 * colliders mount only near the player.
 */
export const Building = ({
  id,
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
  heightRange,
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
  despawnDistance,
  onDestroy,
  children,
}: BuildingProps) => {
  const resolvedSeed =
    seed !== undefined ? String(seed) : `${Math.round(coordinates[0])}_${Math.round(coordinates[2])}`;
  const { world, rapier } = useRapier();

  // Keyed on the stringified options so inline array props don't rebuild
  // assets on every parent render (same pattern as the world registrations).
  // Memoized on the option props themselves: they come from descriptor
  // spreads, so their identities are stable across this component's own
  // re-renders (door clicks, gate flips) — without the memo every render
  // paid a JSON.stringify.
  const optionsKey = useMemo(() => {
    const opts: BuildingOptions = {
      exteriorSize,
      numberOfSides,
      palette,
      accentColors,
      accentChance,
      windowShapes,
      windowCount,
      windowSize,
      maxLean,
      heightRange,
      stories,
      roomCount,
      doorCount,
      doorSize,
      ceilingHeight,
      windowLightChance,
      windowLightIntensity,
      interiorColors,
    };
    return JSON.stringify(opts);
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
    heightRange,
    stories,
    roomCount,
    doorCount,
    doorSize,
    ceilingHeight,
    windowLightChance,
    windowLightIntensity,
    interiorColors,
  ]);
  // Cache-hit seeds (despawn/respawn churn) mount instantly; NEW seeds build
  // through the shared task queue so a spawn batch with several unseen
  // buildings can't stack plan generation + triangulation into one frame.
  const [assets, setAssets] = useState<ProceduralBuildingAssets | null>(() =>
    peekProceduralBuildingAssets(resolvedSeed, optionsKey),
  );
  useEffect(() => {
    if (assets) return;
    let cancelled = false;
    // Each build PHASE queues as its own task (plan → exterior → interior →
    // assembly), so the queue's time budget can yield between phases — as one
    // monolithic task a heavy skyscraper was a single long frame no budget
    // could split (an occasional roaming lag spike). Cancelled builds just
    // stop; partial geometry was never rendered, so there's nothing to free.
    const build = beginProceduralBuildingBuild(resolvedSeed, JSON.parse(optionsKey) as BuildingOptions);
    build.steps.forEach((step, phase) => {
      buildQueue.addTask(async () => {
        if (!cancelled) traceSpan(`building:phase${phase}`, step);
      });
    });
    buildQueue.addTask(async () => {
      if (!cancelled) setAssets(traceSpan("building:finish", build.finish));
    });
    return () => {
      cancelled = true;
    };
  }, [resolvedSeed, optionsKey]); // assets deliberately omitted: guard exits once built

  // Pin the cache entry for as long as this building renders it — eviction
  // only touches refcount-0 entries, so a mounted mesh's geometry can never
  // be disposed out from under it (the old FIFO evicted still-rendering
  // entries whenever >64 buildings were up). Passing `assets` lets the cache
  // re-register the entry if a concurrent unmount's release trimmed it in
  // the render→effect window.
  useEffect(() => {
    if (!assets) return;
    retainProceduralBuildingAssets(resolvedSeed, optionsKey, assets);
    return () => releaseProceduralBuildingAssets(resolvedSeed, optionsKey);
  }, [assets, resolvedSeed, optionsKey]);

  // Buildings mostly mount OFF-SCREEN (spawn radius is a circle, the player
  // faces one way) — pay each mesh's one-time GPU upload now, staggered by
  // the spawn batch, instead of all at once when the player turns around.
  useEffect(() => {
    if (!assets) return;
    groupRef.current?.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) uploadOnFirstDraw(o);
    });
  }, [assets]);

  // ---- Door state ---- (indexes default closed until toggled)
  // The React state drives the collider mount; the SWING LOOP reads the ref.
  // It must: the click wakes the sleeping swing loop and toggles state in the
  // same handler, but the next useFrame can run BEFORE React re-renders — a
  // loop reading the stale closure sees every door already settled and goes
  // straight back to sleep, eating the click (the "click 3 times" bug).
  const [doorsOpen, setDoorsOpen] = useState<boolean[]>([]);
  // The proxy collider deliberately keeps NO React state — see
  // proxyCollider.ts. The handle owns its Rapier body for its whole lifetime.
  const proxyRef = useRef<ProxyColliderHandle | null>(null);
  const doorsOpenRef = useRef<boolean[]>([]);
  const doorMeshRefs = useRef<(THREE.Mesh | null)[]>([]);
  const hingeRefs = useRef<(THREE.Group | null)[]>([]);
  const hoverDoorRef = useRef(-1);
  // False once every hinge has settled on its target — the swing loop (and
  // its Euler→quaternion trig) is skipped entirely until the next click.
  const doorsMovingRef = useRef(false);

  const interiorMeshRef = useRef<THREE.Mesh>(null);
  const doorFrameRef = useRef(0);

  // ---- The shared ACTOR lifecycle (objects/actors/Actor.tsx) ----
  // Self-despawn, the collider gate (with its activation throttle), the
  // children/interior "near" gate, matrix freezing, the per-instance frame
  // phase, and running inside the ONE shared frame driver all come from the
  // base. What's left below is what only a building does: its shared-uniform
  // write, the interior draw gate, and the doors.
  const { groupRef, collidersActive, nearActive } = useActorLifecycle({
    id,
    coordinates,
    renderDistance,
    despawnDistance: despawnDistance ?? renderDistance * DESPAWN_BUFFER,
    onDestroy,
    checkInterval: DISTANCE_CHECK_INTERVAL,
    colliderDistance: COLLIDER_DISTANCE,
    gateHysteresis: GATE_HYSTERESIS,
    // Activation mounts two Rapier trimeshes (a QBVH build over the exterior
    // triangles, several ms each) — the base staggers them across frames.
    throttleColliderActivation: true,
    nearDistance: CHILDREN_ACTIVE_DISTANCE,
    freezeMatrices: true,
    // The building's own meshes cull themselves; no group-level frustum test.
    onFrame: (state, delta, ctx) => {
      // Shared-material uniforms — module-level time guard: the first building
      // each frame writes, the rest skip.
      const time = state.clock.elapsedTime;
      if (time !== sharedUniformsTime) {
        sharedUniformsTime = time;
        WINDOW_LIGHTS_UNIFORM.value = getWindowLightsProgress();
        NIGHT_SEED_UNIFORM.value = getNightIndex();
      }

      // The interior mesh is fully occluded by the shell from outside — cull
      // its draw call beyond children range (ref write, no re-render; the
      // base's near gate already carries the hysteresis, so it can't flicker).
      if (ctx.checked && interiorMeshRef.current) interiorMeshRef.current.visible = nearActive;

      // ---- Door hover (screen-center raycast, every 3rd frame, only nearby) ----
      if (doorFrameRef.current++ % 3 === 0) {
        let hover = -1;
        if (ctx.distanceSq < DOOR_HOVER_GATE * DOOR_HOVER_GATE) {
          _raycaster.setFromCamera(_center, state.camera);
          _raycaster.far = DOOR_INTERACT_DISTANCE;
          for (let i = 0; i < doorMeshRefs.current.length; i++) {
            const mesh = doorMeshRefs.current[i];
            if (!mesh) continue;
            // Bounding-sphere pre-test + reused hit array: intersectObject
            // otherwise allocates a result array per door per check.
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

      // ---- Door swing animation (skipped once all doors have settled — the
      // asymptotic lerp otherwise keeps writing rotation.y, and its Euler→
      // quaternion trig, on every door of every building forever) ----
      if (doorsMovingRef.current) {
        let stillMoving = false;
        for (let i = 0; i < hingeRefs.current.length; i++) {
          const hinge = hingeRefs.current[i];
          if (!hinge) continue;
          const target = doorsOpenRef.current[i] ? DOOR_OPEN_ANGLE : 0;
          const diff = target - hinge.rotation.y;
          if (Math.abs(diff) < 1e-3) {
            if (diff !== 0) hinge.rotation.y = target; // snap; settled doors write nothing
          } else {
            hinge.rotation.y += diff * Math.min(1, delta * DOOR_SWING_RATE);
            stillMoving = true;
          }
        }
        doorsMovingRef.current = stillMoving;
      }
    },
  });

  // Rapier trimesh builds land in the commit after the gate opens.
  useEffect(() => {
    if (collidersActive) traceEvent("building:colliders-on");
  }, [collidersActive]);

  // ---- Proxy collider: the building's COARSE convex hull, mounted exactly when
  // the real (doored, per-wall) colliders aren't — so a building ALWAYS has a
  // collider and NPCs can't walk through distant walls (see proxyCollider.ts).
  // Built IMPERATIVELY rather than as <RigidBody>/<ConvexHullCollider>: every
  // building past the collider gate carries one, and hundreds of extra Object3Ds
  // would pay compose() per frame — the very cost this actor's matrix freezing
  // exists to avoid. It also sidesteps that freeze: a React collider mounted
  // under a group whose matrixWorldAutoUpdate is off has no current world matrix
  // to read. Fixed body, no scene graph, no per-frame work at all — the handle
  // is solid from creation, so there is no frame in which this building is
  // passable, and no distance gate of its own. ----
  useEffect(() => {
    if (!assets || collidersActive) return;
    const handle = createProxyCollider({ world, rapier }, coordinates, assets.proxyHullVertices);
    proxyRef.current = handle;
    return () => {
      proxyRef.current = null;
      handle.dispose();
    };
    // coordinates is a stable per-spawn tuple; the collider gate drives this
  }, [assets, collidersActive, world, rapier]);

  // Click the hovered door to swing it open/closed
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const idx = hoverDoorRef.current;
      if (idx < 0) return;
      // Ref first (synchronous — the swing loop may run before the state
      // lands), then wake the loop, then the state for the collider gate.
      doorsOpenRef.current[idx] = !doorsOpenRef.current[idx];
      doorsMovingRef.current = true;
      setDoorsOpen((open) => {
        const next = [...open];
        next[idx] = !next[idx];
        return next;
      });
    };
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, []);

  // Make sure a hover-grown cursor never leaks past unmount
  useEffect(() => {
    return () => {
      if (hoverDoorRef.current >= 0) hideCursor();
    };
  }, []);

  // Assets still building on the queue (new seed) — render nothing this frame
  if (!assets) return null;

  const childArray = Children.toArray(children);
  const slots = assets.plan.interior.childSlots;

  return (
    <group ref={groupRef} position={coordinates}>
      {/* The building: hollow shell + the interior physically inside it.
          The interior mesh only DRAWS within children range (visible is
          driven by the distance loop above — from outside it's fully
          occluded by the shell; starts hidden, the first-frame distance
          check sets it before the first paint) */}
      <mesh geometry={assets.exteriorGeometry} material={materials?.exterior ?? DEFAULT_EXTERIOR} />
      <mesh
        ref={interiorMeshRef}
        visible={false}
        geometry={assets.interiorGeometry}
        material={materials?.interior ?? DEFAULT_INTERIOR}
      />

      {/* Doors — real leaves hinged at one edge */}
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

      {/* Physics — shell trimesh (door openings walkable), interior walls,
          slab trimesh, ramps, and the closed door leaves */}
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

      {/* Children spawn at seeded slots inside the rooms, within range */}
      {nearActive &&
        childArray.map((child, i) => {
          const slot = slots[i % slots.length];
          return (
            <group key={i} position={slot.position} rotation={[0, slot.rotationY, 0]}>
              {child}
            </group>
          );
        })}
    </group>
  );
};
