import { useFrame, useThree } from "@react-three/fiber";
import React from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils";
import {
  activeLampHeads,
  driveLampLighting,
  LAMP_COLOR_GREEN,
  LAMP_COLOR_RED,
  LAMP_COLOR_YELLOW,
  LampHead,
  markLampGridDirty,
  unregisterLampHeads,
} from "../../../lighting/lampGlow";
import {
  DressingColliderPart,
  DressingPartColliders,
  instancedFromPoints,
  useChunkRegistry,
  useDressingAssets,
  useDressingChunks,
  useDressingColliders,
  useDressingRenderDistance,
  yawFromDir,
} from "../Dressing";
import { getTrafficLightPoints } from "../dressingWorker";

const POLE_HEIGHT = 7.6;
// Collider half-width: a touch proud of the 0.2u pole so you cannot clip its
// corner, and it swallows the 0.5u base (0.4u tall — steppable, not worth a
// second shape).
const POLE_HALF_WIDTH = 0.14;
const ARM_LENGTH = 3.2; // toward the intersection — hangs the head over the curb
const LAMP_OFFSET = ARM_LENGTH + 0.26; // lamps proud of the head's front face
/** Mast arm + signal head as boxes, in POLE-LOCAL space (+X toward the
 *  intersection), shared by the geometry and by their colliders — one source, so
 *  changing the art can't leave a collider behind in the old shape. */
const SIGNAL_PARTS = {
  arm: { w: ARM_LENGTH, h: 0.15, d: 0.15, x: ARM_LENGTH / 2, y: POLE_HEIGHT - 0.15 },
  head: { w: 0.45, h: 2.0, d: 0.75, x: ARM_LENGTH, y: POLE_HEIGHT - 1.25 },
};
/** Pole, mast arm and signal head, all solid. The LAMPS get nothing — they
 *  sit on the head's face and are already inside its box. */
const SIGNAL_COLLIDER_PARTS: DressingColliderPart[] = [
  { w: POLE_HALF_WIDTH * 2, h: POLE_HEIGHT, d: POLE_HALF_WIDTH * 2, x: 0, y: POLE_HEIGHT / 2 },
  SIGNAL_PARTS.arm,
  SIGNAL_PARTS.head,
];

// Lamp order per light: instances 3i / 3i+1 / 3i+2 = red / yellow / green
// (top to bottom on the head). state: 0 = green, 1 = yellow, 2 = red.
const LIT = [new THREE.Color("#ff2418"), new THREE.Color("#ffb400"), new THREE.Color("#19ff5a")];
const DIM = [new THREE.Color("#3a0c08"), new THREE.Color("#402d04"), new THREE.Color("#06401a")];
const STATE_TO_LAMP = [2, 1, 0]; // green state lights the bottom lamp, etc.
const STATE_TO_GLOW = [LAMP_COLOR_GREEN, LAMP_COLOR_YELLOW, LAMP_COLOR_RED];

/** CHAOTIC hold time: heavily skewed toward quick flips (0.2s), capped at
 *  ~1.5s — no steady rhythm, no per-color timing. */
const holdFor = (): number => 0.2 + Math.pow(Math.random(), 2.2) * 1.3;

/** CHAOTIC transition: jump to either of the OTHER two states at random —
 *  not a green → yellow → red cycle. */
const nextState = (state: number): number => (state + 1 + Math.floor(Math.random() * 2)) % 3;

interface LightAnim {
  state: number; // 0 green, 1 yellow, 2 red
  remaining: number; // seconds until the next switch
  head: LampHead; // registered glow source — mutate .color on switch
}

interface SignalChunk {
  group: THREE.Group;
  lamps: THREE.InstancedMesh;
  lights: LightAnim[];
  headKeys: string[];
  /** Pole bases WITH their yaw — the collider scan's input. The arm and head
   *  are off-axis, so their colliders need the same yaw the instance was drawn
   *  with (see useDressingColliders). */
  points: { x: number; y: number; z: number; yaw: number }[];
  /** Seconds accumulated since the last per-light pass. */
  sincePass: number;
  /** min(lights.remaining) at the last pass — until sincePass reaches it, no
   *  light in the chunk can be due, so the whole chunk is skipped. */
  nextSwitchIn: number;
}

export interface TrafficLightsProps {
  renderDistance?: number;
  /** Seeded fraction of eligible intersections that get signals. */
  chance?: number;
}

/**
 * DRESSING: traffic lights at SOME city street intersections (seeded
 * per-intersection roll): a pole on each surviving sidewalk corner with a
 * mast arm hanging a three-lamp head over the curb, facing the intersection.
 * Lamps flip between green/yellow/red CHAOTICALLY — random next state,
 * random skewed hold times — via per-lamp instanceColor writes (two
 * InstancedMeshes per chunk). Pole, mast arm and signal head are all SOLID
 * within DRESSING_COLLIDER_DISTANCE — real cuboid colliders for the handful of signals
 * near the player, the same distance-gated pattern the street lamps use
 * (useDressingColliders); signals further out are scenery, with nothing near
 * them to collide. Each signal also registers a
 * lamp-grid glow source in its CURRENT color, so at night the pavement below
 * washes red/yellow/green and follows the switches (grid rewrites every few
 * frames; the glow intensity rides the global dusk/dawn ramp).
 */
export const TrafficLights = ({ renderDistance, chance = 0.45 }: TrafficLightsProps) => {
  const resolvedDistance = useDressingRenderDistance(renderDistance, 340);
  const { camera } = useThree();
  const registry = useChunkRegistry<SignalChunk>((chunk) => unregisterLampHeads(chunk.headKeys));

  const assets = useDressingAssets(() => ({
    bodyGeometry: mergeGeometries([
      new THREE.BoxGeometry(0.5, 0.4, 0.5).translate(0, 0.2, 0), // base
      new THREE.BoxGeometry(0.2, POLE_HEIGHT, 0.2).translate(0, POLE_HEIGHT / 2, 0), // pole
      new THREE.BoxGeometry(SIGNAL_PARTS.arm.w, SIGNAL_PARTS.arm.h, SIGNAL_PARTS.arm.d).translate(
        SIGNAL_PARTS.arm.x,
        SIGNAL_PARTS.arm.y,
        0
      ), // arm
      new THREE.BoxGeometry(SIGNAL_PARTS.head.w, SIGNAL_PARTS.head.h, SIGNAL_PARTS.head.d).translate(
        SIGNAL_PARTS.head.x,
        SIGNAL_PARTS.head.y,
        0
      ), // head
    ]),
    lampGeometry: new THREE.BoxGeometry(0.18, 0.48, 0.48),
    bodyMaterial: new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.9, metalness: 0.2 }),
    // Unlit + untonemapped: lit lamps read as light sources day and night.
    lampMaterial: new THREE.MeshBasicMaterial({ toneMapped: false }),
  }));

  const groupRef = useDressingChunks({
    renderDistance: resolvedDistance,
    build: async (bounds) => {
      const points = await getTrafficLightPoints(
        bounds.minX,
        bounds.minZ,
        bounds.maxX,
        bounds.maxZ,
        chance
      );
      if (points.length === 0) return null;

      // Poles + heads: standard instancing, local +X facing the intersection.
      const bodies = instancedFromPoints(assets.bodyGeometry, assets.bodyMaterial, points, (p) => ({
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: yawFromDir(p.dirX, p.dirZ),
      }));

      // Three lamps per light on the head's front face (top red → bottom
      // green), colored per instance.
      const lampY = (l: number) => POLE_HEIGHT - 0.6 - l * 0.65;
      const lampPoints = points.flatMap((p) => [0, 1, 2].map((l) => ({ p, l })));
      const lamps = instancedFromPoints(assets.lampGeometry, assets.lampMaterial, lampPoints, ({ p, l }) => ({
        x: p.x + p.dirX * LAMP_OFFSET,
        y: p.y + lampY(l),
        z: p.z + p.dirZ * LAMP_OFFSET,
        yaw: yawFromDir(p.dirX, p.dirZ),
      }));

      // Seeded phase desynchronizes the initial states; runtime randomness
      // takes over from there (timing is visual-only, nothing depends on it).
      const headKeys: string[] = [];
      const lights: LightAnim[] = points.map((p, i) => {
        const state = Math.floor(p.phase * 3) % 3;
        const lit = STATE_TO_LAMP[state];
        for (let l = 0; l < 3; l++) lamps.setColorAt(i * 3 + l, l === lit ? LIT[l] : DIM[l]);

        // Glow source at the signal head, in the current color.
        const head: LampHead = {
          position: new THREE.Vector3(
            p.x + p.dirX * ARM_LENGTH,
            p.y + POLE_HEIGHT - 1.25,
            p.z + p.dirZ * ARM_LENGTH
          ),
          color: STATE_TO_GLOW[state],
        };
        const key = `tl_${p.x}_${p.z}`;
        activeLampHeads.set(key, head);
        headKeys.push(key);

        return { state, remaining: (p.phase * 7.13) % holdFor(), head };
      });
      if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
      markLampGridDirty(); // new heads registered above

      const group = new THREE.Group();
      group.add(bodies);
      group.add(lamps);
      registry.add({
        group,
        lamps,
        lights,
        headKeys,
        // yaw travels with the point: the arm and head are off-axis, so their
        // colliders need the same yaw the instance was drawn with.
        points: points.map((p) => ({ x: p.x, y: p.y, z: p.z, yaw: yawFromDir(p.dirX, p.dirZ) })),
        sincePass: 0,
        nextSwitchIn: lights.reduce((min, l) => Math.min(min, l.remaining), Infinity),
      });
      return group;
    },
  });

  // Real pole colliders for the signals near the player (base hook).
  const colliders = useDressingColliders(registry);

  useFrame((state, delta) => {
    // Shared lamp-grid driver (deduped per frame with the street lamps).
    driveLampLighting(camera, state.clock.elapsedTime);

    registry.forEachAlive((chunk) => {
      // Chunk-level skip: no light can be due before min(remaining) elapses,
      // so accumulate time and only walk the lights when it has. remaining
      // stays a per-light countdown; it's just decremented in batches.
      chunk.sincePass += delta;
      if (chunk.sincePass < chunk.nextSwitchIn) return;
      const elapsed = chunk.sincePass;
      chunk.sincePass = 0;

      let minRemaining = Infinity;
      // Changed lamp-INSTANCE range (3 lamps per light) for the partial upload.
      let minInst = Infinity;
      let maxInst = -1;
      for (let i = 0; i < chunk.lights.length; i++) {
        const light = chunk.lights[i];
        light.remaining -= elapsed;
        if (light.remaining <= 0) {
          light.state = nextState(light.state);
          light.remaining = holdFor();
          light.head.color = STATE_TO_GLOW[light.state];
          markLampGridDirty(); // pavement glow follows without waiting on another dirty source
          const lit = STATE_TO_LAMP[light.state];
          for (let l = 0; l < 3; l++) {
            chunk.lamps.setColorAt(i * 3 + l, l === lit ? LIT[l] : DIM[l]);
          }
          if (i * 3 < minInst) minInst = i * 3;
          maxInst = i * 3 + 2;
        }
        if (light.remaining < minRemaining) minRemaining = light.remaining;
      }
      chunk.nextSwitchIn = minRemaining;

      if (maxInst >= 0 && chunk.lamps.instanceColor) {
        // Partial GPU upload — three r157 has the single updateRange
        // {offset, count} on BufferAttribute (addUpdateRange arrived in
        // r159), measured in ARRAY ELEMENTS (floats, 3 per instance); the
        // renderer resets count to -1 after the ranged bufferSubData. When
        // several lights flipped this frame the range widens to span them
        // all (the untouched colors in between re-upload unchanged, still
        // far cheaper than the whole buffer).
        const attr = chunk.lamps.instanceColor;
        let start = minInst * 3;
        let end = (maxInst + 1) * 3;
        // count !== -1 ⇒ an earlier range is still unconsumed (the mesh is
        // frustum-culled, so the renderer never got to it) — expand over it,
        // or those colors would silently never reach the GPU.
        if (attr.updateRange.count !== -1) {
          start = Math.min(start, attr.updateRange.offset);
          end = Math.max(end, attr.updateRange.offset + attr.updateRange.count);
        }
        attr.updateRange.offset = start;
        attr.updateRange.count = end - start;
        attr.needsUpdate = true;
      }
    });
  });

  return (
    <>
      <group ref={groupRef} />
      {/* Pole, mast arm and signal head, all solid (base component; the body
          carries the instance's yaw so the off-axis parts line up). */}
      <DressingPartColliders colliders={colliders} parts={SIGNAL_COLLIDER_PARTS} />
    </>
  );
};
