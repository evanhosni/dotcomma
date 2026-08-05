import { useFrame, useThree } from "@react-three/fiber";
import { CuboidCollider, RigidBody, TrimeshCollider } from "@react-three/rapier";
import { Children, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { DEFAULT_ACTIVATION_DISTANCE } from "../../portals/constants";
import { allocateIndoorSlot, getIndoorY, releaseIndoorSlot } from "../../portals/indoorSlotAllocator";
import { Portal } from "../../portals/Portal";
import { usePortalContext } from "../../portals/PortalContext";
import { getDistance2D } from "../../utils/utils";
import { getProceduralBuildingAssets } from "./buildingAssets";
import { BuildingOptions, BuildingProps } from "./types";

// Beyond this camera distance the exterior trimesh collider is unmounted
// (nothing physical happens to a building 100+ units away).
const EXTERIOR_COLLIDER_DISTANCE = 120;
const DISTANCE_CHECK_INTERVAL = 15; // frames
const DESPAWN_BUFFER = 1.1;

// Shared default materials — one instance across every Building, so shaders
// compile once (same variant-stability rule as portalAssets). Variants will
// eventually swap these out via the `materials` prop.
// The exterior's per-building colors are baked as vertex colors, so one
// white material serves every color scheme.
const DEFAULT_EXTERIOR = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  vertexColors: true,
  roughness: 0.85,
  metalness: 0.05,
});
const DEFAULT_WALL = new THREE.MeshStandardMaterial({ color: 0xb9a763, roughness: 0.95, metalness: 0 });
const DEFAULT_FLOOR = new THREE.MeshStandardMaterial({ color: 0x7d7350, roughness: 1, metalness: 0 });
const DEFAULT_CEILING = new THREE.MeshStandardMaterial({ color: 0xd6cfae, roughness: 0.9, metalness: 0 });
// Unlit so the panels read as glowing fixtures under the IndoorLightRig.
const LIGHT_PANEL_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xfff7d6 });

/**
 * Procedurally generated building: a seeded, vaguely-monolithic exterior
 * (leaning, tapering, stacked masses) over a backrooms-style BSP room
 * interior, connected by portal doors. The seed defaults to the spawn
 * coordinates, so the same spot always regrows the same building.
 *
 * Children are placed at seeded positions inside the interior's rooms.
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
  interiorScale,
  materials,
  activationDistance = DEFAULT_ACTIVATION_DISTANCE,
  ceilingLights = true,
  renderDistance,
  onDestroy,
  children,
}: BuildingProps) => {
  const { publishIndoorBounds, unpublishIndoorBounds } = usePortalContext();
  const { camera } = useThree();

  const resolvedSeed = seed !== undefined ? String(seed) : `${Math.round(coordinates[0])}_${Math.round(coordinates[2])}`;

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
    interiorScale,
  };
  const optionsKey = JSON.stringify(opts);
  const assets = useMemo(
    () => getProceduralBuildingAssets(resolvedSeed, JSON.parse(optionsKey) as BuildingOptions),
    [resolvedSeed, optionsKey],
  );
  const { plan } = assets;
  const { width: iw, depth: idp, stories: storyCount, storyHeight } = plan.interior;
  const interiorHeight = storyCount * storyHeight;

  // Unique indoor Y slot for this instance (interiors live above the world)
  const slotRef = useRef<number | null>(null);
  if (slotRef.current === null) slotRef.current = allocateIndoorSlot();
  const indoorY = getIndoorY(slotRef.current);
  useEffect(() => {
    return () => {
      if (slotRef.current !== null) releaseIndoorSlot(slotRef.current);
    };
  }, []);

  // World-space interior bounds for the IndoorLightRig (spans all stories)
  useEffect(() => {
    publishIndoorBounds(id, {
      center: new THREE.Vector3(coordinates[0], indoorY + interiorHeight / 2, coordinates[2]),
      size: new THREE.Vector3(iw, interiorHeight, idp),
    });
    return () => unpublishIndoorBounds(id);
  }, [id, coordinates, indoorY, iw, interiorHeight, idp, publishIndoorBounds, unpublishIndoorBounds]);

  // Distance loop: self-despawn past renderDistance, gate the exterior
  // collider, and gate the whole interior (GameObject does the first two for
  // GLTF spawnables; here we own it). 2D distance, so standing INSIDE the
  // interior (y ≈ indoorY) doesn't count as far away.
  //
  // The interior (meshes, exit portals, colliders) only matters near the
  // doors — portal previews activate within activationDistance and teleports
  // happen at the door plane. Gating it keeps the physics world and portal
  // count bounded at high building density.
  const interiorActiveDistance = activationDistance + 60;
  const positionVec = useRef(new THREE.Vector3(...coordinates)).current;
  // Both gates start false so a spawn batch of far buildings doesn't mount
  // colliders for a frame; the first distance check (frame 0) corrects them.
  const [collidersActive, setCollidersActive] = useState(false);
  const collidersActiveRef = useRef(false);
  const [interiorActive, setInteriorActive] = useState(false);
  const interiorActiveRef = useRef(false);
  const frameCounter = useRef(0);
  useFrame(() => {
    if (frameCounter.current++ % DISTANCE_CHECK_INTERVAL !== 0) return;
    const distance = getDistance2D(camera.position, positionVec);
    if (distance > renderDistance * DESPAWN_BUFFER) {
      onDestroy(id);
      return;
    }
    const shouldCollide = distance < EXTERIOR_COLLIDER_DISTANCE;
    if (shouldCollide !== collidersActiveRef.current) {
      collidersActiveRef.current = shouldCollide;
      setCollidersActive(shouldCollide);
    }
    // Hysteresis so the interior doesn't flap at the threshold
    const shouldInterior = distance < interiorActiveDistance + (interiorActiveRef.current ? 12 : 0);
    if (shouldInterior !== interiorActiveRef.current) {
      interiorActiveRef.current = shouldInterior;
      setInteriorActive(shouldInterior);
    }
  });

  const childArray = Children.toArray(children);
  const slots = plan.interior.childSlots;

  return (
    <group position={coordinates}>
      {/* Exterior shell */}
      <mesh geometry={assets.exteriorGeometry} material={materials?.exterior ?? DEFAULT_EXTERIOR} />
      {collidersActive && (
        <RigidBody type="fixed" colliders={false}>
          {/* Same triangles as the render mesh — door openings included */}
          <TrimeshCollider args={[assets.exteriorVertices, assets.exteriorIndices]} />
        </RigidBody>
      )}

      {/* Enter portals — outdoor-side doors, flush with the carved openings */}
      {assets.enterPortals.map((p) => (
        <Portal
          key={`enter-${p.name}`}
          id={`enter-${id}-${p.name}`}
          pairedId={`exit-${id}-${p.name}`}
          position={p.position}
          rotation={p.rotation}
          size={p.size}
          geometry={assets.doorGeometry}
          targetIndoorId={id}
          activationDistance={activationDistance}
          direction="enter"
        />
      ))}

      {/* Interior — mounted at its indoor Y slot while the player is near
          enough for a portal preview or teleport (see the distance loop). */}
      {interiorActive && (
      <group position={[0, indoorY - coordinates[1], 0]}>
        <mesh geometry={assets.wallGeometry} material={materials?.wall ?? DEFAULT_WALL} />
        <mesh geometry={assets.floorGeometry} material={materials?.floor ?? DEFAULT_FLOOR} />
        <mesh geometry={assets.ceilingGeometry} material={materials?.ceiling ?? DEFAULT_CEILING} />
        {ceilingLights && assets.lightsGeometry && (
          <mesh geometry={assets.lightsGeometry} material={LIGHT_PANEL_MATERIAL} />
        )}

        {/* Exit portals — indoor-side doors on the perimeter walls */}
        {assets.exitPortals.map((p) => (
          <Portal
            key={`exit-${p.name}`}
            id={`exit-${id}-${p.name}`}
            pairedId={`enter-${id}-${p.name}`}
            position={p.position}
            rotation={p.rotation}
            size={p.size}
            geometry={assets.doorGeometry}
            targetIndoorId={id}
            activationDistance={activationDistance}
            direction="exit"
          />
        ))}

        {/* Children spawn at seeded slots inside the rooms */}
        {childArray.map((child, i) => {
          const slot = slots[i % slots.length];
          return (
            <group key={i} position={slot.position} rotation={[0, slot.rotationY, 0]}>
              {child}
            </group>
          );
        })}

        {/* Interior physics — always mounted so a teleport never lands
            floorless. Walls on every story, slabs with the ramp-shaft holes,
            padded bottom floor/top ceiling, plus one rotated cuboid per ramp
            flight (identical to the visible ramp slab). */}
        <RigidBody type="fixed" colliders={false}>
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
        </RigidBody>
      </group>
      )}
    </group>
  );
};
