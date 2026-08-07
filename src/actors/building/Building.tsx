import { useFrame, useThree } from "@react-three/fiber";
import { CuboidCollider, RigidBody, TrimeshCollider } from "@react-three/rapier";
import { Children, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { getNightIndex, getWindowLightsProgress } from "../../sky/dayNight";
import { patchStandardMaterialLampGlow } from "../../sky/lampGlow";
import { hideCursor, showCursor } from "../../utils/cursor/cursor";
import { TaskQueue } from "../../utils/task-queue/TaskQueue";
import { getDistance2D } from "../../utils/utils";
import {
  getProceduralBuildingAssets,
  peekProceduralBuildingAssets,
  ProceduralBuildingAssets,
} from "./buildingAssets";
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

// Street-lamp glow: walls and doors near a lamp brighten in its color via the
// shared uLampGlow shader channel (chains after the window-lights patch).
patchStandardMaterialLampGlow(DEFAULT_EXTERIOR);
patchStandardMaterialLampGlow(DOOR_MATERIAL);

const _raycaster = new THREE.Raycaster();
const _center = new THREE.Vector2(0, 0);

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
  const { camera } = useThree();

  const resolvedSeed =
    seed !== undefined ? String(seed) : `${Math.round(coordinates[0])}_${Math.round(coordinates[2])}`;

  // Keyed on the stringified options so inline array props don't rebuild
  // assets on every parent render (same pattern as the world registrations).
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
  const optionsKey = JSON.stringify(opts);
  // Cache-hit seeds (despawn/respawn churn) mount instantly; NEW seeds build
  // through the shared task queue so a spawn batch with several unseen
  // buildings can't stack plan generation + triangulation into one frame.
  const [assets, setAssets] = useState<ProceduralBuildingAssets | null>(() =>
    peekProceduralBuildingAssets(resolvedSeed, optionsKey),
  );
  useEffect(() => {
    if (assets) return;
    let cancelled = false;
    buildQueue.addTask(async () => {
      if (cancelled) return;
      const built = getProceduralBuildingAssets(resolvedSeed, JSON.parse(optionsKey) as BuildingOptions);
      if (!cancelled) setAssets(built);
    });
    return () => {
      cancelled = true;
    };
  }, [resolvedSeed, optionsKey]); // assets deliberately omitted: guard exits once built

  // ---- Door state ---- (indexes default closed until toggled)
  const [doorsOpen, setDoorsOpen] = useState<boolean[]>([]);
  const doorMeshRefs = useRef<(THREE.Mesh | null)[]>([]);
  const hingeRefs = useRef<(THREE.Group | null)[]>([]);
  const hoverDoorRef = useRef(-1);

  // ---- Distance loop: self-despawn, collider gate, children gate. 2D
  // distance so upper floors don't count as "far". ----
  const positionVec = useRef(new THREE.Vector3(...coordinates)).current;
  const [collidersActive, setCollidersActive] = useState(false);
  const collidersActiveRef = useRef(false);
  const [childrenActive, setChildrenActive] = useState(false);
  const childrenActiveRef = useRef(false);
  const lastDistanceRef = useRef(Infinity);
  const frameCounter = useRef(0);

  useFrame((_, delta) => {
    const frame = frameCounter.current++;

    // Shared-material uniforms — every building writes the same values, so
    // whichever runs first each frame wins and the rest are no-ops.
    WINDOW_LIGHTS_UNIFORM.value = getWindowLightsProgress();
    NIGHT_SEED_UNIFORM.value = getNightIndex();

    if (frame % DISTANCE_CHECK_INTERVAL === 0) {
      const distance = getDistance2D(camera.position, positionVec);
      lastDistanceRef.current = distance;
      if (distance > (despawnDistance ?? renderDistance * DESPAWN_BUFFER)) {
        if (hoverDoorRef.current >= 0) hideCursor();
        onDestroy(id);
        return;
      }
      const shouldCollide = distance < COLLIDER_DISTANCE;
      if (shouldCollide !== collidersActiveRef.current) {
        collidersActiveRef.current = shouldCollide;
        setCollidersActive(shouldCollide);
      }
      const near = distance < CHILDREN_ACTIVE_DISTANCE + (childrenActiveRef.current ? 12 : 0);
      if (near !== childrenActiveRef.current) {
        childrenActiveRef.current = near;
        setChildrenActive(near);
      }
    }

    // ---- Door hover (screen-center raycast, every 3rd frame, only nearby) ----
    if (frame % 3 === 0) {
      let hover = -1;
      if (lastDistanceRef.current < DOOR_HOVER_GATE) {
        _raycaster.setFromCamera(_center, camera);
        _raycaster.far = DOOR_INTERACT_DISTANCE;
        for (let i = 0; i < doorMeshRefs.current.length; i++) {
          const mesh = doorMeshRefs.current[i];
          if (!mesh) continue;
          if (_raycaster.intersectObject(mesh, false).length > 0) {
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

    // ---- Door swing animation ----
    for (let i = 0; i < hingeRefs.current.length; i++) {
      const hinge = hingeRefs.current[i];
      if (!hinge) continue;
      const target = doorsOpen[i] ? DOOR_OPEN_ANGLE : 0;
      hinge.rotation.y += (target - hinge.rotation.y) * Math.min(1, delta * DOOR_SWING_RATE);
    }
  });

  // Click the hovered door to swing it open/closed
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const idx = hoverDoorRef.current;
      if (idx < 0) return;
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
    <group position={coordinates}>
      {/* The building: hollow shell + the interior physically inside it,
          both always rendered */}
      <mesh geometry={assets.exteriorGeometry} material={materials?.exterior ?? DEFAULT_EXTERIOR} />
      <mesh geometry={assets.interiorGeometry} material={materials?.interior ?? DEFAULT_INTERIOR} />

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
      {childrenActive &&
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
