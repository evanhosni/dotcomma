import { ParticleWriter } from "../chunk";
import { BUBBLE_LOOK } from "../material";
import { seededStream } from "../../../utils/math/seededStream";
import type { BubbleEmitter, BubbleEmitterParams } from "../../../utils/workers/vertexCompute";
import { createParticleDressing } from "..";

/** Bubbles rising off the floor of every water-based biome (emitters: utils/workers/lakeBubbles.ts); one
 *  domain-level mount. Drawn UNDER the water sheet (order 0). */
const DEFAULT_RENDER_DISTANCE = 160;
const EMITTERS: BubbleEmitterParams = { density: 120, minDepth: 3, count: 6 , seedTag: "bubble" };
/** The farthest a bubble rises. */
const MAX_TRAVEL = 30;
const RISE_MIN = 0.6;
const RISE_MAX = 1.2;

const emitBubbles = (e: BubbleEmitter, writer: ParticleWriter): void => {
  const stream = seededStream(`bubbles|${e.x},${e.z}`);
  for (let i = 0; i < e.count; i++) {
    const a = stream.next() * Math.PI * 2;
    const r = 1.2 * Math.sqrt(stream.next());
    const rise = stream.between(RISE_MIN, RISE_MAX);
    // Pops at the surface.
    const life = Math.min(MAX_TRAVEL, e.depth) / rise;
    writer.push(e.x + Math.cos(a) * r, e.y, e.z + Math.sin(a) * r, 0, rise, 0, life, stream.next() * life, stream.between(0.08, 0.2), stream.next());
  }
};

export const LakeBubbles = createParticleDressing({
  kind: "lakeBubbles",
  within: "biome",
  enumerator: "lakeBubbles",
  emitters: EMITTERS,
  layers: [{ look: BUBBLE_LOOK, emit: emitBubbles, maxTravel: MAX_TRAVEL, renderOrder: 0 }],
  defaultRenderDistance: DEFAULT_RENDER_DISTANCE,
});
