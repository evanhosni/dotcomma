import { useFrame } from "@react-three/fiber";
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
import { instancedTemplate } from "../../../utils/warmPrograms";
import { DressingAttributes } from "../../types";
import { type ChunkWithPoints, instancedFromPoints, useDressingAssets, useSolidDressing, yawFromDir } from "../Dressing";
import { SIGNAL_ARM_LENGTH, SIGNAL_PARTS, SIGNAL_POLE_HEIGHT, TRAFFIC_LIGHTS_SPEC } from "./signalSpec";

const DEFAULT_RENDER_DISTANCE = 340;
const LAMP_OFFSET = SIGNAL_ARM_LENGTH + 0.26; // lamps proud of the head's front face
const LAMPS_PER_SIGNAL = 3;
/** Lamp `l` (0 = top)'s center above the pole base: 0.6 under the pole top, 0.65 apart. */
const lampHeight = (l: number): number => SIGNAL_POLE_HEIGHT - 0.6 - l * 0.65;
/** The glow source: the head's center (SIGNAL_PARTS.head), this far under the pole top. */
const GLOW_DROP = 1.25;

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

const paintSignal = (lamps: THREE.InstancedMesh, signal: number, state: number): void => {
  const lit = STATE_TO_LAMP[state];
  for (let l = 0; l < LAMPS_PER_SIGNAL; l++) {
    lamps.setColorAt(signal * LAMPS_PER_SIGNAL + l, l === lit ? LIT_COLORS[l] : DIM_COLORS[l]);
  }
};

/** Partial GPU upload of the flipped instance range [minInst, maxInst] (the attribute counts array
 *  elements, 3 per instance). A still-pending range means the mesh was frustum-culled and the renderer
 *  never consumed it — the new range must EXPAND over it (kept as ONE range, or a long-culled chunk
 *  accumulates an entry per flip) or those colors silently never reach the GPU. Runtime three is r157
 *  (single `updateRange`); `updateRanges`/addUpdateRange arrived in r159 and @types/three is newer than
 *  the runtime, so branch on what exists. */
const markInstanceColorRange = (attr: THREE.InstancedBufferAttribute, minInst: number, maxInst: number): void => {
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
};

/** Advances one chunk's lights by the time since its last pass; flips the due ones. */
const stepSignalChunk = (chunk: SignalChunk, delta: number): void => {
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
      paintSignal(chunk.lamps, i, light.state);
      if (i * LAMPS_PER_SIGNAL < minInst) minInst = i * LAMPS_PER_SIGNAL;
      maxInst = i * LAMPS_PER_SIGNAL + LAMPS_PER_SIGNAL - 1;
    }
    if (light.secondsUntilSwitch < minRemaining) minRemaining = light.secondsUntilSwitch;
  }
  chunk.nextSwitchIn = minRemaining;

  if (maxInst >= 0 && chunk.lamps.instanceColor) markInstanceColorRange(chunk.lamps.instanceColor, minInst, maxInst);
};

/** Placement (the signal `chance`) lives in signalSpec.ts only (the server builds the colliders from it). */
export interface TrafficLightsProps extends Pick<DressingAttributes, "renderDistance" | "colliderDistance"> {}

export const TrafficLights = ({ renderDistance, colliderDistance }: TrafficLightsProps) => {
  const assets = useDressingAssets(() => ({
    bodyGeometry: mergeGeometries([
      new THREE.BoxGeometry(0.5, 0.4, 0.5).translate(0, 0.2, 0), // base
      new THREE.BoxGeometry(0.2, SIGNAL_POLE_HEIGHT, 0.2).translate(0, SIGNAL_POLE_HEIGHT / 2, 0), // pole
      new THREE.BoxGeometry(SIGNAL_PARTS.arm.w, SIGNAL_PARTS.arm.h, SIGNAL_PARTS.arm.d).translate(
        SIGNAL_PARTS.arm.x,
        SIGNAL_PARTS.arm.y,
        0
      ),
      new THREE.BoxGeometry(SIGNAL_PARTS.head.w, SIGNAL_PARTS.head.h, SIGNAL_PARTS.head.d).translate(
        SIGNAL_PARTS.head.x,
        SIGNAL_PARTS.head.y,
        0
      ),
    ]),
    lampGeometry: new THREE.BoxGeometry(0.18, 0.48, 0.48),
    bodyMaterial: new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.9, metalness: 0.2 }),
    // Untonemapped so lit lamps read as light sources by day too.
    lampMaterial: new THREE.MeshBasicMaterial({ toneMapped: false }),
  }), (a) => [instancedTemplate(a.bodyMaterial), instancedTemplate(a.lampMaterial, { instanceColor: true })]);

  const { registry, content } = useSolidDressing<"trafficLights", SignalChunk>(TRAFFIC_LIGHTS_SPEC, {
    renderDistance,
    defaultRenderDistance: DEFAULT_RENDER_DISTANCE,
    colliderDistance,
    onRemove: (chunk) => chunk.releaseHeads(),
    build: (points) => {
      const bodyMesh = instancedFromPoints(assets.bodyGeometry, assets.bodyMaterial, points, (p) => ({
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: yawFromDir(p.dirX, p.dirZ),
      }));

      const lampPoints = points.flatMap((p) => [0, 1, 2].map((l) => ({ p, l })));
      const lamps = instancedFromPoints(assets.lampGeometry, assets.lampMaterial, lampPoints, ({ p, l }) => ({
        x: p.x + p.dirX * LAMP_OFFSET,
        y: p.y + lampHeight(l),
        z: p.z + p.dirZ * LAMP_OFFSET,
        yaw: yawFromDir(p.dirX, p.dirZ),
      }));

      // Seeded phase only desynchronizes the initial states; runtime randomness takes over.
      const lights: LightAnim[] = points.map((p, i) => {
        const state = Math.floor(p.phase * 3) % 3;
        paintSignal(lamps, i, state);
        const head: LampHead = {
          position: new THREE.Vector3(p.x + p.dirX * SIGNAL_ARM_LENGTH, p.y + SIGNAL_POLE_HEIGHT - GLOW_DROP, p.z + p.dirZ * SIGNAL_ARM_LENGTH),
          color: STATE_TO_GLOW[state],
        };
        return { state, secondsUntilSwitch: (p.phase * 7.13) % randomHoldSeconds(), head };
      });
      if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
      const releaseHeads = registerLampHeads("traffic-lights", lights.map((l) => l.head));

      const group = new THREE.Group();
      group.add(bodyMesh);
      group.add(lamps);
      return {
        group,
        lamps,
        lights,
        releaseHeads,
        secondsSincePass: 0,
        nextSwitchIn: lights.reduce((min, l) => Math.min(min, l.secondsUntilSwitch), Infinity),
      };
    },
  });

  useFrame((_, delta) => registry.forEachAlive((chunk) => stepSignalChunk(chunk, delta)));

  return content;
};
