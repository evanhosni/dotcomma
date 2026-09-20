import { DressingAttributes } from "../../types";
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
  DressingPartColliders,
  instancedFromPoints,
  useChunkRegistry,
  useDressingAssets,
  useDressingChunks,
  useDressingColliders,
  DRESSING_COLLIDER_DISTANCE,
  useDressingDefault,
  yawFromDir,
} from "../Dressing";
import { getTrafficLightPoints } from "../dressingWorker";

import { ARM_LENGTH, POLE_HEIGHT, SIGNAL_COLLIDER_PARTS, SIGNAL_DEFAULT_CHANCE, SIGNAL_PARTS } from "./signalSpec";

const LAMP_OFFSET = ARM_LENGTH + 0.26; // lamps proud of the head's front face

// Lamp instances 3i / 3i+1 / 3i+2 = red / yellow / green, top to bottom. state: 0 green, 1 yellow, 2 red.
const LIT_COLORS = [new THREE.Color("#ff2418"), new THREE.Color("#ffb400"), new THREE.Color("#19ff5a")];
const DIM_COLORS = [new THREE.Color("#3a0c08"), new THREE.Color("#402d04"), new THREE.Color("#06401a")];
const STATE_TO_LAMP = [2, 1, 0];
const STATE_TO_GLOW = [LAMP_COLOR_GREEN, LAMP_COLOR_YELLOW, LAMP_COLOR_RED];

// Deliberately CHAOTIC: skewed 0.2–1.5s holds and a random jump to either other state,
// not a green → yellow → red cycle.
const randomHoldSeconds = (): number => 0.2 + Math.pow(Math.random(), 2.2) * 1.3;
const nextState = (state: number): number => (state + 1 + Math.floor(Math.random() * 2)) % 3;

interface LightAnim {
  state: number;
  secondsUntilSwitch: number; // seconds until the next switch
  head: LampHead; // mutate .color on switch
}

interface SignalChunk {
  group: THREE.Group;
  lamps: THREE.InstancedMesh;
  lights: LightAnim[];
  headKeys: string[];
  points: { x: number; y: number; z: number; yaw: number }[];
  secondsSincePass: number;
  /** min(lights.secondsUntilSwitch) at the last pass — the whole chunk is skipped until secondsSincePass reaches it. */
  nextSwitchIn: number;
}

export interface TrafficLightsProps extends DressingAttributes {
  /** Seeded fraction of eligible intersections that get signals. */
  chance?: number;
}

export const TrafficLights = ({ renderDistance, colliderDistance, chance = SIGNAL_DEFAULT_CHANCE }: TrafficLightsProps) => {
  const resolvedDistance = useDressingDefault("renderDistance", renderDistance, 340);
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
    // Untonemapped so lit lamps read as light sources by day too.
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

      const bodies = instancedFromPoints(assets.bodyGeometry, assets.bodyMaterial, points, (p) => ({
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: yawFromDir(p.dirX, p.dirZ),
      }));

      const lampY = (l: number) => POLE_HEIGHT - 0.6 - l * 0.65;
      const lampPoints = points.flatMap((p) => [0, 1, 2].map((l) => ({ p, l })));
      const lamps = instancedFromPoints(assets.lampGeometry, assets.lampMaterial, lampPoints, ({ p, l }) => ({
        x: p.x + p.dirX * LAMP_OFFSET,
        y: p.y + lampY(l),
        z: p.z + p.dirZ * LAMP_OFFSET,
        yaw: yawFromDir(p.dirX, p.dirZ),
      }));

      // Seeded phase only desynchronizes the initial states; runtime randomness takes over.
      const headKeys: string[] = [];
      const lights: LightAnim[] = points.map((p, i) => {
        const state = Math.floor(p.phase * 3) % 3;
        const lit = STATE_TO_LAMP[state];
        for (let l = 0; l < 3; l++) lamps.setColorAt(i * 3 + l, l === lit ? LIT_COLORS[l] : DIM_COLORS[l]);

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

        return { state, secondsUntilSwitch: (p.phase * 7.13) % randomHoldSeconds(), head };
      });
      if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
      markLampGridDirty();

      const group = new THREE.Group();
      group.add(bodies);
      group.add(lamps);
      registry.add({
        group,
        lamps,
        lights,
        headKeys,
        points: points.map((p) => ({ x: p.x, y: p.y, z: p.z, yaw: yawFromDir(p.dirX, p.dirZ) })),
        secondsSincePass: 0,
        nextSwitchIn: lights.reduce((min, l) => Math.min(min, l.secondsUntilSwitch), Infinity),
      });
      return group;
    },
  });

  const colliders = useDressingColliders(registry, {
    colliderDistance: useDressingDefault("colliderDistance", colliderDistance, DRESSING_COLLIDER_DISTANCE),
  });

  useFrame((state, delta) => {
    driveLampLighting(camera, state.clock.elapsedTime);

    registry.forEachAlive((chunk) => {
      chunk.secondsSincePass += delta;
      if (chunk.secondsSincePass < chunk.nextSwitchIn) return;
      const elapsed = chunk.secondsSincePass;
      chunk.secondsSincePass = 0;

      let minRemaining = Infinity;
      let minInst = Infinity;
      let maxInst = -1;
      for (let i = 0; i < chunk.lights.length; i++) {
        const light = chunk.lights[i];
        light.secondsUntilSwitch -= elapsed;
        if (light.secondsUntilSwitch <= 0) {
          light.state = nextState(light.state);
          light.secondsUntilSwitch = randomHoldSeconds();
          light.head.color = STATE_TO_GLOW[light.state];
          markLampGridDirty();
          const lit = STATE_TO_LAMP[light.state];
          for (let l = 0; l < 3; l++) {
            chunk.lamps.setColorAt(i * 3 + l, l === lit ? LIT_COLORS[l] : DIM_COLORS[l]);
          }
          if (i * 3 < minInst) minInst = i * 3;
          maxInst = i * 3 + 2;
        }
        if (light.secondsUntilSwitch < minRemaining) minRemaining = light.secondsUntilSwitch;
      }
      chunk.nextSwitchIn = minRemaining;

      if (maxInst >= 0 && chunk.lamps.instanceColor) {
        // Partial GPU upload of the flipped range (units: array elements, 3 per instance).
        // A still-pending range means the mesh was frustum-culled and the renderer never
        // consumed it — the new range must EXPAND over it (kept as ONE range, or a long-culled
        // chunk accumulates an entry per flip) or those colors silently never reach the GPU.
        // Runtime three is r157 (single `updateRange`); `updateRanges`/addUpdateRange arrived
        // in r159 and @types/three is newer than the runtime, so branch on what exists.
        const attr = chunk.lamps.instanceColor;
        let start = minInst * 3;
        let end = (maxInst + 1) * 3;
        const anyAttr = attr as any;
        const ranges: { start: number; count: number }[] | undefined = anyAttr.updateRanges;
        if (Array.isArray(ranges)) {
          if (ranges.length > 0) {
            const r = ranges[0];
            start = Math.min(start, r.start);
            end = Math.max(end, r.start + r.count);
            ranges.length = 1;
            r.start = start;
            r.count = end - start;
          } else {
            anyAttr.addUpdateRange(start, end - start);
          }
        } else if (anyAttr.updateRange) {
          if (anyAttr.updateRange.count !== -1) {
            start = Math.min(start, anyAttr.updateRange.offset);
            end = Math.max(end, anyAttr.updateRange.offset + anyAttr.updateRange.count);
          }
          anyAttr.updateRange.offset = start;
          anyAttr.updateRange.count = end - start;
        }
        attr.needsUpdate = true;
      }
    });
  });

  return (
    <>
      <group ref={groupRef} />
      {/* Real colliders only for the signals near the player. */}
      <DressingPartColliders colliders={colliders} parts={SIGNAL_COLLIDER_PARTS} />
    </>
  );
};
