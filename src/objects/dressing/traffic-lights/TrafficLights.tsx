import { DressingAttributes } from "../../types";
import { useFrame } from "@react-three/fiber";
import React from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils";
import {
  LAMP_COLOR_GREEN,
  LAMP_COLOR_RED,
  LAMP_COLOR_YELLOW,
  type LampHead,
  registerLampHeads,
  setLampHeadColor,
} from "../../../lighting/lampGlow";
import {
  type ChunkWithPoints,
  DressingPartColliders,
  instancedFromPoints,
  useChunkRegistry,
  useDressingAssets,
  useDressingChunks,
  useDressingColliders,
  DRESSING_COLLIDER_DISTANCE,
  useDressingDefault,
  useServerPlacementCheck,
  yawFromDir,
} from "../Dressing";
import { enumerateDressing } from "../dressingWorker";

import { SIGNAL_ARM_LENGTH, SIGNAL_PARTS, SIGNAL_POLE_HEIGHT, TRAFFIC_LIGHTS_SPEC } from "./signalSpec";

const LAMP_OFFSET = SIGNAL_ARM_LENGTH + 0.26; // lamps proud of the head's front face

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
  secondsUntilSwitch: number;
  head: LampHead;
}

interface SignalChunk extends ChunkWithPoints {
  lamps: THREE.InstancedMesh;
  lights: LightAnim[];
  releaseHeads: () => void;
  secondsSincePass: number;
  /** min(lights.secondsUntilSwitch) at the last pass — the whole chunk is skipped until secondsSincePass reaches it. */
  nextSwitchIn: number;
}

export interface TrafficLightsProps extends DressingAttributes {
  /** Seeded fraction of eligible intersections that get signals. */
  chance?: number;
}

export const TrafficLights = ({
  renderDistance,
  colliderDistance,
  chance = TRAFFIC_LIGHTS_SPEC.placement.chance,
}: TrafficLightsProps) => {
  const resolvedDistance = useDressingDefault("renderDistance", renderDistance, 340);
  const placement = { chance };
  useServerPlacementCheck(TRAFFIC_LIGHTS_SPEC, placement);
  const registry = useChunkRegistry<SignalChunk>((chunk) => chunk.releaseHeads());

  const assets = useDressingAssets(() => ({
    bodyGeometry: mergeGeometries([
      new THREE.BoxGeometry(0.5, 0.4, 0.5).translate(0, 0.2, 0), // base
      new THREE.BoxGeometry(0.2, SIGNAL_POLE_HEIGHT, 0.2).translate(0, SIGNAL_POLE_HEIGHT / 2, 0), // pole
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
      const points = await enumerateDressing(TRAFFIC_LIGHTS_SPEC.enumerator, bounds, placement);
      if (points.length === 0) return null;

      const bodyMesh = instancedFromPoints(assets.bodyGeometry, assets.bodyMaterial, points, (p) => ({
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: yawFromDir(p.dirX, p.dirZ),
      }));

      const lampY = (l: number) => SIGNAL_POLE_HEIGHT - 0.6 - l * 0.65;
      const lampPoints = points.flatMap((p) => [0, 1, 2].map((l) => ({ p, l })));
      const lamps = instancedFromPoints(assets.lampGeometry, assets.lampMaterial, lampPoints, ({ p, l }) => ({
        x: p.x + p.dirX * LAMP_OFFSET,
        y: p.y + lampY(l),
        z: p.z + p.dirZ * LAMP_OFFSET,
        yaw: yawFromDir(p.dirX, p.dirZ),
      }));

      // Seeded phase only desynchronizes the initial states; runtime randomness takes over.
      const lights: LightAnim[] = points.map((p, i) => {
        const state = Math.floor(p.phase * 3) % 3;
        const lit = STATE_TO_LAMP[state];
        for (let l = 0; l < 3; l++) lamps.setColorAt(i * 3 + l, l === lit ? LIT_COLORS[l] : DIM_COLORS[l]);

        const head: LampHead = {
          position: new THREE.Vector3(
            p.x + p.dirX * SIGNAL_ARM_LENGTH,
            p.y + SIGNAL_POLE_HEIGHT - 1.25,
            p.z + p.dirZ * SIGNAL_ARM_LENGTH
          ),
          color: STATE_TO_GLOW[state],
        };
        return { state, secondsUntilSwitch: (p.phase * 7.13) % randomHoldSeconds(), head };
      });
      if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
      const releaseHeads = registerLampHeads("traffic-lights", lights.map((l) => l.head));

      const group = new THREE.Group();
      group.add(bodyMesh);
      group.add(lamps);
      registry.add({
        group,
        lamps,
        lights,
        releaseHeads,
        points: points.flatMap(TRAFFIC_LIGHTS_SPEC.bodiesOf),
        secondsSincePass: 0,
        nextSwitchIn: lights.reduce((min, l) => Math.min(min, l.secondsUntilSwitch), Infinity),
      });
      return group;
    },
  });

  const colliders = useDressingColliders(registry, {
    colliderDistance: useDressingDefault("colliderDistance", colliderDistance, DRESSING_COLLIDER_DISTANCE),
  });

  useFrame((_, delta) => {
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
          setLampHeadColor(light.head, STATE_TO_GLOW[light.state]);
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
      <DressingPartColliders colliders={colliders} parts={TRAFFIC_LIGHTS_SPEC.colliderParts} />
    </>
  );
};
